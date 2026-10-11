/**
 * Medical-consultation provenance: pure view model (clinician UI, French only).
 *
 * Only what the server genuinely returned is described. Metadata is re-validated
 * here, so a missing or malformed value yields `null` and the UI makes no
 * specialist claim at all. "Consulté" is said only for the `consulted` status;
 * a configured feature or a model ID is never evidence of use. Model names are
 * never hardcoded: only the returned strings are shown, verbatim.
 */
import type { IconName } from "@/components/ui/contract";
import type { MedicalConsultationMeta } from "@/contracts/medical-consultation";
import { CARE_COPY } from "@/lib/client/copy/care";
import { parseConsultationMeta } from "@/lib/client/doctor-api";

export const CONSULTATION_DISCLAIMER =
  "Sélection de sources expérimentale, à vérifier : ce n’est ni une certification, ni un diagnostic, ni une autorité de traitement.";

export type ConsultationView = {
  status: MedicalConsultationMeta["status"];
  /** Decorative glyph next to the text; meaning is always carried by the words. */
  icon: IconName;
  title: string;
  details: string[];
  /** Returned identifiers, shown verbatim; only when the specialist was actually consulted. */
  models: { specialist: string; brain: string } | null;
  disclaimer: string;
};

const TITLES: Readonly<Record<MedicalConsultationMeta["status"], { icon: IconName; title: string }>> = {
  consulted: { icon: "stethoscope", title: "Spécialiste médical consulté" },
  unavailable: { icon: "x-circle", title: "Spécialiste indisponible — repli sur le modèle principal seul" },
  skipped: { icon: "minus", title: "Spécialiste non utilisé (aucune donnée admise adaptée)" },
};

function detailsOf(meta: MedicalConsultationMeta): string[] {
  if (meta.status === "consulted") return [`${meta.sourceCount} source(s) sélectionnée(s)`];
  if (meta.status === "unavailable" && meta.failureReason) return [`Motif : ${CARE_COPY.fr.aiFailure[meta.failureReason]}`];
  return [];
}

/** View of untrusted consultation metadata, or null when there is nothing honest to say. */
export function consultationView(value: unknown): ConsultationView | null {
  const meta = parseConsultationMeta(value);
  if (!meta) return null;
  return {
    status: meta.status,
    ...TITLES[meta.status],
    details: detailsOf(meta),
    models: meta.status === "consulted" ? { specialist: meta.specialistModel, brain: meta.brainModel } : null,
    disclaimer: CONSULTATION_DISCLAIMER,
  };
}
