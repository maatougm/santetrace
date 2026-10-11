/**
 * Sourced clinician report (spec 006 story 5, FR-015). Claims are grouped by
 * category; hypotheses get their own clinician-only block. Sources are looked
 * up by id in the server's own `report.sources`: an id the report does not
 * carry is reported missing, never reconstructed.
 */
import type { AiMeta, ClinicianReport, GroundedClaim, Polarity, SourceRef } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";

type FactCategory = Exclude<GroundedClaim["category"], "hypothesis">;

export const CLAIM_GROUP_ORDER: readonly FactCategory[] = [
  "confirmed_fact",
  "patient_statement",
  "candidate",
  "change",
  "contradiction",
  "missing",
];

export interface ClaimGroup {
  category: FactCategory;
  claims: GroundedClaim[];
}

export function groupClaims(claims: readonly GroundedClaim[]): { groups: ClaimGroup[]; hypotheses: GroundedClaim[] } {
  const groups = CLAIM_GROUP_ORDER.map((category) => ({ category, claims: claims.filter((c) => c.category === category) })).filter(
    (group) => group.claims.length > 0,
  );
  return { groups, hypotheses: claims.filter((c) => c.category === "hypothesis") };
}

export function resolveClaimSources(
  claim: Pick<GroundedClaim, "sourceIds">,
  sources: readonly SourceRef[],
): { found: SourceRef[]; missingIds: string[] } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ids = [...new Set(claim.sourceIds)];
  return {
    found: ids.flatMap((id) => {
      const match = byId.get(id);
      return match ? [match] : [];
    }),
    missingIds: ids.filter((id) => !byId.has(id)),
  };
}

const POLARITY_LABEL: Readonly<Record<string, string>> = CARE_COPY.fr.polarity;

function isPolarity(value: unknown): value is Polarity {
  return typeof value === "string" && Object.hasOwn(POLARITY_LABEL, value);
}

/** Validated parameters as plain text pairs (rendered as text, never as HTML). */
export function claimParameterRows(parameters: Readonly<Record<string, string | number | boolean>>): { key: string; value: string }[] {
  return Object.entries(parameters).map(([key, value]) => {
    if (key === "polarity" && isPolarity(value)) return { key, value: POLARITY_LABEL[value] };
    if (typeof value === "boolean") return { key, value: value ? "Oui" : "Non" };
    return { key, value: String(value) };
  });
}

export function isReportStale(report: Pick<ClinicianReport, "stale">, meta: Pick<AiMeta, "stale">): boolean {
  return report.stale || meta.stale;
}
