"use client";

import { ErrorState } from "@/components/ui";
import { describeApiError } from "@/lib/client/api";

interface ApiErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
  /** Optional override when the default title is too generic for the context. */
  title?: string;
}

/** ErrorState fed by describeApiError: honest title, message and machine code. */
export function ApiErrorState({ error, onRetry, compact, title }: ApiErrorStateProps) {
  const description = describeApiError(error, "fr");
  return (
    <ErrorState
      title={title ?? description.title}
      message={description.message}
      code={description.code}
      onRetry={onRetry}
      retryLabel="Réessayer"
      compact={compact}
    />
  );
}

/** One-line inline error for forms and actions (role=alert via the caller's Notice). */
export function errorText(error: unknown): string {
  const description = describeApiError(error, "fr");
  return `${description.title} — ${description.message}`;
}
