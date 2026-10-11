"use client";

/**
 * Inline, neutral failure for a patient action: what failed and the machine
 * code. Nothing is shown as done; the caller keeps the user's input.
 */
import { Notice } from "@/components/ui";
import { describeApiError, type ApiError, type Language } from "@/lib/client/transport";
import { Ltr } from "../bits";

export function ApiErrorNotice({ error, lang }: { error: ApiError; lang: Language }) {
  const description = describeApiError(error, lang);
  return (
    <Notice tone="neutral" icon="alert-triangle" title={description.title} role="alert">
      {description.message} <Ltr>({description.code})</Ltr>
    </Notice>
  );
}
