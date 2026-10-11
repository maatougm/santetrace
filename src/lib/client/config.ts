/**
 * Public, non-secret frontend configuration.
 *
 * Doctor passwords live only in server env (DEMO_CLINICIAN_PASSWORD,
 * DEMO_GENERALIST_PASSWORD, DEMO_SPECIALIST_PASSWORD). The sign-in screen may
 * list the fictional doctor logins in development so a demo operator knows
 * which accounts exist; it never shows or suggests a password. Set
 * NEXT_PUBLIC_DEMO_CLINICIAN_LOGINS to "" to hide them, or to a comma list.
 */
const configuredLogins = process.env.NEXT_PUBLIC_DEMO_CLINICIAN_LOGINS;

export const DEMO_CLINICIAN_LOGINS: readonly string[] =
  configuredLogins !== undefined
    ? configuredLogins
        .split(",")
        .map((login) => login.trim())
        .filter(Boolean)
    : process.env.NODE_ENV !== "production"
      ? ["medecin.ref", "medecin.general", "medecin.specialiste"]
      : [];

/** Fragment keys accepted for an operator-issued claim code (fragments never reach the server). */
export const CLAIM_FRAGMENT_KEYS = ["claim", "code"] as const;

/** Reads a claim code from a URL fragment ("#claim=…"). Null when absent. */
export function readClaimCode(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  for (const key of CLAIM_FRAGMENT_KEYS) {
    const value = params.get(key)?.trim();
    if (value) return value.slice(0, 512);
  }
  return null;
}
