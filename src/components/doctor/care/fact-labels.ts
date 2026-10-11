/**
 * Fact names in clinician views. Onboarding stores registry codes as labels
 * ("hypertension", "declared"); the shared factDisplayLabel turns known codes
 * into French names and "declared" into the fact kind, keeps typed labels and
 * never guesses unknown codes. Display only: stored values and ids are untouched.
 */
import type { MedicalFact } from "@/contracts/monitoring";
import { factDisplayLabel } from "@/lib/client/copy/care";

export function factLabel(fact: Pick<MedicalFact, "kind" | "code" | "label">): string {
  return factDisplayLabel(fact, "fr");
}

/** Display label of the fact with this id, or null when the visible record does not carry it. */
export function factLabelById(facts: readonly MedicalFact[], id: string): string | null {
  const fact = facts.find((f) => f.id === id);
  return fact ? factLabel(fact) : null;
}
