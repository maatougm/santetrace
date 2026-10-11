"use client";

/**
 * On-demand experimental AI case attention estimate inside the record.
 * - Read: GET via the shared polling hook (live invalidation + slow fallback);
 *   it never runs the model.
 * - Generate: POST only from the explicit button click below; never on render
 *   or from polling. The result passes the record's mutation guard.
 * - Hidden entirely for owners, secondary clinicians and status-only access.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge, Button, Skeleton, Spinner } from "@/components/ui";
import { useActorSession } from "@/components/layout";
import { describeApiError, type PatientRecord } from "@/lib/client/api";
import {
  getAiCaseScore,
  requestAiCaseScore,
  type AiCaseScoreFailure,
  type AiCaseScoreResponse,
  type MedicalConsultationMeta,
} from "@/lib/client/doctor-api";
import { createClientId } from "@/lib/client/ids";
import { staleResponseError } from "@/lib/client/transport";
import { ConsultationProvenance } from "../care/ConsultationProvenance";
import { usePatientAccess } from "../PatientAccessScope";
import { useGuardedPolling } from "../shared/use-guarded-polling";
import {
  AI_SCORE_LABEL,
  AI_SCORE_NOT_COMPUTED,
  AI_SCORE_REQUEST,
  aiCaseScoreEligible,
  aiScoreCardState,
  guardKey,
  isBlockingFailure,
  type AiScoreCardState,
} from "./ai-case-score-view";
import { AiScoreDetails } from "./AiScoreDetails";
import styles from "./AiCaseScore.module.css";

/** Live events refresh it at once; this is only the fallback cadence for a cached-read GET. */
const READ_INTERVAL_MS = 30_000;
const DISCLAIMER =
  "Signal d’attention expérimental proposé par une IA à partir du dossier. Ce n’est ni une probabilité clinique, ni une urgence, ni une approbation de traitement, et il ne change pas l’ordre de la file.";

function useScoreRead(patientId: string, eligible: boolean) {
  const { actor } = useActorSession();
  const { fence } = usePatientAccess();
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<AiCaseScoreResponse> => {
      const started = fence.epoch();
      if (fence.denied()) throw staleResponseError("Access denied for this record");
      const response = await getAiCaseScore(patientId, { signal });
      if (!fence.isCurrent(started)) throw staleResponseError("Access changed while the score read was in flight");
      return response;
    },
    [fence, patientId],
  );
  return useGuardedPolling<AiCaseScoreResponse>(eligible ? `doctor-ai-case-score:${actor.id}:${patientId}` : null, fetcher, {
    intervalMs: READ_INTERVAL_MS,
  });
}

interface RequestContext {
  apply: (updater: () => AiCaseScoreResponse) => void;
  /** Changes when the record revision moves: earlier request outcomes no longer apply. */
  revisionKey: string | null;
  /** Changes on every successful read: the read now carries the authoritative blocking reason. */
  lastReadAt: number | null;
}

/** Outcome of an explicit request without an estimate, with the consultation it genuinely returned. */
interface RequestFailure {
  reason: AiCaseScoreFailure;
  consultation: MedicalConsultationMeta | null;
}

function useScoreRequest(patientId: string, { apply, revisionKey, lastReadAt }: RequestContext) {
  const { guard } = usePatientAccess();
  const [requesting, setRequesting] = useState(false);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFailure(null);
    setError(null);
  }, [revisionKey]);

  // A blocking outcome (red alert, model unavailable) is re-reported by every read; once a newer
  // read arrives, let it decide, so the button comes back as soon as the situation clears.
  useEffect(() => {
    setFailure((current) => (current && isBlockingFailure(current.reason) ? null : current));
  }, [lastReadAt]);

  const request = async () => {
    if (requesting) return;
    setRequesting(true);
    setFailure(null);
    setError(null);
    const commit = guard.begin();
    try {
      const response = await requestAiCaseScore(patientId, createClientId("ai-case-score"));
      const applied = commit(() =>
        response.aiCaseScore
          ? apply(() => response)
          : setFailure({ reason: response.reason ?? "invalid_output", consultation: response.consultation ?? null }),
      );
      if (!applied) setError("Résultat écarté : votre accès à ce dossier a changé pendant le calcul.");
    } catch (caught) {
      if (!commit(() => setError(describeApiError(caught, "fr").title))) setError("Résultat écarté : votre accès à ce dossier a changé.");
    } finally {
      setRequesting(false);
    }
  };
  return { request, requesting, failure, error };
}

function RequestButton({ state, onRequest }: { state: AiScoreCardState; onRequest: () => void }) {
  const busy = state.kind === "busy";
  const can = busy || ("canRequest" in state && state.canRequest);
  if (!can) return null;
  return (
    <Button variant="secondary" iconStart="activity" loading={busy} disabled={busy} onClick={onRequest}>
      {busy ? "Calcul en cours…" : AI_SCORE_REQUEST}
    </Button>
  );
}

interface NotComputedProps {
  message: string | null;
  outdated: boolean;
  /** Response-level consultation of a failed/abstained estimate; nothing shown when absent. */
  consultation?: MedicalConsultationMeta;
}

function NotComputed({ message, outdated, consultation }: NotComputedProps) {
  return (
    <div className={styles.absent}>
      <p className={styles.value}>
        <span aria-hidden="true">—</span>
        <span className={styles.outOf}>{AI_SCORE_NOT_COMPUTED}</span>
      </p>
      {outdated ? <p className={styles.note}>L’estimation précédente ne correspond plus au dossier actuel.</p> : null}
      {message ? <p className={styles.note}>{message}</p> : null}
      <ConsultationProvenance consultation={consultation} />
    </div>
  );
}

function CardBody({ state, record }: { state: AiScoreCardState; record: PatientRecord }) {
  switch (state.kind) {
    case "loading":
      return <Skeleton height={56} radius={4} />;
    case "busy":
      return <Spinner label="Calcul de l’estimation IA en cours (jusqu’à 45 s)" />;
    case "score":
      return <AiScoreDetails score={state.score} cached={state.cached} record={record} />;
    case "stale":
      return <NotComputed message="Le dossier a changé depuis cette estimation : le chiffre est masqué jusqu’à une nouvelle estimation." outdated={false} />;
    case "absent":
      return <NotComputed message={state.message} outdated={state.outdated} consultation={state.consultation} />;
    case "error":
      return <NotComputed message={state.message} outdated={false} />;
    default:
      return null;
  }
}

/** Mount with `key={patientId}` so no request state or note leaks between patients. */
export function AiCaseScoreCard({ patientId, record }: { patientId: string; record: PatientRecord }) {
  const titleId = useId();
  const eligible = aiCaseScoreEligible(record.access);
  const read = useScoreRead(patientId, eligible);
  const { request, requesting, failure, error } = useScoreRequest(patientId, {
    apply: read.apply,
    revisionKey: guardKey(record.guard),
    lastReadAt: read.lastSuccessAt,
  });
  const hadScore = useRef(false);

  const state = aiScoreCardState({
    eligible,
    denied: read.denied,
    data: read.data,
    readError: read.error && !read.data ? describeApiError(read.error, "fr").title : null,
    requesting,
    requestFailure: failure?.reason ?? null,
    requestConsultation: failure?.consultation ?? null,
    requestError: error,
    recordGuard: record.guard,
    hadScore: hadScore.current,
  });
  const showsScore = state.kind === "score";
  useEffect(() => {
    if (showsScore) hadScore.current = true;
  }, [showsScore]);
  if (state.kind === "hidden") return null;

  return (
    <section className={styles.card} aria-labelledby={titleId} aria-busy={state.kind === "busy" || undefined}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {AI_SCORE_LABEL}
        </h2>
        <Badge tone="outline" icon="help-circle">
          Expérimental
        </Badge>
      </div>
      <p className={styles.disclaimer}>{DISCLAIMER}</p>
      <div aria-live="polite">
        <CardBody state={state} record={record} />
      </div>
      <div className={styles.actions}>
        <RequestButton state={state} onRequest={() => void request()} />
      </div>
    </section>
  );
}
