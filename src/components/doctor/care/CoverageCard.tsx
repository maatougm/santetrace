"use client";

import { Badge, Card, Notice, StatusBadge, Timestamp } from "@/components/ui";
import type { ConditionEvaluation, Coverage, MedicalFact } from "@/contracts/monitoring";
import type { PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { UNTRANSLATED_REASON, displayableEvaluationTime, reasonText } from "@/lib/client/copy/reasons";
import { statusLabel } from "@/lib/client/format";
import { PARTIAL_COVERAGE_LABEL, displayPriority, globalMonitoringView, isPartialCoverage } from "./coverage";
import { factLabel, factLabelById } from "./fact-labels";
import { SourceList } from "./SourceList";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

/**
 * Complete coverage is a plain badge; anything else uses the dashed "unknown"
 * look. With a profile, "unsupported" means some limits are not assessed
 * (partial coverage), not that monitoring is unavailable.
 */
function CoverageBadges({ coverage, profiled }: { coverage: readonly Coverage[]; profiled: boolean }) {
  const unique = [...new Set(coverage)];
  if (unique.length === 0) return <StatusBadge status="unknown" size="sm" label="Couverture non renseignée" />;
  return (
    <span className={styles.row}>
      {unique.map((c) =>
        c === "complete" ? (
          <Badge key={c} tone="neutral" icon="check">
            {copy.coverage[c]}
          </Badge>
        ) : (
          <StatusBadge key={c} status="unknown" size="sm" label={c === "unsupported" && profiled ? PARTIAL_COVERAGE_LABEL : copy.coverage[c]} />
        ),
      )}
    </span>
  );
}

/** Server reasons in French; an unmapped sentence is kept verbatim, marked lang="en" and labelled untranslated. */
function ReasonList({ reasons }: { reasons: readonly string[] }) {
  return (
    <ul className={styles.bullets}>
      {reasons.map((reason, index) => {
        const shown = reasonText(reason, "fr");
        return shown.translated ? (
          <li key={index}>{shown.text}</li>
        ) : (
          <li key={index}>
            <span lang="en">{shown.text}</span> <span className={styles.muted}>({UNTRANSLATED_REASON.fr})</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Evaluation time, or "pas encore évalué" for the server's never-evaluated sentinel (never a 1970 date). */
function EvaluatedAt({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const shown = displayableEvaluationTime(iso);
  return shown ? <Timestamp iso={shown} label="Évalué le" className={className} /> : <span className={className ?? styles.muted}>Pas encore évalué</span>;
}

function conditionLabel(facts: readonly MedicalFact[], id: string): string {
  return factLabelById(facts, id) ?? `Condition ${id}`;
}

function EvaluationPanel({ evaluation, facts }: { evaluation: ConditionEvaluation; facts: readonly MedicalFact[] }) {
  const label = conditionLabel(facts, evaluation.conditionFactId);
  const shown = displayPriority(evaluation.priority, evaluation.coverage, { profiled: evaluation.profileId !== null });
  const scope = evaluation.profileId ? `${label} — profil ${evaluation.profileId}` : label;
  return (
    <article className={styles.panel} aria-label={`Évaluation : ${label}`}>
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>{label}</h3>
        <StatusBadge status={shown.status} label={statusLabel(shown.status)} size="sm" />
      </div>
      <p className={styles.mutedBlock}>{copy.monitoring.scopeOnly(scope)}</p>
      {evaluation.profileId ? (
        <p className={styles.row}>
          <bdi className={styles.mono}>
            {evaluation.profileId} · {evaluation.profileVersion ?? "version inconnue"}
          </bdi>
          <Badge tone="outline">{copy.monitoring.profileDemo}</Badge>
        </p>
      ) : (
        <p className={styles.mutedBlock}>{copy.monitoring.unsupportedCondition}</p>
      )}
      <CoverageBadges coverage={evaluation.coverage} profiled={evaluation.profileId !== null} />
      {isPartialCoverage(evaluation) ? <p className={styles.mutedBlock}>{PARTIAL_COVERAGE_LABEL}.</p> : null}
      {shown.status === "unknown" && evaluation.priority === "green" ? <p className={styles.mutedBlock}>{copy.monitoring.notGreenBecause}</p> : null}
      {evaluation.reasons.length > 0 ? (
        <div>
          <h4 className={styles.subTitle}>{copy.monitoring.reasonsTitle}</h4>
          <ReasonList reasons={evaluation.reasons} />
        </div>
      ) : null}
      <p className={styles.metaLine}>
        <EvaluatedAt iso={evaluation.evaluatedAt} />
        <Timestamp iso={evaluation.nextDueAt} label="Prochaine donnée attendue" />
      </p>
      <details className={styles.details}>
        <summary>
          {copy.monitoring.sourcesTitle} ({evaluation.sources.length})
        </summary>
        <SourceList sources={evaluation.sources} />
      </details>
    </article>
  );
}

/** Global view and per-condition evaluations: no reassuring green the coverage does not support. */
export function CoverageCard({ record }: { record: PatientRecord }) {
  const view = globalMonitoringView(record.monitoring, record.evaluations, record.medicalFacts);
  const monitoring = record.monitoring;
  return (
    <Card
      title="Couverture et évaluations"
      description="Priorités calculées par des règles de démonstration versionnées. L’IA ne décide pas de la priorité."
    >
      <div className={styles.stack}>
        <div className={styles.tightStack}>
          <p className={styles.row}>
            <span className={styles.strongText}>{copy.monitoring.globalTitle}</span>
            <StatusBadge status={view.status} label={statusLabel(view.status)} />
            {monitoring ? <EvaluatedAt iso={monitoring.evaluatedAt} className={styles.muted} /> : null}
          </p>
          {!view.evaluated ? <p className={styles.mutedBlock}>{copy.monitoring.noEvaluation}</p> : null}
          {/* Without uncovered conditions, an aggregate "unsupported" can only come from a profiled, partial evaluation. */}
          {monitoring ? <CoverageBadges coverage={monitoring.coverage} profiled={view.uncovered.length === 0} /> : null}
          {view.evaluated && view.incomplete && monitoring?.priority === "green" ? (
            <p className={styles.mutedBlock}>{copy.monitoring.notGreenBecause}</p>
          ) : null}
          {view.evaluated && view.incomplete && monitoring && monitoring.priority !== "green" ? (
            <p className={styles.mutedBlock}>Couverture incomplète : cette priorité ne résume pas tout le suivi.</p>
          ) : null}
          {monitoring && monitoring.reasons.length > 0 ? <ReasonList reasons={monitoring.reasons} /> : null}
        </div>

        {view.uncovered.length > 0 ? (
          <Notice tone="neutral" icon="help-circle" title="Conditions sans profil de suivi">
            <ul className={styles.bullets}>
              {view.uncovered.map((fact) => (
                <li key={fact.id}>
                  <span className={styles.strongText}>{factLabel(fact)}</span> — {copy.monitoring.unsupportedCondition}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {record.evaluations.length > 0 ? (
          <div className={styles.panelGrid}>
            {record.evaluations.map((evaluation) => (
              <EvaluationPanel key={evaluation.id} evaluation={evaluation} facts={record.medicalFacts} />
            ))}
          </div>
        ) : (
          <p className={styles.mutedBlock}>Aucune évaluation par condition pour l’instant.</p>
        )}
      </div>
    </Card>
  );
}
