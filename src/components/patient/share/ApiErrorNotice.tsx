"use client";

import { Notice } from "@/components/ui";
import { describeApiError, type ApiError, type Language } from "@/lib/client/transport";
import { Ltr } from "../bits";

/** Inline, neutral failure of one action: what failed, the machine code, nothing invented. */
export function ApiErrorNotice({ error, lang }: { error: ApiError; lang: Language }) {
  const description = describeApiError(error, lang);
  return (
    <Notice tone="neutral" icon="x-circle" title={description.title} role="alert">
      {description.message} <Ltr>({description.code})</Ltr>
    </Notice>
  );
}
