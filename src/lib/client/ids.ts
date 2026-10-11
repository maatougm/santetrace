/**
 * Idempotency keys for measurements and reminder self-reports. Generate once
 * per user action and reuse the same value on every replay.
 */
export function createClientId(prefix = "web"): string {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("Secure random generator unavailable: cannot create an idempotency key.");
}
