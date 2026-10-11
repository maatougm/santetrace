"use client";

import type { CSSProperties } from "react";
import { ErrorState } from "@/components/ui";
import { useClinicianLanguage } from "@/components/layout/ClinicianLanguage";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import { describeApiError, type Language } from "@/lib/client/api";
import { directionFor } from "@/lib/client/document-language";
import { FRESHNESS_COPY } from "../dashboard/dashboard-copy";

/**
 * Box-less root (no layout box, no role) that declares the language/direction
 * of localized system copy, so it stays correct even inside a known-French
 * clinical island (record panel). Inline on purpose: independent of CSS chunk order.
 */
const BOX_LESS: CSSProperties = Object.freeze({ display: "contents" });

export function selectedLanguageRoot(language: Language): { lang: Language; dir: "ltr" | "rtl"; style: CSSProperties } {
  return { lang: language, dir: directionFor(language), style: BOX_LESS };
}

interface ApiErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  /** Optional override when the default title is too generic for the context. */
  title?: string;
  /** Defaults to the clinician shell language (French outside the shell). */
  lang?: Language;
}

/** ErrorState fed by describeApiError: honest title, message and machine code. */
export function ApiErrorState({ error, onRetry, compact, title, lang }: ApiErrorStateProps) {
  const shell = useClinicianLanguage();
  const language = lang ?? shell.lang;
  const description = describeApiError(error, language);
  const copy = FRESHNESS_COPY[language];
  return (
    <div {...selectedLanguageRoot(language)}>
      <ErrorState
        // A caller's override title is written by that caller: its language is not the selected one by default.
        title={title !== undefined ? <span {...UNKNOWN_LANGUAGE_TEXT}>{title}</span> : description.title}
        message={description.message}
        code={description.code}
        onRetry={onRetry}
        retryLabel={copy.retry}
        codeLabel={copy.errorCode}
        compact={compact}
      />
    </div>
  );
}

/** One-line inline error for forms and actions (role=alert via the caller's Notice). */
export function errorText(error: unknown, lang: Language = "fr"): string {
  const description = describeApiError(error, lang);
  return `${description.title} — ${description.message}`;
}
