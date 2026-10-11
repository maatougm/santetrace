/**
 * What a clinician is told after a decision attempt. Only server answers are
 * reported as done; conflicts keep the server's reason; a result dropped by the
 * access fence is said to be dropped (it may still have been recorded).
 */
import { describeApiError, toApiError } from "@/lib/client/transport";
import { IDEMPOTENCY_CONFLICT } from "./idempotency";

export interface Outcome {
  ok: boolean;
  text: string;
}

export const DISCARDED_OUTCOME: Outcome = {
  ok: false,
  text: "Résultat écarté : l’accès au dossier a changé pendant l’envoi. Vérifiez l’état actualisé avant de recommencer ; l’action a pu être enregistrée.",
};

export type ConflictKind = "replay" | "stale" | "other";

export function classifyConflict(error: unknown): { kind: ConflictKind; text: string } {
  const apiError = toApiError(error);
  if (!apiError.isConflict) return { kind: "other", text: describeApiError(apiError, "fr").message };
  if (apiError.code === IDEMPOTENCY_CONFLICT) {
    return {
      kind: "replay",
      text: "Une tentative précédente a été envoyée avec d’autres valeurs et a peut-être été enregistrée. Vérifiez l’état actualisé avant de recommencer.",
    };
  }
  return { kind: "stale", text: `${describeApiError(apiError, "fr").message} Rien n’a été enregistré pour cette tentative.` };
}
