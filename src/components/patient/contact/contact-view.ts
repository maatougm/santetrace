/**
 * Pure decisions for the patient Contact screen (feature 006, story 5).
 *
 * Message states never run ahead of the server: "read" needs `readAt`,
 * "reviewed" needs a clinician review, otherwise a message is only recorded.
 * A contact request is a request, never a call or a connection.
 */
import type { CareMessage, ContactRequest, MessageInput } from "@/contracts/monitoring";
import type { CareGrant, DoctorProfile } from "@/contracts/patient-platform";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";

export const MESSAGE_MAX = 2000;

const time = (iso: string | null | undefined): number => {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
};

// ---------------------------------------------------------------------------
// Recipients and compose
// ---------------------------------------------------------------------------

export interface Recipient {
  clinicianId: string;
  /** Directory name; null when the directory did not list this doctor. */
  name: string | null;
}

export function messageRecipients(grants: readonly CareGrant[], doctors: readonly DoctorProfile[]): Recipient[] {
  const ids = grants
    .filter((grant) => grant.state === "active" && grant.scopes.includes("messages"))
    .map((grant) => grant.clinicianId);
  return [...new Set(ids)].map((clinicianId) => ({
    clinicianId,
    name: doctors.find((doctor) => doctor.id === clinicianId)?.displayName ?? null,
  }));
}

/**
 * A patient message is always clinical: the server treats all patient text as
 * clinical context, so the patient is not offered a type choice.
 */
export function buildMessageInput(text: string, clinicianId: string, clientId: string): MessageInput {
  return { text: text.trim(), kind: "clinical", clinicianId, clientId };
}

export type MessageError = "emptyText" | "tooLong";

export function validateMessage(text: string): MessageError | null {
  const trimmed = text.trim();
  if (!trimmed) return "emptyText";
  return trimmed.length > MESSAGE_MAX ? "tooLong" : null;
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export type OwnMessageState = "recorded" | "read" | "reviewed";

export function ownMessageState(message: Pick<CareMessage, "readAt" | "review">): OwnMessageState {
  if (message.review !== null) return "reviewed";
  return message.readAt !== null ? "read" : "recorded";
}

export function isIncoming(message: Pick<CareMessage, "authorCategory">): boolean {
  return message.authorCategory !== "patient";
}

/** Incoming messages still unread and not already being marked in this visit. */
export function messagesToMarkRead(messages: readonly CareMessage[], requested: ReadonlySet<string>): string[] {
  return messages.filter((m) => isIncoming(m) && m.readAt === null && !requested.has(m.id)).map((m) => m.id);
}

function mergeById<T extends { id: string; revision: number }>(base: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map(base.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (!current || item.revision >= current.revision) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** Newest revision of each message, oldest first (conversation order). */
export function mergeMessages(base: readonly CareMessage[], incoming: readonly CareMessage[]): CareMessage[] {
  return mergeById(base, incoming).sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
}

export interface MessageThread {
  messages: CareMessage[];
  /** The page cap was hit: later messages were not fetched. */
  truncated: boolean;
}

/**
 * The server pages oldest first; follows `nextCursor` until the end or the
 * cap so the newest messages are included.
 */
export async function fetchAllMessages(
  fetchPage: (after: string | null) => Promise<{ messages: CareMessage[]; nextCursor: string | null }>,
  maxPages: number,
): Promise<MessageThread> {
  let messages: CareMessage[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    messages = mergeMessages(messages, result.messages);
    cursor = result.nextCursor;
    if (cursor === null) return { messages, truncated: false };
  }
  return { messages, truncated: true };
}

// ---------------------------------------------------------------------------
// Owner-authorized forwarding
// ---------------------------------------------------------------------------

export type ForwardOption =
  | { kind: "none" }
  | { kind: "no_primary" }
  | { kind: "forwarded"; at: string }
  | { kind: "offer"; targetClinicianId: string };

type ForwardableMessage = Pick<CareMessage, "authorCategory" | "kind" | "forwardedFromMessageId" | "forwardedForReview">;

/**
 * The patient may explicitly forward one of their OWN clinical messages from a
 * secondary doctor's thread to the active primary referent. Never offered for
 * anything else, never automatic, and nothing else of the thread is exposed.
 */
export function forwardOption(message: ForwardableMessage, threadClinicianId: string, grants: readonly CareGrant[]): ForwardOption {
  if (message.authorCategory !== "patient" || message.kind !== "clinical" || message.forwardedFromMessageId) return { kind: "none" };
  const active = grants.filter((grant) => grant.state === "active");
  const thread = active.find((grant) => grant.clinicianId === threadClinicianId);
  if (!thread || thread.relationship === "primary") return { kind: "none" };
  if (message.forwardedForReview) return { kind: "forwarded", at: message.forwardedForReview.at };
  const primary = active.find((grant) => grant.relationship === "primary" && grant.clinicianId !== threadClinicianId);
  return primary ? { kind: "offer", targetClinicianId: primary.clinicianId } : { kind: "no_primary" };
}

// ---------------------------------------------------------------------------
// Contact requests
// ---------------------------------------------------------------------------

/** Server state label; an unknown state gets no label rather than a guessed one. */
export function contactStateLabel(state: string, lang: Language): string | null {
  const table = CARE_COPY[lang].contactState as Record<string, string>;
  return Object.hasOwn(table, state) ? table[state] : null;
}

export function canCancelContact(request: Pick<ContactRequest, "state">): boolean {
  return request.state === "requested" || request.state === "acknowledged";
}

/** Newest revision of each request, most recent first. */
export function mergeContactRequests(base: readonly ContactRequest[], incoming: readonly ContactRequest[]): ContactRequest[] {
  return mergeById(base, incoming).sort((a, b) => time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id));
}
