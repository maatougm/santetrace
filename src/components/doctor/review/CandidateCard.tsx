"use client";

import { useState } from "react";
import { Badge, Button, Notice, type BadgeTone, type IconName } from "@/components/ui";
import type { AccessFence } from "@/lib/client/access-fence";
import type { Candidate, CandidateReviewResponse, Observation } from "@/lib/client/api";
import { formatNumber } from "@/lib/client/format";
import { formatCalendarDate } from "../shared/dates";
import { labReviewControls } from "../care/section-access";
import { CANDIDATE_STATUS_LABEL, CONFIDENCE_LABEL, IDENTITY_LABEL } from "../shared/labels";
import { CandidateReviewForm } from "./CandidateReviewForm";
import { ObservationPanel } from "./ObservationPanel";
import styles from "./Review.module.css";

interface CandidateCardProps {
  candidate: Candidate;
  observation: Observation | null;
  selected: boolean;
  /** Lab-review authority (AccessEnvelope.canReviewLabs); without it the card is read-only. */
  canReviewLabs: boolean;
  /** Record access fence: review results are applied only while it is current. */
  fence: AccessFence;
  onShowPage: (candidate: Candidate) => void;
  onReviewed: (result: CandidateReviewResponse) => void;
  onObservationUpdated: (observation: Observation) => void;
}

const STATUS_BADGE: Record<Candidate["status"], { tone: BadgeTone; icon: IconName }> = {
  proposed: { tone: "accent", icon: "eye" },
  confirmed: { tone: "muted", icon: "check-circle" },
  rejected: { tone: "muted", icon: "x-circle" },
};

const IDENTITY_ICON: Record<Candidate["identityMatch"], IconName> = {
  matched: "check",
  unknown: "help-circle",
  mismatch: "alert-triangle",
};

function Missing({ what }: { what: string }) {
  return <span className={styles.missing}>{what} manquante</span>;
}

/** One proposed value with its quoted source, evidence and review actions. */
export function CandidateCard({
  candidate,
  observation,
  selected,
  canReviewLabs,
  fence,
  onShowPage,
  onReviewed,
  onObservationUpdated,
}: CandidateCardProps) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const status = STATUS_BADGE[candidate.status];
  const controls = labReviewControls(candidate.status, { canReviewLabs });

  return (
    <article
      id={`candidate-${candidate.id}`}
      className={styles.candidate}
      data-selected={selected || undefined}
      data-status={candidate.status}
      aria-labelledby={`candidate-${candidate.id}-title`}
    >
      <header className={styles.candidateHead}>
        <div className={styles.candidateTitleRow}>
          <h3 id={`candidate-${candidate.id}-title`} className={styles.candidateTitle}>
            {candidate.exam}
          </h3>
          <Badge tone={status.tone} icon={status.icon}>
            {CANDIDATE_STATUS_LABEL[candidate.status]}
          </Badge>
        </div>
        <Button size="sm" variant={selected ? "secondary" : "ghost"} iconStart="file-text" onClick={() => onShowPage(candidate)}>
          {selected ? `Page ${candidate.page} affichée` : `Voir la page ${candidate.page}`}
        </Button>
      </header>

      <dl className={styles.proposal}>
        <div>
          <dt>Valeur proposée</dt>
          <dd className={styles.proposalValue}>
            {candidate.value === null ? <Missing what="Valeur" /> : formatNumber(candidate.value, "fr", 2)}{" "}
            {candidate.unit ?? <Missing what="Unité" />}
          </dd>
        </div>
        <div>
          <dt>Date d’examen</dt>
          <dd>{candidate.examDate ? formatCalendarDate(candidate.examDate) : <Missing what="Date" />}</dd>
        </div>
        <div>
          <dt>Page source</dt>
          <dd>{candidate.page}</dd>
        </div>
      </dl>

      <figure className={styles.quote}>
        <figcaption>Texte extrait, page {candidate.page} (non fiable tant que non vérifié sur le PDF)</figcaption>
        <blockquote>{candidate.sourceText}</blockquote>
      </figure>

      <ul className={styles.evidence}>
        <li>
          <span className={styles.evidenceLabel}>Indices d’extraction</span>
          <span>
            <strong>{CONFIDENCE_LABEL[candidate.confidence]}</strong> — {candidate.confidenceReason}
          </span>
        </li>
        <li data-identity={candidate.identityMatch}>
          <span className={styles.evidenceLabel}>Identité</span>
          <span className={styles.identityLine}>
            <Badge tone={candidate.identityMatch === "matched" ? "muted" : "outline"} icon={IDENTITY_ICON[candidate.identityMatch]}>
              {IDENTITY_LABEL[candidate.identityMatch]}
            </Badge>
          </span>
        </li>
      </ul>

      {outcome ? <Notice tone="success">{outcome}</Notice> : null}

      {controls.note ? <p className={styles.muted}>{controls.note}</p> : null}

      {controls.review ? (
        <CandidateReviewForm
          candidate={candidate}
          fence={fence}
          onReviewed={(result) => {
            setOutcome(
              result.candidate.status === "rejected"
                ? "Proposition rejetée : conservée pour traçabilité, exclue du dossier et des courbes."
                : "Valeur confirmée : elle apparaît désormais dans les résultats confirmés et les courbes, liée à cette source.",
            );
            onReviewed(result);
          }}
        />
      ) : null}

      {candidate.status === "confirmed" ? (
        observation ? (
          <ObservationPanel observation={observation} editable={controls.correct} fence={fence} onUpdated={onObservationUpdated} />
        ) : (
          <p className={styles.muted}>Résultat confirmé ; l’observation liée n’est pas encore chargée.</p>
        )
      ) : null}

      {candidate.status === "rejected" && !outcome ? (
        <p className={styles.muted}>Proposition rejetée : conservée pour traçabilité, non incluse dans le dossier.</p>
      ) : null}
    </article>
  );
}
