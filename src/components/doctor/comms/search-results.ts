/**
 * Record search result shaping. Hits are shown as the server returned them;
 * reference hits are kept apart from patient sources, and a source link is
 * built only from the ids the hit itself carries (never guessed from the
 * record or from model text).
 */
import { SEARCH_QUERY_MAX, isReferenceHit, type SearchHit } from "@/lib/client/search-api";
import { reviewHref } from "../shared/routes";

export interface HitPartition {
  patient: SearchHit[];
  reference: SearchHit[];
}

/** Keeps server order inside each group. */
export function partitionHits(hits: readonly SearchHit[]): HitPartition {
  return {
    patient: hits.filter((hit) => !isReferenceHit(hit)),
    reference: hits.filter((hit) => isReferenceHit(hit)),
  };
}

export type HitLabel = "reference" | "external_note" | "patient";

/**
 * Badge family of a hit. References win (kept apart, never a patient source);
 * external notes stay in the patient's record but are declared, unverified.
 */
export function hitLabel(hit: SearchHit): HitLabel {
  if (isReferenceHit(hit)) return "reference";
  const { kind, verification } = hit.source;
  return kind === "external_note" || verification === "external_unverified" ? "external_note" : "patient";
}

export interface SourceLink {
  href: string;
  /** Page named by the hit, when it is a positive integer. */
  page: number | null;
}

/** Link to the document review view for a patient source; null when the hit names no document. */
export function hitSourceLink(patientId: string, hit: SearchHit): SourceLink | null {
  if (isReferenceHit(hit)) return null;
  const { documentId, page, kind, id } = hit.source;
  if (typeof documentId !== "string" || documentId === "") return null;
  const candidateId = kind === "candidate" && id ? id : undefined;
  return {
    href: reviewHref(patientId, documentId, candidateId),
    page: typeof page === "number" && Number.isInteger(page) && page > 0 ? page : null,
  };
}

export type QueryProblem = "empty" | "too_long";

export function normalizeSearchQuery(text: string): { query: string; error: QueryProblem | null } {
  const query = text.trim();
  if (!query) return { query, error: "empty" };
  return { query, error: query.length > SEARCH_QUERY_MAX ? "too_long" : null };
}

const SCORE_FORMAT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Similarity score text (demonstration parameter), or null when absent. */
export function formatScore(score: number | null): string | null {
  return typeof score === "number" && Number.isFinite(score) ? SCORE_FORMAT.format(score) : null;
}
