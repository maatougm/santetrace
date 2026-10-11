"use client";

/**
 * Provisional feedback for a measurement that is NOT yet received by the
 * server. Clearly labelled as local, computed with the cached rule version, and
 * explicit that the care team is not informed until sending succeeds.
 */
import { Notice } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import type { Messages } from "@/lib/client/i18n";
import type { LocalEvaluation } from "@/lib/client/outbox";
import { Ltr, NumberWithUnit, When } from "./bits";
import styles from "./patient.module.css";

const TONE = { green: "neutral", orange: "orange", red: "red" } as const;

export function LocalEvaluationNotice({
  evaluation,
  lang,
  t,
}: {
  evaluation: LocalEvaluation | null;
  lang: Language;
  t: Messages;
}) {
  const copy = t.measure.result;

  if (!evaluation) {
    return (
      <Notice tone="neutral" icon="clock" title={t.outbox.state.queued}>
        <p className={styles.noticeLine}>{copy.noRules}</p>
        <p className={styles.noticeLine}>{t.outbox.careTeamNotInformed}</p>
      </Notice>
    );
  }

  const { conversion } = evaluation;
  return (
    <Notice tone={TONE[evaluation.status]} title={copy.localTitle} role={evaluation.status === "red" ? "alert" : "status"}>
      <p className={styles.noticeStrong}>{copy.localStatus[evaluation.status]}</p>
      {evaluation.status === "red" ? <p className={styles.noticeStrong}>{copy.emergency}</p> : null}
      <p className={styles.noticeLine}>{t.outbox.careTeamNotInformed}</p>
      <p className={styles.noticeMeta}>{copy.localBody}</p>
      <p className={styles.noticeMeta}>
        {copy.localRules} <Ltr>{evaluation.ruleVersion}</Ltr>
        {evaluation.rulesSavedAt ? (
          <>
            {" · "}
            {copy.localSavedAt} <When iso={evaluation.rulesSavedAt} lang={lang} />
          </>
        ) : null}
      </p>
      {conversion ? (
        <p className={styles.noticeMeta}>
          {copy.conversion}{" "}
          <NumberWithUnit value={conversion.fromValue} unit={conversion.fromUnit} lang={lang} />
          {" ≈ "}
          <NumberWithUnit
            value={conversion.toValue}
            unit={conversion.toUnit}
            lang={lang}
            digits={conversion.toUnit === "mmol/L" ? 1 : 0}
          />
        </p>
      ) : null}
      <p className={styles.noticeMeta}>{t.common.demoRules}</p>
    </Notice>
  );
}
