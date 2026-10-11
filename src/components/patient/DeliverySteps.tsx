"use client";

/**
 * Honest transmission trail: captured on device -> received by the server ->
 * (only with an alert) seen by the care team. A step is filled only with
 * evidence: receipt comes from a server response, "seen" only from server
 * alert data (acknowledgedAt / status), never from anything inferred on the
 * device. Without an accepted doctor who can see alerts, the care-team step
 * says nobody has access; when that is unknown, it is left out (FR-027).
 */
import { Icon } from "@/components/ui";
import type { Alert, Language } from "@/lib/client/api";
import type { Messages } from "@/lib/client/i18n";
import { When } from "./bits";
import { deliveryCareStep, type CareStep } from "./monitoring/care-team-view";
import type { CareTeamStatus } from "./useCareTeam";
import styles from "./DeliverySteps.module.css";

export interface DeliveryStepsProps {
  lang: Language;
  t: Messages;
  capturedAt: string | null;
  receivedAt: string | null;
  /** Server alert linked to the measurement; omitted when no alert exists. */
  alert?: Alert | null;
  /** Who can currently see this patient's alerts (from the owner's grants). */
  team: CareTeamStatus;
}

interface Step extends CareStep {
  key: string;
}

export function DeliverySteps({ lang, t, capturedAt, receivedAt, alert, team }: DeliveryStepsProps) {
  const care = deliveryCareStep(team, alert ?? null, t);
  const steps: Step[] = [
    { key: "device", label: t.delivery.device, at: capturedAt, done: capturedAt !== null, waiting: capturedAt === null },
    { key: "server", label: t.delivery.server, at: receivedAt, done: receivedAt !== null, waiting: receivedAt === null },
    ...(care ? [{ key: "care", ...care }] : []),
  ];

  return (
    <ol className={styles.steps} aria-label={t.delivery.aria}>
      {steps.map((step) => (
        <li key={step.key} className={`${styles.step} ${step.done ? styles.done : styles.pending}`}>
          <span className={styles.marker} aria-hidden="true">
            {step.done ? <Icon name="check" size={12} /> : null}
          </span>
          <span className={styles.text}>
            <span className={styles.label}>{step.label}</span>
            <span className={styles.at}>
              {step.done && step.at ? <When iso={step.at} lang={lang} format="relative" /> : null}
              {step.waiting ? t.delivery.notYet : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
