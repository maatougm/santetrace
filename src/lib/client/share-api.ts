/**
 * One-use external consultation (feature 006, lot D1/D4).
 *
 * Owner side: issue a frozen selection, list, revoke. The link secret is in
 * the URL fragment, shown once, never stored.
 * Guest side: explicit redemption (POST) opens a distinct guest session
 * cookie; record/notes/PDF reads are checked live by the server, which answers
 * every inaccessible link or session with the same 404 VISIT_UNAVAILABLE.
 * Guest data lives in component memory only.
 */
import type {
  ExternalNote,
  ExternalVisitGrant,
  GuestNoteInput,
  GuestRecord,
  GuestSelection,
  GuestVisit,
  VisitIssueResult,
  VisitRedeemInput,
  VisitSelectionInput,
  VisitSelectionRef,
} from "@/contracts/external-visit";
import { API_BASE, request, seg, type ApiError, type RequestOptions } from "./transport";

export type {
  ExternalNote,
  GuestNoteInput,
  GuestRecord,
  GuestSelection,
  GuestVisit,
  VisitIssueResult,
  VisitRedeemInput,
  VisitSelectionInput,
  VisitSelectionRef,
};

/** Owner view of a share grant: no token hash, no frozen projection. */
export type OwnerVisitGrant = VisitIssueResult["grant"];

export const VISIT_UNAVAILABLE = "VISIT_UNAVAILABLE";

export const GUEST_LIMITS = {
  declaredNameMax: 100,
  organizationMax: 100,
  noteMax: 4000,
} as const;

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

const visitsPath = (patientId: string) => `/patients/${seg(patientId)}/external-visits`;

export interface OwnerVisitList {
  grants: OwnerVisitGrant[];
  /** Notes appended by external visitors, if the server includes them here. */
  notes?: ExternalNote[];
}

export function listExternalVisits(patientId: string, options?: RequestOptions): Promise<OwnerVisitList> {
  return request<OwnerVisitList>(visitsPath(patientId), { ...options, expect: ["grants"] });
}

export function createExternalVisit(patientId: string, input: VisitSelectionInput, options?: RequestOptions): Promise<VisitIssueResult> {
  return request<VisitIssueResult>(visitsPath(patientId), {
    ...options,
    method: "POST",
    json: input,
    expect: ["grant", "url"],
  });
}

export function revokeExternalVisit(
  grantId: string,
  input: { expectedRevision: number; clientId: string },
  options?: RequestOptions,
): Promise<{ grant: OwnerVisitGrant }> {
  return request<{ grant: OwnerVisitGrant }>(`/external-visits/${seg(grantId)}`, {
    ...options,
    method: "PATCH",
    json: { action: "revoke", ...input },
    expect: ["grant"],
  });
}

// ---------------------------------------------------------------------------
// Guest
// ---------------------------------------------------------------------------

/** Explicit, user-initiated activation. Never called on page load. */
export function redeemExternalVisit(input: VisitRedeemInput, options?: RequestOptions): Promise<{ visit: GuestVisit }> {
  return request<{ visit: GuestVisit }>("/external-visits/redeem", {
    ...options,
    method: "POST",
    json: input,
    expect: ["visit"],
  });
}

export function getGuestRecord(options?: RequestOptions): Promise<GuestRecord> {
  return request<GuestRecord>("/external-visit/record", { ...options, expect: ["visit", "selection", "notes"] });
}

export function addGuestNote(input: GuestNoteInput, options?: RequestOptions): Promise<{ note: ExternalNote }> {
  return request<{ note: ExternalNote }>("/external-visit/notes", {
    ...options,
    method: "POST",
    json: input,
    expect: ["note"],
  });
}

/** Neutral even if the session already ended. */
export function endGuestSession(options?: RequestOptions): Promise<{ ok: true }> {
  return request<{ ok: true }>("/external-visit/session", { ...options, method: "DELETE" });
}

/** Same-origin URL for a selected PDF; the server checks the live guest selection on every read. */
export function guestDocumentSourceUrl(documentId: string, page?: number): string {
  const base = `${API_BASE}/external-visit/documents/${seg(documentId)}/source`;
  return page && Number.isInteger(page) && page > 0 ? `${base}#page=${page}` : base;
}

/** Any refusal on a guest route ends the visible session: clear everything. */
export function isGuestSessionOver(error: ApiError): boolean {
  return error.code === VISIT_UNAVAILABLE || error.status === 401 || error.status === 403 || error.status === 404 || error.status === 410;
}

// ---------------------------------------------------------------------------
// Fragment handling (pure, testable)
// ---------------------------------------------------------------------------

/** Fragment keys accepted for the one-use token (the server currently issues a bare "#<token>"). */
export const GUEST_FRAGMENT_KEYS = ["token", "t", "visit"] as const;

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/;

/** Reads the token from a URL fragment ("#<token>" or "#token=…"). Returns null when absent or malformed. */
export function readGuestToken(hash: string): string | null {
  const raw = (hash.startsWith("#") ? hash.slice(1) : hash).trim();
  if (!raw) return null;
  if (!raw.includes("=")) return TOKEN_PATTERN.test(raw) ? raw : null;
  const params = new URLSearchParams(raw);
  for (const key of GUEST_FRAGMENT_KEYS) {
    const value = params.get(key)?.trim();
    if (value && TOKEN_PATTERN.test(value)) return value;
  }
  return null;
}

/** The server returns a same-origin relative link ("/share#…"); show the absolute form to the owner. */
export function absoluteShareUrl(origin: string, url: string): string {
  return url.startsWith("/") ? `${origin}${url}` : url;
}

/** The whole selection the guest can read, flattened for counting and display. */
export function guestSelectionSize(selection: GuestSelection): number {
  return (
    selection.measurements.length +
    selection.observations.length +
    selection.medicalFacts.length +
    selection.documents.length +
    selection.actions.length
  );
}

/** Re-exported so owner screens can label grant states without importing contracts directly. */
export type VisitGrantState = ExternalVisitGrant["state"];
