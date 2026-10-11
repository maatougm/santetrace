"use client";

/**
 * No accepted referent (spec 006 FR-027): the record stays usable, but no
 * monitoring, approval or transmission happens. Never implies a care team.
 */
import { LinkButton, Notice } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";

export function NoReferentNotice({ lang }: { lang: Language }) {
  const copy = CARE_COPY[lang].noReferent;
  return (
    <Notice
      tone="neutral"
      icon="user-plus"
      title={copy.title}
      action={
        <LinkButton href="/patient/doctors" variant="secondary" iconStart="user-plus">
          {copy.action}
        </LinkButton>
      }
    >
      {copy.body}
    </Notice>
  );
}
