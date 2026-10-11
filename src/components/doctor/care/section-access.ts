/**
 * What a clinician may do in a section, from the server's AccessEnvelope.
 * The server enforces every rule; these decisions only hide controls the
 * server would refuse, and keep reads for clinicians allowed to read.
 */
import type { Candidate } from "@/contracts/care";
import type { AccessEnvelope, SharingScope } from "@/contracts/patient-platform";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";

export const LAB_REVIEW_RESERVED = "Revue des analyses réservée au médecin référent : consultation seule pour ce compte.";

export interface DocumentPermissions {
  canRead: boolean;
  /** Upload is a care-management act (primary referent). */
  canUpload: boolean;
  /** Confirm/reject candidates and correct observations. */
  canReviewLabs: boolean;
}

function hasScope(access: Pick<AccessEnvelope, "owner" | "scopes">, scope: SharingScope): boolean {
  return access.owner || access.scopes.includes(scope);
}

export function documentPermissions(access: AccessEnvelope): DocumentPermissions {
  return { canRead: hasScope(access, "documents"), canUpload: access.canManageCare, canReviewLabs: access.canReviewLabs };
}

/** Review controls for one extracted value: decide when proposed, correct when confirmed. */
export function labReviewControls(
  status: Candidate["status"],
  permissions: Pick<DocumentPermissions, "canReviewLabs">,
): { review: boolean; correct: boolean; note: string | null } {
  if (!permissions.canReviewLabs) {
    return { review: false, correct: false, note: status === "rejected" ? null : LAB_REVIEW_RESERVED };
  }
  return { review: status === "proposed", correct: status === "confirmed", note: null };
}

/** Protocol source history is a composite read: summary needs status, measurements, clinical and documents. */
const PROTOCOL_SCOPES: readonly SharingScope[] = ["status", "measurements", "clinical", "documents", "summary"];

export function protocolsScopeGate(access: Pick<AccessEnvelope, "owner" | "scopes">): { allowed: boolean; missing: SharingScope[] } {
  const missing = PROTOCOL_SCOPES.filter((scope) => !hasScope(access, scope));
  return { allowed: missing.length === 0, missing };
}

/**
 * One-shot mutation whose result changes the shared record: applied only when
 * the fence is still current (`apply` should be the fence-bound record apply).
 */
export async function applyWhenCurrent<T>(
  fence: AccessFence,
  work: () => Promise<T>,
  apply: (value: T) => void,
): Promise<{ status: "applied"; value: T } | { status: "discarded" }> {
  const result = await runFenced(fence, work);
  if (result.status === "stale") return { status: "discarded" };
  apply(result.value);
  return { status: "applied", value: result.value };
}
