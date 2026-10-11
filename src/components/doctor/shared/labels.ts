/**
 * French copy for clinician screens. Labels describe recorded states only; they
 * never add clinical interpretation on top of what the server returned.
 */
import type { Alert, Candidate, CareDocument, Reminder } from "@/lib/client/api";

export const DEMO_RULE_LABEL = "règle de démonstration non validée";

export const ALERT_STATUS_LABEL: Record<Alert["status"], string> = {
  new: "Nouvelle",
  acknowledged: "Réception accusée",
  resolved: "Résolue",
  rejected: "Rejetée",
};

export const ALERT_ACTION_LABEL: Record<string, string> = {
  acknowledge: "Réception accusée",
  resolve: "Résolue",
  reject: "Rejetée",
};

export const PRIORITY_LABEL: Record<Alert["priority"], string> = {
  red: "Priorité haute",
  orange: "Suivi requis",
};

export const DOCUMENT_STATUS_LABEL: Record<CareDocument["status"], string> = {
  processing: "Extraction en cours",
  review: "À revoir",
  needs_manual_review: "Revue manuelle requise",
  reviewed: "Revu",
  failed: "Échec de l’extraction",
};

export const CANDIDATE_STATUS_LABEL: Record<Candidate["status"], string> = {
  proposed: "Proposé — non confirmé",
  confirmed: "Confirmé",
  rejected: "Rejeté",
};

export const CONFIDENCE_LABEL: Record<Candidate["confidence"], string> = {
  high: "Indices concordants",
  medium: "Indices partiels",
  low: "Indices insuffisants",
};

export const IDENTITY_LABEL: Record<Candidate["identityMatch"], string> = {
  matched: "Nom du patient retrouvé dans la source",
  unknown: "Identité non retrouvée dans la source",
  mismatch: "Identité discordante dans la source",
};

export const DELIVERY_LABEL: Record<Reminder["delivery"], string> = {
  pending: "Envoi en attente",
  sent: "Envoyé",
  failed: "Échec d’envoi",
  local: "Local (aucun fournisseur d’envoi)",
};

export const LANGUAGE_LABEL: Record<"fr" | "ar", string> = {
  fr: "Français",
  ar: "Arabe",
};

export function selfReportLabel(reminder: Pick<Reminder, "taken">): string {
  if (reminder.taken === true) return "Pris (déclaré par le patient)";
  if (reminder.taken === false) return "Non pris (déclaré par le patient)";
  return "Non déclaré";
}

/** Short, still unambiguous rule version for dense rows (full value in title). */
export function shortVersion(version: string): string {
  return version.length > 16 ? `${version.slice(0, 13)}…` : version;
}
