/**
 * Idempotency keys for clinician decisions. A retry of the identical payload
 * reuses its key (the server replays the first answer); an edited payload gets
 * a new key, because the server refuses a known key with a different body
 * (409 IDEMPOTENCY_CONFLICT) and that must never look like a record change.
 */
export interface Attempt {
  fingerprint: string;
  clientId: string;
}

/** Payload identity without its key. Builders emit fields in a fixed order. */
export function fingerprintOf(input: { readonly clientId: string }): string {
  return JSON.stringify({ ...input, clientId: null });
}

export function nextAttempt<T extends { readonly clientId: string }>(last: Attempt | null, input: T, create: () => string): Attempt {
  const fingerprint = fingerprintOf(input);
  return last && last.fingerprint === fingerprint ? last : { fingerprint, clientId: create() };
}

export const IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT";
