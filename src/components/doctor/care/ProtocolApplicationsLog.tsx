"use client";

import { useState } from "react";
import { Badge, Button, DataTable, Timestamp, type BadgeTone, type IconName, type TableColumn } from "@/components/ui";
import type { ProtocolApplication } from "@/contracts/monitoring";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { applicationLogView } from "./protocol-log";
import { protocolReasonText } from "./protocol-text";
import { SourceList } from "./SourceList";
import styles from "./Care.module.css";

const assist = ASSIST_COPY.fr;

const STATE_BADGE: Readonly<Record<ProtocolApplication["state"], { tone: BadgeTone; icon: IconName }>> = {
  authorized: { tone: "outline", icon: "check" },
  blocked: { tone: "outline", icon: "x-circle" },
  delivered: { tone: "neutral", icon: "send" },
  expired: { tone: "muted", icon: "clock" },
  not_triggered: { tone: "muted", icon: "minus" },
};

const COLUMNS: TableColumn<ProtocolApplication>[] = [
  {
    key: "when",
    header: "Date",
    render: (a) => (
      <span className={styles.tightStack}>
        <Timestamp iso={a.createdAt} />
        {a.deliveredAt ? <Timestamp iso={a.deliveredAt} label="Transmise le" className={styles.muted} /> : null}
      </span>
    ),
  },
  {
    key: "state",
    header: "État",
    render: (a) => (
      <Badge tone={STATE_BADGE[a.state].tone} icon={STATE_BADGE[a.state].icon}>
        {assist.applicationState[a.state]}
      </Badge>
    ),
  },
  {
    key: "protocol",
    header: "Protocole",
    render: (a) => (
      <span className={styles.tightStack}>
        <span>Version {a.protocolVersion}</span>
        <bdi className={styles.mono}>{a.protocolId}</bdi>
      </span>
    ),
  },
  { key: "trigger", header: "Déclencheur", render: (a) => <bdi className={styles.mono}>{a.triggerId}</bdi> },
  {
    key: "reasons",
    header: "Raisons",
    render: (a) =>
      a.reasons.length === 0 ? (
        <span className={styles.muted}>Aucune raison enregistrée</span>
      ) : (
        <ul className={styles.bullets}>
          {a.reasons.map((reason, index) => {
            const label = protocolReasonText(reason);
            return label.translated ? (
              <li key={index}>{label.text}</li>
            ) : (
              <li key={index}>
                <bdi className={styles.mono} lang="en">
                  {label.text}
                </bdi>{" "}
                <span className={styles.muted}>(code serveur non traduit)</span>
              </li>
            );
          })}
        </ul>
      ),
  },
  {
    key: "sources",
    header: "Sources",
    render: (a) => (
      <details className={styles.details}>
        <summary>{a.sources.length} source(s)</summary>
        <SourceList sources={a.sources} />
      </details>
    ),
  },
  {
    key: "action",
    header: "Action créée",
    render: (a) => (a.actionId ? <bdi className={styles.mono}>{a.actionId}</bdi> : <span className={styles.muted}>Aucune</span>),
  },
];

/**
 * Every application keeps its protocol version, trigger, reasons and sources;
 * blocked reasons stay visible. "Non déclenchée" readings are quiet: hidden
 * by default behind a counter, they created nothing and need no review.
 */
export function ProtocolApplicationsLog({ applications }: { applications: readonly ProtocolApplication[] }) {
  const [showNotTriggered, setShowNotTriggered] = useState(false);
  const { rows, hiddenNotTriggered } = applicationLogView(applications, showNotTriggered);
  const notTriggered = applications.filter((a) => a.state === "not_triggered").length;
  return (
    <div className={styles.tightStack}>
      {notTriggered > 0 ? (
        <p className={styles.row}>
          <span className={styles.muted}>
            {showNotTriggered
              ? `${notTriggered} lecture(s) « non déclenchée » affichée(s) : aucune action ni message créé.`
              : `${hiddenNotTriggered} lecture(s) « non déclenchée » masquée(s) : conditions non réunies, aucune action ni message créé.`}
          </span>
          <Button size="sm" variant="ghost" aria-pressed={showNotTriggered} onClick={() => setShowNotTriggered((value) => !value)}>
            {showNotTriggered ? "Masquer" : "Afficher"}
          </Button>
        </p>
      ) : null}
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(a) => a.id}
        caption="« Bloquée » demande une nouvelle revue du médecin. « Transmise dans l’application » ne signifie ni lue ni faite par le patient."
        scrollLabel="Journal des applications de protocoles"
        empty={<span className={styles.muted}>Aucune application enregistrée.</span>}
        dense
      />
    </div>
  );
}
