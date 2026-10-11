"use client";

/**
 * Fixed emergency guidance (190, SAMU) shown next to symptom questions and
 * symptom facts. Static copy, no AI; it says the app alerts no one by itself.
 */
import { Notice } from "@/components/ui";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";

export function EmergencyLine({ lang }: { lang: Language }) {
  return (
    <Notice tone="info" icon="alert-triangle" role="note">
      {CARE_COPY[lang].onboarding.emergencyLine}
    </Notice>
  );
}
