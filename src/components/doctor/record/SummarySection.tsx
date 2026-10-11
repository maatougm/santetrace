"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Badge, Button, Card, EmptyState, Notice, Skeleton } from "@/components/ui";
import {
  getExport,
  getSummary,
  type PatientRecord,
  type SummaryFact,
  type SummaryResponse,
} from "@/lib/client/api";
import type { AccessFence, MutationGuard } from "@/lib/client/access-fence";
import { formatMeasurement, formatNumber, measurementKindLabel } from "@/lib/client/format";
import { reviewHref } from "../shared/routes";
import { ApiErrorState, errorText } from "../shared/ApiErrorState";
import { formatCalendarDate } from "../shared/dates";
import { fmtDateTime } from "../shared/time";
import styles from "./Record.module.css";

type SummaryState =
  | { status: "loading" }
  | { status: "ready"; summary: SummaryResponse }
  | { status: "error"; error: unknown };

function FactItem({ fact, record }: { fact: SummaryFact; record: PatientRecord }) {
  const measurement = record.measurements.find((m) => m.id === fact.id);
  if (measurement) {
    return (
      <li className={styles.fact}>
        <span className={styles.factKind}>{measurementKindLabel(measurement.kind)}</span>
        <strong className={styles.value}>{formatMeasurement(measurement)}</strong>
        <span className={styles.muted}>mesurée le {fmtDateTime(measurement.measuredAt)}</span>
      </li>
    );
  }
  const observation = record.observations.find((o) => o.id === fact.id);
  if (observation) {
    return (
      <li className={styles.fact}>
        <span className={styles.factKind}>{observation.exam}</span>
        <strong className={styles.value}>
          {formatNumber(observation.value, "fr", 2)} {observation.unit}
        </strong>
        <span className={styles.muted}>examen du {formatCalendarDate(observation.examDate)}</span>
        <Link href={reviewHref(record.patient.id, observation.documentId, observation.candidateId)}>Ouvrir la source</Link>
      </li>
    );
  }
  return (
    <li className={styles.fact}>
      <span className={styles.factKind}>{fact.kind}</span>
      <span className={styles.muted}>
        Fait <code className={styles.mono}>{fact.id}</code> non présent dans le dossier chargé
      </span>
      {fact.sourceId ? <span className={styles.muted}>source {fact.sourceId}</span> : null}
    </li>
  );
}

function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const DISCARDED = "Résultat écarté : l’accès au dossier a changé pendant la requête. Rien n’est affiché ni téléchargé.";

function ExportCard({ patientId, guard }: { patientId: string; guard: MutationGuard }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setPending(true);
    setMessage(null);
    // Actor + epoch ticket taken before the request; success and failure both go through it.
    const commit = guard.begin();
    try {
      const payload = await getExport(patientId);
      const applied = commit(() => {
        const stamp = new Date().toISOString().slice(0, 10);
        downloadJson(payload, `hackcure-export-${patientId}-${stamp}.json`);
        const mapping = typeof payload.terminologyMapping === "string" ? payload.terminologyMapping : "non précisé";
        setMessage({ ok: true, text: `Export téléchargé. Correspondances terminologiques : ${mapping}.` });
      });
      if (!applied) setMessage({ ok: false, text: DISCARDED });
    } catch (error) {
      if (!commit(() => setMessage({ ok: false, text: errorText(error) }))) setMessage({ ok: false, text: DISCARDED });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      title="Export structuré"
      description="Observations et mesures au format JSON, avec sujet, valeurs, unités, horodatages et sources."
      actions={
        <Button variant="secondary" iconStart="download" loading={pending} onClick={() => void run()}>
          Télécharger (JSON)
        </Button>
      }
    >
      <p className={styles.mutedBlock}>
        <Badge tone="outline" icon="alert-triangle">
          Correspondances terminologiques non vérifiées
        </Badge>{" "}
        Les codes ou libellés d’examens ne sont pas validés par rapport à un référentiel. Données fictives de démonstration.
      </p>
      {message ? (
        <Notice tone={message.ok ? "success" : "neutral"} icon={message.ok ? undefined : "x-circle"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </Notice>
      ) : null}
    </Card>
  );
}

/**
 * Server summary shown verbatim: the UI adds no interpretation. Each read takes
 * an actor + epoch ticket from the record's mutation guard: a summary or error
 * held across an authority change or patient switch is dropped, and any access
 * change reloads it under the current authority.
 */
export function SummarySection({ record, fence, guard }: { record: PatientRecord; fence: AccessFence; guard: MutationGuard }) {
  const patientId = record.patient.id;
  const [state, setState] = useState<SummaryState>({ status: "loading" });
  const epoch = useSyncExternalStore(fence.subscribe, fence.epoch, fence.epoch);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      const commit = guard.begin();
      try {
        const summary = await getSummary(patientId, { signal });
        if (signal?.aborted) return;
        // Refused: stays "loading" and the epoch effect reloads under the current authority.
        commit(() => setState({ status: "ready", summary }));
      } catch (error) {
        if (!signal?.aborted) commit(() => setState({ status: "error", error }));
      }
    },
    [guard, patientId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, epoch]);

  return (
    <div className={styles.sectionStack}>
      <Card
        title="Synthèse factuelle"
        actions={
          <Button size="sm" variant="ghost" iconStart="refresh" onClick={() => void load()} loading={state.status === "loading"}>
            Actualiser
          </Button>
        }
      >
        {state.status === "loading" ? <Skeleton lines={4} /> : null}
        {state.status === "error" ? <ApiErrorState error={state.error} onRetry={() => void load()} compact /> : null}
        {state.status === "ready" ? (
          <div className={styles.summary}>
            <p className={styles.summaryFlag}>
              {state.summary.ai ? (
                <Badge tone="outline" icon="info">
                  Rédigée par IA à partir de faits dé-identifiés — à vérifier
                </Badge>
              ) : (
                <Badge tone="muted" icon="check">
                  Modèle factuel fixe — sans IA
                </Badge>
              )}
            </p>
            <blockquote className={styles.summaryText}>{state.summary.text}</blockquote>
            <h3 className={styles.subTitle}>Faits inclus ({state.summary.facts.length})</h3>
            {state.summary.facts.length === 0 ? (
              <EmptyState compact icon="inbox" title="Aucun fait inclus" description="Aucune mesure ni résultat confirmé." />
            ) : (
              <ul className={styles.facts}>
                {state.summary.facts.map((fact) => (
                  <FactItem key={fact.id} fact={fact} record={record} />
                ))}
              </ul>
            )}
            <p className={styles.mutedBlock}>
              Aucune interprétation, diagnostic ou changement de traitement n’est proposé par cette synthèse.
            </p>
          </div>
        ) : null}
      </Card>
      <ExportCard patientId={patientId} guard={guard} />
    </div>
  );
}
