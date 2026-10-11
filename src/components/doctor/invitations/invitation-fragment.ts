/**
 * Doctor invitation token handling. The patient's link carries the one-time
 * token in the URL fragment (never sent to the server by navigation). The
 * page reads it once into memory, strips it from the address at once, and
 * only accepts after an explicit click. Nothing here touches storage.
 */
import { INVITATION_FRAGMENT_KEY, type DoctorInvitationSummary } from "@/lib/client/grants-api";
import { describeApiError, toApiError } from "@/lib/client/transport";

export const INVITATION_TOKEN_MAX = 512;

export interface FragmentRead {
  /** The invitation key was in the fragment (strip it, even when unusable). */
  present: boolean;
  /** Usable token, or null when absent, empty or malformed. */
  token: string | null;
  /** Fragment to keep in the address: other parts only, "" when none. */
  remainingHash: string;
}

/** Trimmed token, or null when empty, spaced, controlled or oversized. */
export function normalizeInvitationToken(raw: string): string | null {
  const token = raw.trim();
  if (!token || token.length > INVITATION_TOKEN_MAX) return null;
  return /[\s\u0000-\u001f\u007f]/.test(token) ? null : token;
}

function decodeToken(encoded: string): string | null {
  try {
    return normalizeInvitationToken(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

export function readInvitationFragment(hash: string): FragmentRead {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const prefix = `${INVITATION_FRAGMENT_KEY}=`;
  const parts = body ? body.split("&") : [];
  const invitationParts = parts.filter((part) => part === INVITATION_FRAGMENT_KEY || part.startsWith(prefix));
  if (invitationParts.length === 0) return { present: false, token: null, remainingHash: hash };
  const kept = parts.filter((part) => !invitationParts.includes(part) && part !== "");
  const first = invitationParts[0];
  return {
    present: true,
    token: first.startsWith(prefix) ? decodeToken(first.slice(prefix.length)) : null,
    remainingHash: kept.length > 0 ? `#${kept.join("&")}` : "",
  };
}

/** Same words whatever the refusal reason, so the page reveals nothing about other doctors. */
export const INVITATION_REFUSED =
  "Invitation non acceptée : elle est invalide, expirée, déjà utilisée ou destinée à un autre médecin. Demandez au patient de vous en envoyer une nouvelle.";

/** Session expiry and rate limiting are not refusals of this invitation. */
const NOT_A_REFUSAL = new Set([401, 429]);

export function invitationAcceptError(error: unknown): string {
  const apiError = toApiError(error);
  const { status } = apiError;
  if (apiError.kind === "http" && !apiError.isUnavailable && status >= 400 && status < 500 && !NOT_A_REFUSAL.has(status)) {
    return INVITATION_REFUSED;
  }
  const description = describeApiError(apiError, "fr");
  // Server messages are not echoed here: they could name the intended doctor.
  return `${description.title}. Rien n’a été accepté ; vous pouvez réessayer avec le même code.`;
}

export type InvitationDisplayState = DoctorInvitationSummary["state"] | "expired";

/** A pending invitation past its expiry cannot be accepted any more. */
export function invitationDisplayState(summary: DoctorInvitationSummary, nowMs: number): InvitationDisplayState {
  if (summary.state !== "pending") return summary.state;
  const expires = Date.parse(summary.expiresAt);
  return !Number.isNaN(expires) && expires <= nowMs ? "expired" : "pending";
}
