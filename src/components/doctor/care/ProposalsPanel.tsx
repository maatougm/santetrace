"use client";

import { useCallback, useRef, useState } from "react";
import { Badge, Button, Card, Notice, Skeleton } from "@/components/ui";
import type { AiMeta, CareProposal, RevisionGuard } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { generateProposals, listProposals } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import type { DoctorSectionProps } from "../PatientAccessScope";
import { ApiErrorState, errorText } from "../shared/ApiErrorState";
import { PROPOSALS_CARD_ID } from "./ActionApprovalCell";
import { AiMetaLine } from "./AiMetaLine";
import { OutcomeNotice } from "./OutcomeNotice";
import type { Outcome } from "./outcome";
import { ProposalItem, PROPOSAL_STATE_BADGE, proposalStateLabel, type ReviewMode } from "./ProposalItem";
import { ProposalReviewDialog, type ReviewTarget } from "./ProposalReviewDialog";
import { groupProposals, proposalReviewGate } from "./proposal-review";
import { useCurrentContext } from "./use-current-context";
import { useEpochScoped, useFencedResource } from "./use-fenced";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;
const GROUPS = ["home_measurement", "lab_exam", "information"] as const;

const conflictKey = (proposal: Pick<CareProposal, "id" | "revision">) => `${proposal.id}:${proposal.revision}`;

/** Separate drafts (home measurement, lab exam, information), each decided on its own. */
export function ProposalsPanel({ patientId, record, fence, refresh }: DoctorSectionProps) {
  const canManage = record.access.canManageCare;
  // Reload when the polled record shows a proposal change (new draft, needs_review…).
  const signature = record.proposals.map((p) => `${p.id}:${p.revision}:${p.state}`).join("|");
  const loader = useCallback((signal: AbortSignal) => listProposals(patientId, { signal }), [patientId]);
  const { state, reload } = useFencedResource(fence, loader, signature);
  const { guard: currentGuard } = useCurrentContext(patientId, record, fence);

  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(() => new Set());
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [outcome, setOutcome] = useEpochScoped<Outcome>(fence);
  const [focusKey, setFocusKey] = useState(0);
  const openings = useRef(0);
  const [generation, setGeneration] = useEpochScoped<AiMeta>(fence);
  const [generating, setGenerating] = useState<{ clientId: string; busy: boolean; failure: string | null; discarded?: boolean } | null>(null);

  const recheck = () => {
    reload();
    refresh();
  };
  /** Explicit "Actualiser": the server is asked again, so earlier 409 flags are dropped. */
  const recheckAll = () => {
    setConflicts(new Set());
    recheck();
  };
  const report = (next: Outcome) => {
    setTarget(null);
    setOutcome(next);
    setFocusKey((value) => value + 1);
    recheck();
  };

  const generate = async (clientId: string) => {
    setGenerating({ clientId, busy: true, failure: null });
    try {
      const result = await runFenced(fence, () => generateProposals(patientId, { clientId }));
      if (result.status === "stale") {
        setGenerating({ clientId, busy: false, failure: null, discarded: true });
        return;
      }
      setGenerating(null);
      setGeneration(result.value.meta);
      recheck();
    } catch (error) {
      // Same key on retry: the server returns the same generation instead of a second one.
      setGenerating({ clientId, busy: false, failure: errorText(error) });
    }
  };

  const openReview = (mode: ReviewMode, proposal: CareProposal) => {
    setOutcome(null);
    openings.current += 1;
    setTarget({ mode, proposal, nonce: openings.current });
  };

  const onConflict = (proposal: CareProposal, text: string) => {
    setConflicts((current) => new Set([...current, conflictKey(proposal)]));
    report({ ok: false, text: `À réexaminer : ${text}` });
  };

  const busy = generating?.busy ?? false;

  return (
    <Card
      id={PROPOSALS_CARD_ID}
      title="Propositions à revoir"
      description="Brouillons préparés à partir du dossier. Chaque élément se décide séparément ; rien n’est transmis au patient sans votre validation."
      actions={
        canManage ? (
          <Button variant="primary" iconStart="refresh" loading={busy} onClick={() => void generate(createClientId("proposals"))}>
            Générer des propositions
          </Button>
        ) : null
      }
    >
      <div className={styles.stack}>
        {!canManage ? (
          <Notice tone="neutral" icon="lock">
            Revue des propositions réservée au médecin référent : lecture seule pour ce compte.
          </Notice>
        ) : null}
        {busy ? <p className={styles.mutedBlock}>Génération en cours (jusqu’à 45 s). Rien n’est affiché avant la réponse du serveur.</p> : null}
        {generating?.failure ? (
          <Notice
            tone="neutral"
            icon="x-circle"
            role="alert"
            title="Propositions non générées"
            action={
              <Button size="sm" variant="secondary" iconStart="refresh" onClick={() => void generate(generating.clientId)}>
                Réessayer
              </Button>
            }
          >
            {generating.failure}
          </Notice>
        ) : null}
        {generating?.discarded ? (
          <Notice tone="neutral" icon="lock">
            Résultat écarté : l’accès au dossier a changé pendant la génération. Relancez si besoin.
          </Notice>
        ) : null}
        {generation ? (
          <AiMetaLine meta={generation} fallbackLabel="Propositions produites par des règles fixes à partir des faits du dossier ; aucune réponse de modèle n’est affichée." />
        ) : null}
        <OutcomeNotice outcome={outcome} focusKey={focusKey} />

        {state.status === "loading" ? <Skeleton lines={4} /> : null}
        {state.status === "error" ? <ApiErrorState error={state.error} onRetry={reload} compact /> : null}
        {state.status === "ready" ? (
          <ProposalGroupsView
            groups={groupProposals(state.value.proposals)}
            canManage={canManage}
            conflicts={conflicts}
            currentGuard={currentGuard}
            onReview={openReview}
            onRecheck={recheckAll}
          />
        ) : null}
      </div>

      <ProposalReviewDialog
        target={target}
        currentGuard={currentGuard}
        fence={fence}
        onClose={() => setTarget(null)}
        onOutcome={report}
        onConflict={onConflict}
      />
    </Card>
  );
}

interface ProposalGroupsViewProps {
  groups: ReturnType<typeof groupProposals>;
  canManage: boolean;
  conflicts: ReadonlySet<string>;
  currentGuard: RevisionGuard | null;
  onReview: (mode: ReviewMode, proposal: CareProposal) => void;
  onRecheck: () => void;
}

function ProposalGroupsView({ groups, canManage, conflicts, currentGuard, onReview, onRecheck }: ProposalGroupsViewProps) {
  const total = GROUPS.reduce((sum, kind) => sum + groups[kind].length, 0) + groups.statusOnly.length;
  if (total === 0) return <p className={styles.mutedBlock}>Aucune proposition pour ce patient.</p>;
  return (
    <div className={styles.stack}>
      {GROUPS.map((kind) => (
        <section key={kind} className={styles.tightStack} aria-label={copy.proposalKind[kind]}>
          <h3 className={styles.groupTitle}>
            {copy.proposalKind[kind]} ({groups[kind].length})
          </h3>
          {groups[kind].length === 0 ? (
            <p className={styles.mutedBlock}>Aucune.</p>
          ) : (
            groups[kind].map((proposal) => (
              <ProposalItem
                key={proposal.id}
                proposal={proposal}
                gate={proposalReviewGate(proposal, { canManageCare: canManage, conflicted: conflicts.has(conflictKey(proposal)), currentGuard })}
                onReview={onReview}
                onRecheck={onRecheck}
              />
            ))
          )}
        </section>
      ))}
      {groups.statusOnly.length > 0 ? (
        <section className={styles.tightStack} aria-label="Propositions sans détail">
          <h3 className={styles.groupTitle}>Détail réservé au médecin référent ({groups.statusOnly.length})</h3>
          <ul className={styles.list}>
            {groups.statusOnly.map((status) => (
              <li key={conflictKey(status)} className={styles.row}>
                <span className={styles.strongText}>{copy.proposalKind[status.kind]}</span>
                <Badge tone={PROPOSAL_STATE_BADGE[status.state].tone} icon={PROPOSAL_STATE_BADGE[status.state].icon}>
                  {proposalStateLabel(status.state)}
                </Badge>
                <Badge tone="muted">Révision {status.revision}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
