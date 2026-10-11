"use client";

/**
 * Approved plan actions and the patient's self-report (spec 006 FR-006,
 * FR-018). Only approved actions exist here; their text is the closed
 * template registry. Reporting is online-only (nothing is queued), reuses one
 * clientId per attempt, and is never a clinical resolution.
 */
import { useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import type { CareAction } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { reportCareAction } from "@/lib/client/care-api";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import { createClientId } from "@/lib/client/ids";
import { describeApiError, toApiError, type ErrorDescription, type Language } from "@/lib/client/transport";
import { Ltr } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { ApprovalLapsed } from "./ApprovalLapsed";
import { actionApproval, canSelfReport, isActionOverdue, selfReportNote, sortActions } from "./plan-view";
import patientStyles from "../patient.module.css";
import styles from "./plan.module.css";

type ReportState = "completed" | "not_completed";

/**
 * The approver of one action is not in the patient projection (only the
 * plan's current referent is, shown on the plan card), so a one-time approval
 * is attributed generically rather than to a possibly different doctor. When
 * the server's live check says a PENDING action's approval lapsed, no
 * "Validé…" line is shown, only the reconfirmation notice; a finished action
 * keeps its historical line with no "wait before following it" directive.
 * Without a live check the original line stays, never "current".
 */
function OriginLine({ action, lang }: { action: CareAction; lang: Language }) {
  const copy = CARE_COPY[lang].plan;
  const { origin } = actionApproval(action, lang);
  if (!origin) return <ApprovalLapsed action={action} lang={lang} />;
  if (origin.kind === "protocol") {
    return (
      <p className={patientStyles.metaLine}>
        {copy.fromProtocol} · <Ltr>v{origin.version}</Ltr>
      </p>
    );
  }
  return <p className={patientStyles.metaLine}>{copy.validatedGeneric(origin.version)}</p>;
}

function SelfReport({ action, lang }: { action: CareAction; lang: Language }) {
  const { data, online } = usePatientRuntime();
  const copy = CARE_COPY[lang].plan;
  const [attempt, setAttempt] = useState<{ state: ReportState; clientId: string } | null>(null);
  const [busy, setBusy] = useState<ReportState | null>(null);
  const [error, setError] = useState<ErrorDescription | null>(null);
  const availability = canSelfReport(action, { online, origin: data.origin });

  if (availability === "not_pending" || availability === "device_copy") return null;
  if (availability === "offline") return <Notice tone="neutral" icon="wifi-off">{copy.reportOffline}</Notice>;

  const report = async (state: ReportState) => {
    // Same choice after a failure = same attempt: the server deduplicates by clientId.
    const current = attempt && attempt.state === state ? attempt : { state, clientId: createClientId("action") };
    setAttempt(current);
    setBusy(state);
    setError(null);
    try {
      const result = await runFenced(data.fence, () =>
        reportCareAction(action.id, { state, expectedRevision: action.revision, clientId: current.clientId }),
      );
      if (result.status === "stale") return;
      const updated = result.value.action;
      data.mutate((record) => ({ ...record, actions: record.actions.map((a) => (a.id === updated.id ? updated : a)) }));
      setAttempt(null);
      void data.refresh();
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(describeApiError(apiError, lang));
      // The action moved on: a new report is a new attempt, on fresh data.
      if (apiError.isConflict) {
        setAttempt(null);
        void data.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  // Lapsed approval: reporting stays allowed but only records something already done.
  const note = selfReportNote(action, lang);
  const noteId = note ? `report-note-${action.id}` : undefined;
  return (
    <div className={patientStyles.stackSm}>
      {note ? (
        <p id={noteId} className={patientStyles.metaLine}>
          {note}
        </p>
      ) : null}
      <div className={styles.choices}>
        <Button
          variant="secondary"
          size="lg"
          iconStart="check"
          loading={busy === "completed"}
          disabled={busy !== null}
          aria-describedby={noteId}
          onClick={() => void report("completed")}
        >
          {busy === "completed" ? copy.reporting : copy.reportDone}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          iconStart="minus"
          loading={busy === "not_completed"}
          disabled={busy !== null}
          aria-describedby={noteId}
          onClick={() => void report("not_completed")}
        >
          {busy === "not_completed" ? copy.reporting : copy.reportNotDone}
        </Button>
      </div>
      {error ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title={error.title}>
          {error.message} <Ltr>{error.code}</Ltr>
        </Notice>
      ) : null}
    </div>
  );
}

function ActionItem({ action, lang }: { action: CareAction; lang: Language }) {
  const copy = CARE_COPY[lang];
  const overdue = isActionOverdue(action, Date.now());
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <h3 className={styles.itemTitle}>{templateText(action.action.templateId, lang)}</h3>
        <div className={styles.badges}>
          <Badge tone={action.state === "pending" ? "outline" : "neutral"} icon={action.state === "pending" ? "clock" : "check"}>
            {copy.actionState[action.state]}
          </Badge>
          {overdue ? <Badge tone="outline">{copy.plan.overdue}</Badge> : null}
        </div>
      </div>
      <OriginLine action={action} lang={lang} />
      <p className={patientStyles.metaLine}>{copy.plan.due(formatDateTime(action.dueAt, lang))}</p>
      {action.reportedAt ? <p className={patientStyles.metaLine}>{copy.plan.reported(formatDateTime(action.reportedAt, lang))}</p> : null}
      <SelfReport action={action} lang={lang} />
      {action.state !== "cancelled" ? <p className={patientStyles.metaLine}>{copy.plan.reportNote}</p> : null}
    </li>
  );
}

interface PlanActionsProps {
  actions: readonly CareAction[];
  lang: Language;
  /** Device copy: when the approved actions were saved on this device. */
  deviceSavedAt: string | null;
}

export function PlanActions({ actions, lang, deviceSavedAt }: PlanActionsProps) {
  const copy = CARE_COPY[lang].plan;
  const sorted = sortActions(actions);
  return (
    <Card title={copy.actionsTitle} id="plan-actions">
      <div className={patientStyles.stackSm}>
        {deviceSavedAt ? (
          <Notice tone="neutral" icon="cloud-off">
            {copy.deviceCopy(formatDateTime(deviceSavedAt, lang))}
          </Notice>
        ) : null}
        {sorted.length === 0 ? (
          <p className={patientStyles.emptyLine}>{copy.actionsEmpty}</p>
        ) : (
          <ul className={styles.list}>
            {sorted.map((action) => (
              <ActionItem key={action.id} action={action} lang={lang} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
