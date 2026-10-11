/** Id of the hint element rendered by <Field htmlFor={htmlFor}>. */
export function hintId(htmlFor: string): string {
  return `${htmlFor}-hint`;
}

/** Id of the error element rendered by <Field htmlFor={htmlFor}>. */
export function errorId(htmlFor: string): string {
  return `${htmlFor}-error`;
}

export interface DescribedByOptions {
  hint?: unknown;
  error?: unknown;
}

/**
 * Builds the aria-describedby value for a control inside <Field>. Pass the
 * same hint/error you pass to Field; empty values are skipped.
 *
 *   <TextInput id="sys" aria-describedby={describedBy("sys", { hint, error })} invalid={!!error} />
 */
export function describedBy(htmlFor: string, { hint, error }: DescribedByOptions = {}): string | undefined {
  const ids = [hint ? hintId(htmlFor) : null, error ? errorId(htmlFor) : null].filter(
    (value): value is string => value !== null,
  );
  return ids.length > 0 ? ids.join(" ") : undefined;
}
