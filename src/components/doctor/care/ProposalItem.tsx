"use client";

import { Badge, Button, Notice, Timestamp, type BadgeTone, type IconName } from "@/components/ui";
import type { CareProposal } from "@/contracts/monitoring";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import type { RecheckReason, ReviewGate } from "./proposal-review";
import { claimParameterRows } from "./report-claims";
import { SourceList } from "./SourceList";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

export type ReviewMode = "approve" | "reject" | "edit";

export const PROPOSAL_STATE_BADGE: Readonly<Record<CareProposal["state"], { tone: BadgeTone; icon: IconName }>> = {
  pending: { tone: "outline", icon: "clock" },
  needs_inputs: { tone: "outline", icon: "help-circle" },
  needs_review: { tone: "outline", icon: "refresh" },
  approved: { tone: "accent", icon: "check" },
  rejected: { tone: "muted", icon: "x" },
  expired: { tone: "muted", icon: "clock" },
};

/** Shared state labels. `needs_review` is the server's awaiting-decision state; staleness comes from a 409. */
const STATE_LABEL: Readonly<Record<string, string>> = copy.proposalState;

/** Known states get the clinician label; history states arrive as plain strings and unknown ones are shown as recorded. */
export function proposalStateLabel(state: string): string {
  return Object.hasOwn(STATE_LABEL, state) ? STATE_LABEL[state] : state;
}

const RECHECK_TEXT: Readonly<Record<RecheckReason, { title: string; body: string }>> = {
  inputs: {
    title: "Informations à compléter avant toute validation",
    body: "Des informations obligatoires manquent au dossier (questions d’accueil). La validation reste bloquée jusqu’à leur ajout.",
  },
  changed: {
    title: "À réexaminer : le dossier a changé",
    body: "Ce brouillon date d’un état antérieur du dossier : validation et rejet sont désactivés. « Réexaminer » le lie au dossier actuel (nouvelle révision), ou générez de nouvelles propositions.",
  },
  conflict: {
    title: "À réexaminer : le serveur a refusé cette révision",
    body: "Validation désactivée pour cette révision. Actualisez ; si le refus persiste, réexaminez la proposition ou générez-en de nouvelles.",
  },
  unknown: {
    title: "Contexte actuel du dossier inconnu",
    body: "Le serveur n’a pas fourni l’état actuel du dossier : aucune décision n’est possible pour l’instant. Actualisez.",
  },
};

interface ProposalItemProps {
  proposal: CareProposal;
  gate: ReviewGate;
  onReview: (mode: ReviewMode, proposal: CareProposal) => void;
  onRecheck: () => void;
}

/** One draft: exact action, sources with provenance, decision trail and per-item controls. */
export function ProposalItem({ proposal, gate, onReview, onRecheck }: ProposalItemProps) {
  const state = PROPOSAL_STATE_BADGE[proposal.state];
  const parameters = claimParameterRows(proposal.action.parameters);
  const title = templateText(proposal.action.templateId, "fr");
  return (
    <article className={styles.panel} aria-label={`Proposition : ${title}`}>
      <div className={styles.panelHeader}>
        <h4 className={styles.panelTitle}>{title}</h4>
        <span className={styles.row}>
          <Badge tone={state.tone} icon={state.icon}>
            {proposalStateLabel(proposal.state)}
          </Badge>
          <Badge tone="muted">Révision {proposal.revision}</Badge>
        </span>
      </div>
      <p className={styles.metaLine}>
        <span>{copy.proposalKind[proposal.kind]}</span>
        <bdi className={styles.mono}>
          {proposal.action.templateId} · v{proposal.action.templateVersion}
        </bdi>
        {proposal.kind === "lab_exam" && !gate.decided ? <span>Non visible du patient avant votre décision.</span> : null}
      </p>
      {parameters.length > 0 ? (
        <dl className={styles.params}>
          {parameters.map((row) => (
            <div key={row.key}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {gate.recheck ? (
        <Notice
          tone="neutral"
          icon="refresh"
          title={RECHECK_TEXT[gate.recheck].title}
          action={
            <Button size="sm" variant="secondary" iconStart="refresh" onClick={onRecheck}>
              Actualiser
            </Button>
          }
        >
          {RECHECK_TEXT[gate.recheck].body}
        </Notice>
      ) : null}

      {proposal.decision ? (
        <p className={styles.metaLine}>
          <span>
            Décision par <bdi className={styles.mono}>{proposal.decision.clinicianId}</bdi> · révision {proposal.revision}
          </span>
          <Timestamp iso={proposal.decision.at} />
          {proposal.decision.reason ? <span>Motif : {proposal.decision.reason}</span> : null}
        </p>
      ) : null}

      <details className={styles.details}>
        <summary>
          {copy.sources.title} ({proposal.sources.length})
        </summary>
        <SourceList sources={proposal.sources} />
      </details>
      {proposal.history.length > 0 ? (
        <details className={styles.details}>
          <summary>Historique ({proposal.history.length})</summary>
          <ul className={styles.list}>
            {proposal.history.map((entry) => (
              <li key={`${entry.revision}:${entry.at}`} className={styles.metaLine}>
                <span>Révision {entry.revision}</span>
                <bdi className={styles.mono}>{entry.action.templateId}</bdi>
                <span>{proposalStateLabel(entry.state)}</span>
                <bdi className={styles.mono}>{entry.author}</bdi>
                <Timestamp iso={entry.at} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {gate.canReject || gate.canEdit ? (
        <div className={styles.panelActions}>
          <Button size="sm" variant="secondary" iconStart="check" disabled={!gate.canApprove} onClick={() => onReview("approve", proposal)}>
            Valider une fois…
          </Button>
          <Button size="sm" variant="ghost" iconStart="edit" disabled={!gate.canEdit} onClick={() => onReview("edit", proposal)}>
            {gate.recheck === "changed" ? "Réexaminer…" : "Modifier…"}
          </Button>
          <Button size="sm" variant="ghost" iconStart="x" disabled={!gate.canReject} onClick={() => onReview("reject", proposal)}>
            Ne pas retenir…
          </Button>
        </div>
      ) : null}
    </article>
  );
}
