/**
 * Clinician message thread state. Recorded by the server, read (receipt) and
 * clinically reviewed are three separate facts: a read receipt is not a
 * review, a review is not a read, and neither resolves an alert.
 */
import type { CareMessage, ContactRequest, ContactUpdate, RevisionGuard } from "@/contracts/monitoring";

export const MESSAGE_TEXT_MAX = 2000;
/** A fenced answer that arrived after an access change is never shown. */
export const STALE_ANSWER =
  "L’accès à ce dossier a changé pendant l’opération : sa réponse n’est pas affichée. Fermez et vérifiez l’état actuel avant de réessayer.";
export const REVIEW_REASON_MAX = 500;
/** Pages followed per poll (50 messages each on the server). */
export const THREAD_MAX_PAGES = 10;

export interface MessageStatus {
  /** Written by the viewing clinician. */
  mine: boolean;
  fromPatient: boolean;
  read: "read" | "unread";
  /** Only patient clinical text carries a clinical-context review. */
  review: "reviewed" | "unreviewed" | "not_applicable";
  /**
   * "copy": a patient message the patient forwarded here from another doctor's
   * thread (only this message, nothing else of that thread). "forwarded_out":
   * this message was forwarded elsewhere for review (not a review itself).
   */
  forwarded: "copy" | "forwarded_out" | null;
}

function reviewable(message: CareMessage): boolean {
  return message.authorCategory === "patient" && message.kind === "clinical";
}

export function messageStatus(message: CareMessage, viewerId: string): MessageStatus {
  return {
    mine: message.authorCategory === "clinician" && message.authorId === viewerId,
    fromPatient: message.authorCategory === "patient",
    read: message.readAt ? "read" : "unread",
    review: reviewable(message) ? (message.review ? "reviewed" : "unreviewed") : "not_applicable",
    forwarded: message.forwardedFromMessageId ? "copy" : message.forwardedForReview ? "forwarded_out" : null,
  };
}

/** The viewer is the thread's clinician and this patient message has no receipt yet. */
export function needsReadReceipt(message: CareMessage, viewerId: string): boolean {
  return message.authorCategory === "patient" && message.readAt === null && message.clinicianId === viewerId;
}

/**
 * Guard sent with a review: the exact current guard the server exposes on the
 * record (or on the care plan) for care-authorized clinicians. Never derived
 * from evaluations or built client-side; null means "current context unknown".
 */
export function reviewGuardFrom(
  record: { guard?: RevisionGuard },
  plan?: { guard?: RevisionGuard } | null,
): RevisionGuard | null {
  return record.guard ?? plan?.guard ?? null;
}

export function canReviewMessage(message: CareMessage, canManageCare: boolean): boolean {
  return canManageCare && reviewable(message) && message.review === null;
}

function createdTime(message: CareMessage): number {
  const time = Date.parse(message.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * New list: one copy per id, chronological. A higher revision wins; on equal
 * revisions the incoming copy wins (read receipts do not bump the revision).
 */
export function mergeMessages(existing: readonly CareMessage[], incoming: readonly CareMessage[]): CareMessage[] {
  const byId = new Map<string, CareMessage>(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    const current = byId.get(message.id);
    if (!current || message.revision >= current.revision) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => createdTime(a) - createdTime(b) || a.id.localeCompare(b.id));
}

export interface ThreadState {
  messages: CareMessage[];
  /** Cursor that returns the newest known page (null: from the start). */
  tailCursor: string | null;
  /** False while older pages remain to be followed on the next poll. */
  complete: boolean;
}

export interface MessagePageLike {
  messages: CareMessage[];
  nextCursor: string | null;
}

/**
 * Follows "after" cursors from the last known page to the newest one, so a
 * poll refreshes the latest page (new messages, receipts, reviews) without
 * re-reading the whole history. Bounded per call.
 */
export async function fetchThreadTail(
  fetchPage: (after: string | null) => Promise<MessagePageLike>,
  current: ThreadState | null,
  maxPages: number = THREAD_MAX_PAGES,
): Promise<ThreadState> {
  let cursor = current?.tailCursor ?? null;
  let messages = current?.messages ?? [];
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    messages = mergeMessages(messages, result.messages);
    if (!result.nextCursor) return { messages, tailCursor: cursor, complete: true };
    cursor = result.nextCursor;
  }
  return { messages, tailCursor: cursor, complete: false };
}

export type MessageTextProblem = "empty" | "too_long" | "invalid";

export function validateMessageText(text: string): MessageTextProblem | null {
  if (!text.trim()) return "empty";
  if (text.length > MESSAGE_TEXT_MAX) return "too_long";
  // Plain text only: line breaks and tabs are fine, other control characters are not.
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? "invalid" : null;
}

/** Actions a clinician may attempt on a contact request; the server still decides. */
export function contactActions(state: ContactRequest["state"]): ContactUpdate["action"][] {
  if (state === "requested") return ["acknowledge", "contact_reported", "cancel"];
  if (state === "acknowledged") return ["contact_reported", "cancel"];
  return [];
}
