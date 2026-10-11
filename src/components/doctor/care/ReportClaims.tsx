"use client";

import { Badge } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import type { ClinicianReport, GroundedClaim, SourceRef } from "@/contracts/monitoring";
import { CARE_COPY, claimCodeLabel } from "@/lib/client/copy/care";
import { claimParameterRows, groupClaims, resolveClaimSources, type ClaimParameterRow } from "./report-claims";
import { SourceList } from "./SourceList";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

/**
 * A textual value shown exactly as the server sent it (external-note text, a
 * typed label, any unmapped token or literal date) is not known French: it gets
 * an unknown language and automatic direction. Vocabulary-mapped values,
 * formatted dates, numbers and Oui/Non stay in the report's French island.
 */
function sentVerbatimText(row: ClaimParameterRow, parameters: GroundedClaim["parameters"]): boolean {
  const raw = Object.hasOwn(parameters, row.key) ? parameters[row.key] : undefined;
  return typeof raw === "string" && row.value === raw;
}

function ClaimItem({ claim, sources }: { claim: GroundedClaim; sources: readonly SourceRef[] }) {
  const parameters = claimParameterRows(claim.parameters);
  const { found, missingIds } = resolveClaimSources(claim, sources);
  return (
    <li className={styles.claim}>
      <span className={styles.strongText}>{claimCodeLabel(claim.code, "fr")}</span>
      {parameters.length > 0 ? (
        <dl className={styles.params}>
          {parameters.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd {...(sentVerbatimText(row, claim.parameters) ? UNKNOWN_LANGUAGE_TEXT : {})}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {claim.sourceIds.length > 0 ? (
        <SourceList sources={found} missingIds={missingIds} />
      ) : (
        <p className={styles.mutedBlock}>Aucune source citée pour cette affirmation.</p>
      )}
    </li>
  );
}

/**
 * Claims grouped by category; hypotheses framed apart as a clinician-only AI draft.
 * The report is authored in French: it keeps its own language and direction under an Arabic shell.
 */
export function ReportClaims({ report }: { report: ClinicianReport }) {
  const { groups, hypotheses } = groupClaims(report.claims);
  return (
    <div className={styles.stack} lang="fr" dir="ltr">
      {groups.length === 0 ? <p className={styles.mutedBlock}>Aucune affirmation de faits dans ce rapport.</p> : null}
      {groups.map((group) => (
        <section key={group.category} className={styles.tightStack} aria-label={copy.claimCategory[group.category]}>
          <h3 className={styles.groupTitle}>
            {copy.claimCategory[group.category]} ({group.claims.length})
          </h3>
          <ul className={styles.list}>
            {group.claims.map((claim, index) => (
              <ClaimItem key={`${claim.code}:${index}`} claim={claim} sources={report.sources} />
            ))}
          </ul>
        </section>
      ))}

      <section className={styles.hypotheses} aria-label="Hypothèses à examiner">
        <div className={styles.panelHeader}>
          <h3 className={styles.subTitle}>Hypothèses à examiner — brouillon IA, non diagnostique</h3>
          <Badge tone="outline" icon="lock">
            Réservé au clinicien · jamais montré au patient
          </Badge>
        </div>
        <p className={styles.mutedBlock}>Pistes à vérifier, pas des conclusions : ni diagnostic établi, ni consigne pour le patient.</p>
        {hypotheses.length === 0 ? (
          <p className={styles.mutedBlock}>Aucune hypothèse proposée.</p>
        ) : (
          <ul className={styles.list}>
            {hypotheses.map((claim, index) => (
              <ClaimItem key={`${claim.code}:${index}`} claim={claim} sources={report.sources} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
