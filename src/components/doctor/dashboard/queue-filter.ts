/**
 * Client-side search and quick filters over the clinician queue. Pure: rows
 * keep the order produced by buildPatientQueue (filter only, never re-sort),
 * and every count is computed from the same rows the filter would show.
 */
import { priorityDisplay, type QueueRow } from "./queue";

export const QUEUE_FILTERS = ["all", "red", "orange", "pending", "review"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];
export type QueueFilterCounts = Readonly<Record<QueueFilter, number>>;

export interface QueueQuery {
  filter: QueueFilter;
  search: string;
}

/** Lower-case, accent-free, single-spaced text ("  Hédi  BEN " → "hedi ben"). */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[‘’]/g, "'")
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ")
    .trim();
}

function searchWords(search: string): string[] {
  const normalized = normalizeSearchText(search);
  return normalized ? normalized.split(" ") : [];
}

function nameMatches(row: Pick<QueueRow, "patient">, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const name = normalizeSearchText(row.patient.displayName);
  return words.every((word) => name.includes(word));
}

/**
 * Whether a row belongs to a quick filter. Uses the displayed priority (open
 * alerts raise it, an unsupported green is capped to unknown), never the raw
 * server value. "review" = displayed unknown or a status the patient did not share.
 */
export function matchesFilter(row: QueueRow, filter: QueueFilter): boolean {
  const display = priorityDisplay(row);
  switch (filter) {
    case "all":
      return true;
    case "red":
      return display.status === "red";
    case "orange":
      return display.status === "orange";
    case "pending":
      return row.pendingWork;
    case "review":
      return display.status === "unknown" || !display.monitoringShared;
  }
}

/** Rows matching the search and the filter, in their original order. */
export function filterQueue(rows: readonly QueueRow[], { filter, search }: QueueQuery): QueueRow[] {
  const words = searchWords(search);
  return rows.filter((row) => nameMatches(row, words) && matchesFilter(row, filter));
}

/** True per-filter counts over the rows matching the current search. */
export function queueFilterCounts(rows: readonly QueueRow[], search = ""): QueueFilterCounts {
  const words = searchWords(search);
  const searched = rows.filter((row) => nameMatches(row, words));
  const count = (filter: QueueFilter): number => searched.filter((row) => matchesFilter(row, filter)).length;
  return { all: count("all"), red: count("red"), orange: count("orange"), pending: count("pending"), review: count("review") };
}
