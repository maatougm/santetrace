/**
 * Authorized source search (feature 006, lot D3). Hits are permitted source
 * excerpts; a reference hit is never a patient fact or an approved instruction.
 */
import type { SearchHit, SearchResponse } from "@/contracts/monitoring";
import { aiOptions, request, seg, type RequestOptions } from "./transport";

export type { SearchHit, SearchResponse };

export const SEARCH_QUERY_MAX = 500;

export function searchRecord(
  patientId: string,
  input: { query: string; clientId: string },
  options?: RequestOptions,
): Promise<SearchResponse> {
  return request<SearchResponse>(`/patients/${seg(patientId)}/search`, {
    ...aiOptions(options),
    method: "POST",
    json: input,
    expect: ["hits", "noEvidence", "mode"],
  });
}

export function isReferenceHit(hit: SearchHit): boolean {
  return hit.source.kind === "reference" || hit.source.verification === "reference";
}
