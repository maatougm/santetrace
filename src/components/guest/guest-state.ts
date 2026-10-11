/**
 * Pure state for the external practitioner (guest) pages. No storage, no
 * network: the components call the API and feed results in here.
 *
 * Landing: reading the fragment only prepares the token in memory. Redemption
 * starts exclusively from an explicit submit, so a link preview (which never
 * submits) reveals and consumes nothing.
 * Session: any refusal ends the visible session and drops every guest datum;
 * terminal phases ignore late responses, so a held answer cannot restore them.
 */
import type { Measurement } from "@/contracts/care";
import type { ExternalNote, GuestNoteInput, GuestRecord, GuestVisit } from "@/contracts/external-visit";
import { formatDate, isSimulatedMeasurement, isUnscoredMeasurement, localeFor } from "@/lib/client/format";
import { GUEST_LIMITS, isGuestSessionOver } from "@/lib/client/share-api";
import type { ApiError, Language } from "@/lib/client/transport";

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export type LandingState =
  | { phase: "reading" }
  | { phase: "no_token" }
  | { phase: "ready"; token: string; failure: ApiError | null }
  | { phase: "submitting"; token: string }
  | { phase: "opened" }
  | { phase: "unavailable" };

export type LandingAction =
  | { type: "fragment_read"; token: string | null }
  | { type: "submit" }
  | { type: "redeemed" }
  | { type: "redeem_failed"; error: ApiError };

export const INITIAL_LANDING: LandingState = { phase: "reading" };

/** Invalid, consumed, expired and revoked links all look the same; transport failures may be retried. */
function redeemRefused(error: ApiError): boolean {
  return isGuestSessionOver(error) || error.isConflict;
}

export function landingReducer(state: LandingState, action: LandingAction): LandingState {
  switch (action.type) {
    case "fragment_read":
      // Only the first read counts: the fragment is stripped right after it.
      if (state.phase !== "reading") return state;
      return action.token ? { phase: "ready", token: action.token, failure: null } : { phase: "no_token" };
    case "submit":
      return state.phase === "ready" ? { phase: "submitting", token: state.token } : state;
    case "redeemed":
      return state.phase === "submitting" ? { phase: "opened" } : state;
    case "redeem_failed":
      if (state.phase !== "submitting") return state;
      return redeemRefused(action.error) ? { phase: "unavailable" } : { phase: "ready", token: state.token, failure: action.error };
  }
}

export function landingToken(state: LandingState): string | null {
  return state.phase === "ready" || state.phase === "submitting" ? state.token : null;
}

export interface GuestDeclaration {
  declaredName: string;
  organization: string;
}

export type DeclarationError = "nameRequired" | "nameTooLong" | "organizationTooLong";

export type DeclarationValidation =
  | { ok: true; value: GuestDeclaration }
  | { ok: false; errors: Partial<Record<keyof GuestDeclaration, DeclarationError>> };

export function validateDeclaration(input: GuestDeclaration): DeclarationValidation {
  const declaredName = input.declaredName.trim();
  const organization = input.organization.trim();
  const errors: Partial<Record<keyof GuestDeclaration, DeclarationError>> = {};
  if (!declaredName) errors.declaredName = "nameRequired";
  else if (declaredName.length > GUEST_LIMITS.declaredNameMax) errors.declaredName = "nameTooLong";
  if (organization.length > GUEST_LIMITS.organizationMax) errors.organization = "organizationTooLong";
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { declaredName, organization } };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type GuestSessionState =
  | { phase: "loading"; error: ApiError | null }
  | { phase: "active"; record: GuestRecord; openDocumentId: string | null; stale: ApiError | null }
  | { phase: "unavailable" }
  | { phase: "ended"; confirmed: boolean };

export type GuestSessionAction =
  | { type: "loaded"; record: GuestRecord }
  | { type: "load_failed"; error: ApiError }
  | { type: "session_over" }
  /** The PDF source refused a read: the visit is over, not just this viewer. */
  | { type: "source_denied" }
  | { type: "expired_locally" }
  | { type: "note_added"; note: ExternalNote }
  | { type: "open_document"; documentId: string | null }
  | { type: "ended"; confirmed: boolean };

export const INITIAL_SESSION: GuestSessionState = { phase: "loading", error: null };

const UNAVAILABLE: GuestSessionState = { phase: "unavailable" };

function isTerminal(state: GuestSessionState): boolean {
  return state.phase === "unavailable" || state.phase === "ended";
}

function isSelectedDocument(record: GuestRecord, documentId: string | null): boolean {
  return documentId !== null && record.selection.documents.some((doc) => doc.id === documentId);
}

/**
 * Notes are append-only: a poll that started before a note was recorded must
 * not hide it. Notes already confirmed in this session are kept until the
 * server list includes them.
 */
function mergeNotes(incoming: ExternalNote[], known: ExternalNote[]): ExternalNote[] {
  const missing = known.filter((note) => !incoming.some((n) => n.id === note.id));
  return missing.length > 0 ? [...incoming, ...missing] : incoming;
}

export function guestSessionReducer(state: GuestSessionState, action: GuestSessionAction): GuestSessionState {
  if (action.type === "ended") return state.phase === "ended" ? state : { phase: "ended", confirmed: action.confirmed };
  if (isTerminal(state)) return state;

  switch (action.type) {
    case "loaded": {
      if (state.phase !== "active") return { phase: "active", record: action.record, openDocumentId: null, stale: null };
      const openDocumentId = isSelectedDocument(action.record, state.openDocumentId) ? state.openDocumentId : null;
      const record = { ...action.record, notes: mergeNotes(action.record.notes, state.record.notes) };
      return { phase: "active", record, openDocumentId, stale: null };
    }
    case "load_failed":
      if (isGuestSessionOver(action.error)) return UNAVAILABLE;
      return state.phase === "active" ? { ...state, stale: action.error } : { phase: "loading", error: action.error };
    case "session_over":
    case "source_denied":
    case "expired_locally":
      return UNAVAILABLE;
    case "note_added": {
      if (state.phase !== "active" || state.record.notes.some((n) => n.id === action.note.id)) return state;
      return { ...state, record: { ...state.record, notes: [...state.record.notes, action.note] } };
    }
    case "open_document":
      if (state.phase !== "active") return state;
      return { ...state, openDocumentId: isSelectedDocument(state.record, action.documentId) ? action.documentId : null };
  }
}

/**
 * Earliest of the idle deadline (moved by each server answer) and the
 * absolute cap, as epoch ms; null when neither is a valid date.
 */
export function visitDeadline(visit: Pick<GuestVisit, "expiresAt" | "idleExpiresAt">): number | null {
  const deadlines = [Date.parse(visit.expiresAt), Date.parse(visit.idleExpiresAt)].filter(Number.isFinite);
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}

/** The server decides the end; the client only stops showing data after the deadlines it was given. */
export function isVisitExpired(visit: Pick<GuestVisit, "expiresAt" | "idleExpiresAt">, now: number): boolean {
  const deadline = visitDeadline(visit);
  return deadline !== null && now >= deadline;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "11 oct. 2026" for a YYYY-MM-DD calendar day, formatted in UTC so the day
 * never shifts with the viewer's time zone. Any other value goes through the
 * ordinary timestamp formatter.
 */
export function formatCalendarDate(value: string | null | undefined, lang: Language): string {
  if (!value) return "—";
  if (!CALENDAR_DATE.test(value)) return formatDate(value, lang);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export interface GuestNoteDraft {
  text: string;
  /** YYYY-MM-DD from <input type="date">, or "". */
  consultationDate: string;
  /** Note id this one corrects, or "". */
  correctsNoteId: string;
}

export interface PendingNote {
  input: GuestNoteInput;
  received: boolean;
}

export type NoteError = "noteEmpty" | "noteTooLong";

/** Earlier notes of this grant, oldest first: the only ones a correction may reference. */
export function correctableNotes(record: GuestRecord): ExternalNote[] {
  return record.notes
    .filter((n) => n.grantId === record.visit.grantId)
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
}

function samePayload(a: GuestNoteInput, b: Omit<GuestNoteInput, "clientId">): boolean {
  return a.text === b.text && a.consultationDate === b.consultationDate && a.correctsNoteId === b.correctsNoteId;
}

/** One clientId per note: an unconfirmed identical retry reuses it, anything else is a new note. */
export function guestNoteInput(
  draft: GuestNoteDraft,
  record: GuestRecord,
  previous: PendingNote | null,
  makeId: () => string,
): { ok: true; input: GuestNoteInput } | { ok: false; error: NoteError } {
  const text = draft.text.trim();
  if (!text) return { ok: false, error: "noteEmpty" };
  if (text.length > GUEST_LIMITS.noteMax) return { ok: false, error: "noteTooLong" };
  const correctsNoteId = correctableNotes(record).some((n) => n.id === draft.correctsNoteId) ? draft.correctsNoteId : null;
  // A calendar day as typed, never a timestamp: no time-zone conversion can move it.
  const consultationDate = CALENDAR_DATE.test(draft.consultationDate) ? draft.consultationDate : null;
  const payload = { text, consultationDate, correctsNoteId };
  const clientId = previous && !previous.received && samePayload(previous.input, payload) ? previous.input.clientId : makeId();
  return { ok: true, input: { ...payload, clientId } };
}

// ---------------------------------------------------------------------------
// Display decisions
// ---------------------------------------------------------------------------

export function measurementBadges(m: Pick<Measurement, "source" | "connector" | "kind">): { simulated: boolean; unscored: boolean } {
  return { simulated: isSimulatedMeasurement(m), unscored: isUnscoredMeasurement(m) };
}
