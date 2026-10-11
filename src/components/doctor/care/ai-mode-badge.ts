/**
 * One badge look per AI provenance, never shared: fixed rules (muted sliders),
 * local model (activity), remote cloud service (wifi). Labels come from the
 * shared copy (CARE_COPY.aiMode); no local-processing or clinical-validation
 * claim is made here.
 */
import type { BadgeTone, IconName } from "@/components/ui/contract";
import type { AiMeta } from "@/contracts/monitoring";
import { CARE_COPY } from "@/lib/client/copy/care";

export const AI_MODE_BADGE: Readonly<Record<AiMeta["mode"], { tone: BadgeTone; icon: IconName }>> = {
  local_model: { tone: "outline", icon: "activity" },
  cloud_model: { tone: "outline", icon: "wifi" },
  deterministic: { tone: "muted", icon: "sliders" },
};

function isKnownMode(mode: string): mode is AiMeta["mode"] {
  return Object.hasOwn(AI_MODE_BADGE, mode);
}

/**
 * Badge for a mode received from the server. API data is external: a mode
 * outside the contract gets no badge (null), never a guessed label or the
 * fixed-rules look.
 */
export function aiModeBadge(mode: string): { tone: BadgeTone; icon: IconName; label: string } | null {
  if (!isKnownMode(mode)) return null;
  return { ...AI_MODE_BADGE[mode], label: CARE_COPY.fr.aiMode[mode] };
}
