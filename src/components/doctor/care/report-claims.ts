/**
 * Sourced clinician report (spec 006 story 5, FR-015). Claims are grouped by
 * category; hypotheses get their own clinician-only block. Sources are looked
 * up by id in the server's own `report.sources`: an id the report does not
 * carry is reported missing, never reconstructed.
 */
import { formatTimestamp } from "@/components/ui/timestamp-format";
import type { AiMeta, ClinicianReport, GroundedClaim, SourceRef } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";
import { measurementKindLabel } from "@/lib/client/format";

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

type ParameterValue = string | number | boolean;
type Vocabulary = Readonly<Record<string, string>>;

const copy = CARE_COPY.fr;

/** Parameter names the server renders (medical-evidence renderGroundedClaims). */
const PARAMETER_LABEL: Vocabulary = {
  polarity: copy.record.polarityLabel,
  label: copy.record.labelLabel,
  code: "Code du registre",
  value: "Valeur",
  kind: "Type",
  unit: "Unité",
  measuredAt: "Mesurée le",
  systolic: "Systolique",
  diastolic: "Diastolique",
  date: "Date",
  exam: "Examen",
  verification: "Vérification",
  note: "Note",
  labelKey: "Libellé du registre",
  referenceVersion: "Version de référence",
};

const MEASUREMENT_KIND: Vocabulary = {
  blood_pressure: measurementKindLabel("blood_pressure"),
  glucose: measurementKindLabel("glucose"),
  pulse: measurementKindLabel("pulse"),
};

/** Registry tokens of fact codes and labels: condition names, and "declared" (patient declaration without a condition code). */
const FACT_CODE: Vocabulary = { ...copy.factCode, declared: copy.verification.patient_reported };

/**
 * Registry label keys the server emits (medical-evidence renderGroundedClaims):
 * only "hypothesis.review_required", on every hypothesis_review claim. Any other
 * label key stays exactly as sent.
 */
const LABEL_KEY: Vocabulary = { "hypothesis.review_required": copy.claimCode.hypothesis_review };

/** Exact ISO-8601 date, or date-time with an explicit zone; the calendar day must exist (no Feb 31 rollover). */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;

/** Clinician date (Africa/Tunis, as fmtDateTime). A date gets no invented hour; a time is always shown, so a zone shift stays visible. */
function formatIsoDate(value: string): string | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  // setUTCFullYear, not Date.UTC: the day check uses the real year, not 1900 + year for years 0–99.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month || calendar.getUTCDate() !== day) return null;
  return formatTimestamp(value, "fr", match[4] === undefined ? "date" : "datetime");
}

function lookup(vocabulary: Vocabulary, value: string): string | null {
  return Object.hasOwn(vocabulary, value) ? vocabulary[value] : null;
}

/** Display of a known token in a known key; null keeps the recorded value. Free text and numbers are never mapped. */
function knownValue(key: string, value: string, parameters: Readonly<Record<string, ParameterValue>>): string | null {
  switch (key) {
    case "polarity":
      return lookup(copy.polarity, value);
    case "verification":
      return lookup(copy.verification, value);
    case "kind":
      return lookup(MEASUREMENT_KIND, value);
    case "code":
      return lookup(FACT_CODE, value);
    // As factDisplayLabel: a registry code stored as the label, or "declared"; a typed label stays as written.
    case "label":
      return value === "declared" || value === parameters.code ? lookup(FACT_CODE, value) : null;
    case "labelKey":
      return lookup(LABEL_KEY, value);
    case "measuredAt":
    case "date":
      return formatIsoDate(value);
    default:
      return null;
  }
}

export interface ClaimParameterRow {
  /** Server key, stable for React keys. */
  key: string;
  /** French name of the key; an unknown key is shown as sent. */
  label: string;
  value: string;
}

/**
 * Validated parameters as plain text rows (rendered as text, never as HTML).
 * Unknown keys and values stay visible as sent; numbers keep their exact
 * precision and units are never converted.
 */
export function claimParameterRows(parameters: Readonly<Record<string, ParameterValue>>): ClaimParameterRow[] {
  return Object.entries(parameters).map(([key, raw]) => {
    const known = typeof raw === "string" ? knownValue(key, raw, parameters) : null;
    const value = known ?? (typeof raw === "boolean" ? (raw ? "Oui" : "Non") : String(raw));
    const measured = key === "kind" && known !== null;
    return { key, label: measured ? "Type de mesure" : (lookup(PARAMETER_LABEL, key) ?? key), value };
  });
}

export function isReportStale(report: Pick<ClinicianReport, "stale">, meta: Pick<AiMeta, "stale">): boolean {
  return report.stale || meta.stale;
}
