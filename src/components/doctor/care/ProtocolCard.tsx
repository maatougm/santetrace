"use client";

import { Badge, Button, KeyValueList, Notice, Timestamp, type BadgeTone, type IconName } from "@/components/ui";
import type { MedicalFact, ProtocolPredicate, ProtocolStateInput, ReusableProtocol } from "@/contracts/monitoring";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { templateText } from "@/lib/client/copy/care";
import { describePredicate, formatSeconds, PREDICATE_LIST_LABEL } from "./protocol-text";
import styles from "./Care.module.css";

const assist = ASSIST_COPY.fr;

export const PROTOCOL_STATE_BADGE: Readonly<Record<ReusableProtocol["state"], { tone: BadgeTone; icon: IconName }>> = {
  active: { tone: "accent", icon: "check" },
  suspended: { tone: "outline", icon: "clock" },
  revoked: { tone: "muted", icon: "x" },
  expired: { tone: "muted", icon: "clock" },
};

function PredicateList({ title, predicates, facts }: { title: string; predicates: readonly ProtocolPredicate[]; facts: readonly MedicalFact[] }) {
  return (
    <div>
      <h4 className={styles.subTitle}>{title}</h4>
      {predicates.length === 0 ? (
        <p className={styles.mutedBlock}>Aucun.</p>
      ) : (
        <ul className={styles.bullets}>
          {predicates.map((predicate, index) => (
            <li key={index}>{describePredicate(predicate, facts)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ProtocolCardProps {
  protocol: ReusableProtocol;
  facts: readonly MedicalFact[];
  /** Applications counted in the log for this protocol id (null: log unavailable). */
  used: number | null;
  canManage: boolean;
  onRevise: (protocol: ReusableProtocol) => void;
  onState: (protocol: ReusableProtocol, action: ProtocolStateInput["action"]) => void;
}

/** One protocol version: exact action, bounds, conditions in plain French, history and explicit controls. */
export function ProtocolCard({ protocol, facts, used, canManage, onRevise, onState }: ProtocolCardProps) {
  const badge = PROTOCOL_STATE_BADGE[protocol.state];
  const title = protocol.actions.map((a) => templateText(a.templateId, "fr")).join(" · ") || "Aucune action";
  const open = protocol.state === "active" || protocol.state === "suspended";
  return (
    <article className={styles.panel} aria-label={`Protocole : ${title}`}>
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>{title}</h3>
        <span className={styles.row}>
          <Badge tone={badge.tone} icon={badge.icon}>
            {assist.protocolState[protocol.state]}
          </Badge>
          <Badge tone="muted">Version {protocol.revision}</Badge>
        </span>
      </div>
      <KeyValueList
        columns={3}
        dense
        items={[
          { label: "Autorisé par", value: protocol.clinicianId, mono: true },
          { label: "Valable jusqu’au", value: <Timestamp iso={protocol.validUntil} /> },
          { label: "Intervalle minimal", value: formatSeconds(protocol.minIntervalSeconds) },
          {
            label: "Applications",
            value: used === null ? `${protocol.maxApplications} au plus` : `${used} sur ${protocol.maxApplications} (d’après le journal)`,
          },
          { label: "Proposition source", value: protocol.sourceProposalId, mono: true },
          { label: "Créé le", value: <Timestamp iso={protocol.createdAt} /> },
        ]}
      />
      <p className={styles.metaLine}>
        <span>
          Lié au contexte {protocol.requiredContextRevision} · plan v{protocol.carePlanRevision} · autorité {protocol.authorityRevision}
        </span>
        {protocol.profileVersions.length > 0 ? <bdi className={styles.mono}>{protocol.profileVersions.join(", ")}</bdi> : null}
        {protocol.actions.map((a) => (
          <bdi key={a.templateId} className={styles.mono}>
            {a.templateId} · v{a.templateVersion}
          </bdi>
        ))}
      </p>
      <PredicateList title={PREDICATE_LIST_LABEL.predicates.title} predicates={protocol.predicates} facts={facts} />
      <PredicateList title={PREDICATE_LIST_LABEL.exclusions.title} predicates={protocol.exclusions} facts={facts} />
      <PredicateList title={PREDICATE_LIST_LABEL.stopCriteria.title} predicates={protocol.stopCriteria} facts={facts} />
      {protocol.state === "suspended" ? (
        <Notice tone="neutral" icon="lock" title="Protocole suspendu">
          Revoir un message ou le dossier ne le réactive pas : seule une nouvelle version explicite (« Réviser ») peut l’autoriser à nouveau.
        </Notice>
      ) : null}
      {protocol.history.length > 0 ? (
        <details className={styles.details}>
          <summary>Historique ({protocol.history.length})</summary>
          <ul className={styles.list}>
            {protocol.history.map((entry) => (
              <li key={`${entry.revision}:${entry.at}`} className={styles.metaLine}>
                <span>Version {entry.revision}</span>
                <bdi className={styles.mono}>{entry.clinicianId}</bdi>
                <Timestamp iso={entry.at} />
                {entry.reason ? <span>Motif : {entry.reason}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canManage && open ? (
        <div className={styles.panelActions}>
          <Button size="sm" variant="secondary" iconStart="edit" onClick={() => onRevise(protocol)}>
            Réviser (nouvelle version)…
          </Button>
          {protocol.state === "active" ? (
            <Button size="sm" variant="ghost" iconStart="clock" onClick={() => onState(protocol, "suspend")}>
              Suspendre…
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" iconStart="x" onClick={() => onState(protocol, "revoke")}>
            Retirer…
          </Button>
        </div>
      ) : null}
    </article>
  );
}
