"use client";

/**
 * Simplified patient home, mobile first, in this order: a compact greeting,
 * the one status card, the single primary action ("Ajouter une mesure",
 * available offline), the real result of the last send, the latest reading,
 * then the next step, the secondary quick-link list and the outbox
 * disclosure. Always visible when they apply, without opening anything: the
 * red episode, a missing referent, stale/unknown status, consent not recorded,
 * suspect readings and approvals pending at the doctor (status card rows),
 * and the unsent/offline state (the shell's StatusStrip).
 */
import { LinkButton } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { HomeNextStep } from "./home/HomeNextStep";
import { HomeQuickLinks } from "./home/HomeQuickLinks";
import { HomeStatusCard } from "./home/HomeStatusCard";
import { LastResult } from "./home/LastResult";
import { LatestReading } from "./home/LatestReading";
import { MonitoringDetails, OutboxDetails } from "./home/HomeDetails";
import { HOME_COPY } from "./home/home-copy";
import { homeStatusView } from "./home/home-status";
import { firstName, homeAttention, nextStep } from "./home/home-view";
import { NoReferentNotice } from "./monitoring/NoReferentNotice";
import { RedEpisode } from "./monitoring/RedEpisodeBanner";
import { needsReferent } from "./monitoring/monitoring-view";
import { usePatientRuntime } from "./PatientRuntime";
import type { PatientData } from "./usePatientRecord";
import { RecordGate } from "./RecordGate";
import css from "./home.module.css";

interface Freshness {
  /** Fetched from the server during this visit. */
  live: boolean;
  /** Device copy, or the latest poll failed. */
  stale: boolean;
  /** ISO time of the answer on screen when it is not live. */
  staleSince: string | null;
}

function freshness(data: PatientData): Freshness {
  const staleSince =
    data.origin === "device"
      ? data.deviceSavedAt
      : data.lastSuccessAt !== null
        ? new Date(data.lastSuccessAt).toISOString()
        : null;
  return { live: data.origin === "server", stale: data.origin !== "server" || data.error !== null, staleSince };
}

/** The one primary action of the home (the devices link is a quiet entry in the quick links). */
function PrimaryAction({ lang }: { lang: Language }) {
  return (
    <div className={css.primary}>
      {/* Always available, even offline without server data: capture goes to the outbox. */}
      <LinkButton href="/patient/measure" variant="primary" size="lg" fullWidth iconStart="plus">
        {HOME_COPY[lang].addMeasure}
      </LinkButton>
    </div>
  );
}

export function HomeScreen() {
  const { t, lang, session, data, lastResult, setLastResult, careTeam } = usePatientRuntime();
  const record = data.record;
  const { live, stale, staleSince } = freshness(data);
  const name = firstName(record?.patient.displayName ?? session?.actor.displayName);
  const view = record ? homeStatusView({ record, live, stale, staleSince, team: careTeam.status, lang, t }) : null;
  const step = record
    ? nextStep({ live, actions: record.actions, reminders: record.reminders, facts: record.medicalFacts, now: Date.now() })
    : null;

  return (
    <div className={css.home}>
      <h1 className={css.greeting}>{t.home.greeting(name)}</h1>

      {/* Fixed red message first, from open red alerts only (no model, not hidden by a later green). */}
      <RedEpisode alerts={record?.alerts ?? null} pendingDoctor={careTeam.status === "none"} />
      {record && needsReferent(record, data.origin) ? <NoReferentNotice lang={lang} /> : null}

      <div className={css.layout}>
        <div className={css.column}>
          {/* The gate renders the loading/offline/consent/error state in place of the status card. */}
          <RecordGate>
            {(gated) =>
              view ? (
                <HomeStatusCard view={view} attention={homeAttention(gated, live)} lang={lang} t={t}>
                  <MonitoringDetails record={gated} view={view} live={live} lang={lang} />
                </HomeStatusCard>
              ) : null
            }
          </RecordGate>
          <PrimaryAction lang={lang} />
          {lastResult ? <LastResult entry={lastResult} lang={lang} t={t} onDismiss={() => setLastResult(null)} /> : null}
          {/* Latest reading straight after the action and its real result, before any shortcut. */}
          {record ? <LatestReading record={record} lang={lang} t={t} /> : null}
        </div>

        <div className={css.column}>
          {step ? <HomeNextStep step={step} lang={lang} t={t} /> : null}
          {/* Secondary list: never competes with the measurement action above. */}
          <HomeQuickLinks lang={lang} />
          <OutboxDetails />
        </div>
      </div>
    </div>
  );
}
