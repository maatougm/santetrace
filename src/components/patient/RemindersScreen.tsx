"use client";

/**
 * "Mes rappels": every reminder of the patient's plan, medication or care
 * action. The page heading, intro and empty state stay neutral (a
 * blood-pressure task is not "treatment"); server reminder titles are shown
 * as written. Notification delivery (server `delivery`) is shown separately
 * from the patient's own self-report. Medication reminders only: no report =
 * "Non déclaré" (unknown), never "not taken"; reports go through the outbox
 * with a stable clientId and the server accepts one report per reminder.
 * Reminders created for a care action follow that action (reminder-view): no
 * "Pris / Pas pris", and a finished action is listed as past. Their report
 * area is labelled "Action du plan", never "Votre déclaration".
 */
import { useState } from "react";
import { Badge, Button, EmptyState, Icon, LinkButton, Notice, PageHeader, type IconName } from "@/components/ui";
import type { Language, PatientRecord, Reminder } from "@/lib/client/api";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import type { Messages } from "@/lib/client/i18n";
import { createReminderAckEntry, enqueue, sendEntry, type ReminderAckEntry } from "@/lib/client/outbox";
import { colon, Ltr, SectionTitle, When } from "./bits";
import { reminderDisplay, reminderGroups, RECENT_DUE_MS, type ReminderDisplay } from "./plan/reminder-view";
import { usePatientRuntime } from "./PatientRuntime";
import { RecordGate } from "./RecordGate";
import styles from "./patient.module.css";
import rem from "./reminders.module.css";

const DELIVERY_ICON: Record<Reminder["delivery"], IconName> = {
  pending: "clock",
  sent: "send",
  failed: "x-circle",
  local: "bell",
};

interface ReminderCardProps {
  reminder: Reminder;
  local: ReminderAckEntry | undefined;
  lang: Language;
  t: Messages;
  onReport: (reminder: Reminder, taken: boolean) => Promise<string | null>;
  onDiscard: (clientId: string) => Promise<void>;
}

function SelfReport({ reminder, local, lang, t, onReport, onDiscard }: ReminderCardProps) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reminder.taken !== null) {
    return (
      <div className={rem.report}>
        <span className={rem.reportValue}>
          <Icon name={reminder.taken ? "check-circle" : "minus"} size={18} />
          {reminder.taken ? t.reminders.taken : t.reminders.notTaken}
        </span>
        <span className={styles.metaLine}>
          <When iso={reminder.acknowledgedAt} lang={lang} label={t.reminders.reportedOn} />
        </span>
        <Badge tone="accent" icon="check">
          {t.reminders.serverReceived}
        </Badge>
      </div>
    );
  }

  if (local) {
    const failed = local.state === "failed";
    return (
      <div className={`${rem.report} ${rem.reportLocal}`}>
        <span className={rem.reportValue}>
          <Icon name={failed ? "x-circle" : "clock"} size={18} />
          {local.payload.taken ? t.reminders.taken : t.reminders.notTaken}
        </span>
        <span className={styles.metaLine}>{failed ? t.outbox.state.failed : t.reminders.localPending}</span>
        {local.lastError ? (
          <span className={failed ? styles.slipError : styles.slipInfo}>
            {t.outbox.errors[local.lastError.kind]}
            {lang === "fr" && local.lastError.message ? ` ${local.lastError.message}` : null}
          </span>
        ) : null}
        {failed ? (
          <Button variant="ghost" iconStart="x" onClick={() => void onDiscard(local.clientId)}>
            {t.outbox.discard}
          </Button>
        ) : null}
      </div>
    );
  }

  const submit = async () => {
    if (choice === null) return;
    setBusy(true);
    setError(null);
    const message = await onReport(reminder, choice);
    setBusy(false);
    setError(message);
    if (!message) setChoice(null);
  };

  return (
    <div className={rem.report}>
      <span className={rem.unknown}>
        <Icon name="help-circle" size={16} />
        {t.reminders.notReported}
      </span>
      {choice === null ? (
        <div className={rem.choices}>
          <Button variant="secondary" size="lg" iconStart="check" onClick={() => setChoice(true)}>
            {t.reminders.taken}
          </Button>
          <Button variant="secondary" size="lg" iconStart="minus" onClick={() => setChoice(false)}>
            {t.reminders.notTaken}
          </Button>
        </div>
      ) : (
        <div className={rem.confirm} role="group" aria-label={t.reminders.reportLabel}>
          <p className={styles.metaLine}>{t.reminders.confirmQuestion}</p>
          <div className={rem.choices}>
            <Button variant="ghost" size="lg" onClick={() => setChoice(null)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void submit()}>
              {choice ? t.reminders.confirmTaken : t.reminders.confirmNotTaken}
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p className={styles.slipError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Report area of a reminder created for a care action: never medication
 * "Pris / Pas pris". The action is reported in the plan (pending or not
 * visible here); a finished action shows its own declaration, plus the note
 * that a declaration does not close an alert.
 */
function CareActionReport({ display }: { display: Exclude<ReminderDisplay, { mode: "medication" }> }) {
  if (display.mode === "plan_link") {
    return (
      <div className={rem.report}>
        <LinkButton href={display.href} variant="secondary" iconStart="clipboard">
          {display.label}
        </LinkButton>
      </div>
    );
  }
  return (
    <div className={rem.report}>
      <Badge tone="neutral" icon="check">
        {display.stateLabel}
      </Badge>
      <p className={styles.metaLine}>{display.note}</p>
    </div>
  );
}

function ReminderCard(props: ReminderCardProps & { display: ReminderDisplay }) {
  const { reminder, lang, t, display } = props;
  // Only a medication reminder is declared here; a care action is labelled as a plan action.
  const reportLabel =
    display.mode === "medication" ? t.reminders.reportLabel : ASSIST_COPY[lang].reminders.planActionLabel;
  return (
    <article className={rem.card}>
      <header className={rem.head}>
        <span className={rem.icon} aria-hidden="true">
          <Icon name={display.mode === "medication" ? "pill" : "clipboard"} size={20} />
        </span>
        <div className={rem.headText}>
          {/* Server title shown verbatim; its own direction (Arabic or French) whatever the UI language. */}
          <h3 className={rem.label} dir="auto">{reminder.label}</h3>
          <When iso={reminder.dueAt} lang={lang} label={t.reminders.due} />
        </div>
      </header>
      <p className={rem.delivery}>
        <Icon name={DELIVERY_ICON[reminder.delivery]} size={14} />
        <span>
          {t.reminders.deliveryLabel}
          {colon(lang)}
          {t.reminders.delivery[reminder.delivery]}
        </span>
      </p>
      <div className={rem.reportBlock}>
        <p className={rem.reportLabel}>{reportLabel}</p>
        {display.mode === "medication" ? <SelfReport {...props} /> : <CareActionReport display={display} />}
      </div>
    </article>
  );
}

function ReminderList({ record }: { record: PatientRecord }) {
  const { t, lang, scope, data, outbox, careTeam } = usePatientRuntime();
  const { mutate, refresh } = data;
  const now = Date.now();

  const localByReminder = new Map<string, ReminderAckEntry>();
  outbox.entries.forEach((entry) => {
    if (entry.kind !== "reminder_ack" || entry.state === "server_received") return;
    if (!localByReminder.has(entry.payload.reminderId)) localByReminder.set(entry.payload.reminderId, entry);
  });

  const report = async (reminder: Reminder, taken: boolean): Promise<string | null> => {
    if (!scope) return t.reminders.noStorage;
    const entry = createReminderAckEntry(scope, reminder, taken, record.patient.rules?.version ?? null);
    let persisted = true;
    try {
      await enqueue(entry);
    } catch {
      persisted = false;
    }
    const sent = await sendEntry(entry, { persist: persisted });
    const result = sent.result;
    if (sent.state === "server_received" && result) {
      mutate((current) => ({
        ...current,
        reminders: current.reminders.map((r) => (r.id === result.reminder.id ? result.reminder : r)),
      }));
      void refresh();
      return null;
    }
    if (sent.state === "failed") void refresh();
    // Without local storage nothing was kept: say so instead of showing a queued state.
    return persisted ? null : t.reminders.noStorage;
  };

  // A reminder for a finished care action is past, whatever its due time.
  const { upcoming, past } = reminderGroups(record.reminders, record.actions, now, RECENT_DUE_MS);

  if (record.reminders.length === 0) {
    // "…programmé par votre équipe soignante" only when an accepted doctor exists (FR-027).
    // Neutral bell: an empty list says "no reminders", not "no medication".
    return <EmptyState icon="bell" title={careTeam.status === "present" ? t.reminders.empty : t.home.noReminders} />;
  }

  const renderGroup = (title: string, id: string, items: Reminder[]) =>
    items.length > 0 ? (
      <section className={styles.stack} aria-labelledby={id}>
        <SectionTitle id={id}>
          {title} <Ltr>({items.length})</Ltr>
        </SectionTitle>
        {items.map((reminder) => (
          <ReminderCard
            key={reminder.id}
            reminder={reminder}
            display={reminderDisplay(reminder, record.actions, lang)}
            local={localByReminder.get(reminder.id)}
            lang={lang}
            t={t}
            onReport={report}
            onDiscard={outbox.discard}
          />
        ))}
      </section>
    ) : null;

  return (
    <>
      {data.origin === "device" ? (
        <Notice tone="neutral" icon="cloud-off">
          {t.reminders.offlineList}
        </Notice>
      ) : null}
      {renderGroup(t.reminders.upcoming, "rem-upcoming", upcoming)}
      {renderGroup(t.reminders.past, "rem-past", past)}
    </>
  );
}

export function RemindersScreen() {
  const { t, lang } = usePatientRuntime();
  const assist = ASSIST_COPY[lang].reminders;
  return (
    <div className={styles.page}>
      <PageHeader
        title={t.reminders.title}
        description={t.reminders.intro}
        actions={
          <LinkButton href="/patient/plan" variant="secondary" iconStart="clipboard">
            {assist.planLink}
          </LinkButton>
        }
      />
      {/* Reading a reminder is not doing it: medication is declared here, a plan action in the plan. */}
      <Notice tone="neutral" icon="info">
        {assist.readIsNotDone}
      </Notice>
      <RecordGate>{(record) => <ReminderList record={record} />}</RecordGate>
    </div>
  );
}
