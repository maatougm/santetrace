import type { Actor } from "../contracts/care";
import type { CareMessage, ContactInput, ContactRequest, ContactUpdate, MessageForwardInput, MessageInput, MessageReview } from "../contracts/monitoring";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { boundedText, canonical, fail, integer, replay } from "./monitoring-utils";
import { bumpPatientRevision, journalAccess, requirePatientCapability, requirePatientReadScope } from "./patient-access-service";
import { assertCurrentMonitoringGuard, strictMonitoringInput } from "./care-plan-service";

function threadAccess(state: CareState, actor: Actor, patientId: string, clinicianId: string) {
  requirePatientCapability(state, actor, patientId, "messages");
  if (actor.role === "clinician" && actor.id !== clinicianId) fail("FORBIDDEN", "Conversation inaccessible.", 403);
  const grant = state.careGrants.find(g => g.patientId === patientId && g.clinicianId === clinicianId && g.state === "active" && g.scopes.includes("messages"));
  if (!grant || !state.accounts.some(a => a.id === clinicianId && a.enabled && a.role === "clinician")) fail("NOT_FOUND", "Conversation inaccessible.", 404);
  return grant;
}

function plainText(value: unknown, maximum: number) {
  const text = boundedText(value, maximum);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail("INVALID_INPUT");
  return text;
}

function messageById(state: CareState, id: string): CareMessage {
  const message = state.messages.find(m => m.id === id);
  if (!message) fail("NOT_FOUND", "Message inaccessible.", 404);
  return message;
}
function forwardMatches(original: CareMessage, copy: CareMessage, actorId: string, clinicianId: string): boolean {
  const sameUnreviewedVersion = !original.review && !copy.review && original.revision === copy.forwardedFromMessageRevision;
  const reviewedVersion = Boolean(original.review && copy.review && canonical(original.review) === canonical(copy.review) && copy.forwardedFromMessageRevision !== undefined && original.revision === copy.forwardedFromMessageRevision + 1);
  return copy.patientId === original.patientId && copy.clinicianId === clinicianId && copy.forwardedFromMessageId === original.id && copy.authorId === actorId && copy.authorCategory === "patient" && copy.kind === "clinical" && copy.text === original.text && original.forwardedForReview?.messageId === copy.id && original.forwardedForReview.clinicianId === clinicianId && (sameUnreviewedVersion || reviewedVersion);
}

/** Count clinical source versions, while retaining each physician's actual review history. */
export function hasUnassessedClinicalContext(state: CareState, patientId: string): boolean {
  return state.messages.some(message => {
    if (message.patientId !== patientId || message.authorCategory !== "patient" || message.kind !== "clinical" || message.review) return false;
    const original = state.messages.find(source => source.id === message.forwardedFromMessageId);
    if (!original || original.patientId !== patientId || original.authorCategory !== "patient" || original.kind !== "clinical" || original.forwardedFromMessageId || original.authorId !== message.authorId || original.text !== message.text || !original.review || message.forwardedFromMessageRevision === undefined || original.revision !== message.forwardedFromMessageRevision + 1) return true;
    const reviewedCopy = state.messages.find(copy => copy.id === original.forwardedForReview?.messageId);
    // A prior recipient's unreviewed copy is covered only by the explicitly forwarded,
    // reviewed copy of this exact source version. No other thread is exposed or marked reviewed.
    return !reviewedCopy || !reviewedCopy.review || reviewedCopy.review.clinicianId !== reviewedCopy.clinicianId || reviewedCopy.forwardedFromMessageRevision !== message.forwardedFromMessageRevision || !forwardMatches(original, reviewedCopy, original.authorId, reviewedCopy.clinicianId);
  });
}

function paginate<T extends { id: string }>(items: T[], cursor?: string | null) {
  let offset = 0;
  if (cursor) { const index = items.findIndex(item => item.id === cursor); if (index < 0) fail("INVALID_CURSOR"); offset = index + 1; }
  const page = items.slice(offset, offset + 50);
  return { page: structuredClone(page), nextCursor: items.length > offset + 50 ? page.at(-1)!.id : null };
}

export class InterventionService {
  constructor(public store: CareStoreAdapter, private clock = () => new Date().toISOString()) {}

  listMessages(actor: Actor, patientId: string, clinicianId?: string | null, cursor?: string | null) {
    return this.store.transaction(state => {
      const access = requirePatientReadScope(state, actor, patientId, "messages");
      const target = clinicianId ?? (actor.role === "clinician" ? actor.id : null);
      if (!access.owner && target) threadAccess(state, actor, patientId, target);
      const messages = state.messages.filter(m => m.patientId === patientId && (!target || m.clinicianId === target) && (access.owner || state.careGrants.some(g => g.patientId === patientId && g.clinicianId === m.clinicianId && g.state === "active" && g.scopes.includes("messages"))));
      const { page, nextCursor } = paginate(messages, cursor);
      journalAccess(state, actor, patientId, "read_messages", "patient", patientId, "allowed");
      return { messages: page, nextCursor };
    });
  }

  /** The owner selects one own clinical message; another physician's thread stays private. */
  forwardMessage(actor: Actor, id: string, body: MessageForwardInput): CareMessage {
    const input = strictMonitoringInput(body, ["clinicianId", "clientId"]), clinicianId = boundedText(input.clinicianId, 100), clientId = boundedText(input.clientId, 128);
    return this.store.transaction(state => {
      const original = messageById(state, id);
      requirePatientCapability(state, actor, original.patientId, "owner");
      if (original.authorId !== actor.id || original.authorCategory !== "patient" || original.kind !== "clinical" || original.forwardedFromMessageId) fail("INVALID_FORWARD", "Seul votre propre message clinique peut être transmis.");
      const target = state.accounts.find(a => a.id === clinicianId && a.role === "clinician" && a.enabled);
      if (!target) fail("NOT_FOUND", "Médecin référent inaccessible.", 404);
      requirePatientCapability(state, { id: target.id, role: "clinician", patientId: null, displayName: target.displayName }, original.patientId, "manage");
      if (original.clinicianId === clinicianId) fail("INVALID_FORWARD", "Ce message est déjà adressé au référent.");
      const result = replay(state, JSON.stringify([actor.id, "message_forward", id, clinicianId, clientId]), body, () => {
        if (original.forwardedForReview?.clinicianId === clinicianId) {
          const current = state.messages.find(m => m.id === original.forwardedForReview!.messageId);
          if (!current || !forwardMatches(original, current, actor.id, clinicianId)) fail("STALE_SOURCE", "La copie transmise ne correspond plus au message.", 409);
          return structuredClone(current);
        }
        if (original.review) fail("ALREADY_REVIEWED", "Le message a déjà été revu.", 409);
        const at = this.clock();
        const forwarded: CareMessage = { id: careId(), revision: 1, patientId: original.patientId, clinicianId, threadId: JSON.stringify([original.patientId, clinicianId]), authorId: actor.id, authorCategory: "patient", text: original.text, kind: "clinical", actionId: null, createdAt: at, readAt: null, review: null, forwardedFromMessageId: id, forwardedFromMessageRevision: original.revision };
        state.messages.push(forwarded); original.forwardedForReview = { messageId: forwarded.id, clinicianId, at };
        // A transfer adds no new clinical content but still invalidates a pending review guard.
        bumpPatientRevision(state, original.patientId, "context");
        journalAccess(state, actor, original.patientId, "forward_message", "message", forwarded.id, "allowed");
        return structuredClone(forwarded);
      });
      const current = messageById(state, result.id);
      if (!forwardMatches(original, current, actor.id, clinicianId)) fail("STALE_SOURCE", "La source transmise a changé.", 409);
      return structuredClone(current);
    });
  }

  sendMessage(actor: Actor, patientId: string, body: MessageInput): CareMessage {
    const input = strictMonitoringInput(body, ["text", "kind", "clinicianId", "clientId"]);
    const clientId = boundedText(input.clientId, 128), clinicianId = boundedText(input.clinicianId, 100), text = plainText(input.text, 2000);
    if (input.kind !== "clinical" && input.kind !== "administrative") fail("INVALID_INPUT");
    return this.store.transaction(state => {
      threadAccess(state, actor, patientId, clinicianId);
      return replay(state, JSON.stringify([actor.id, "message_send", patientId, clinicianId, clientId]), body, () => {
        const message: CareMessage = { id: careId(), revision: 1, patientId, clinicianId, threadId: JSON.stringify([patientId, clinicianId]), authorId: actor.id, authorCategory: actor.role, text, kind: actor.role === "patient" ? "clinical" : input.kind as "clinical" | "administrative", actionId: null, createdAt: this.clock(), readAt: null, review: null };
        state.messages.push(message);
        // A patient-selected administrative label cannot assert that medical text is safe.
        if (message.kind === "clinical") bumpPatientRevision(state, patientId, "context");
        journalAccess(state, actor, patientId, "send_message", "message", message.id, "allowed");
        return structuredClone(message);
      });
    });
  }

  markRead(actor: Actor, id: string, body: { clientId: string }): CareMessage {
    const input = strictMonitoringInput(body, ["clientId"]), clientId = boundedText(input.clientId, 128);
    return this.store.transaction(state => {
      const message = messageById(state, id); threadAccess(state, actor, message.patientId, message.clinicianId);
      if (message.authorId === actor.id || (message.authorCategory === "patient" && actor.role !== "clinician") || (message.authorCategory === "clinician" && actor.role !== "patient")) fail("FORBIDDEN", "Accusé de lecture réservé au destinataire.", 403);
      return replay(state, JSON.stringify([actor.id, "message_read", id, clientId]), body, () => {
        message.readAt ??= this.clock();
        journalAccess(state, actor, message.patientId, "read_message", "message", id, "allowed");
        return structuredClone(message);
      });
    });
  }

  reviewMessage(actor: Actor, id: string, body: MessageReview): CareMessage {
    const input = strictMonitoringInput(body, ["expectedRevision", "expectedGuard", "reason", "clientId"]);
    const clientId = boundedText(input.clientId, 128), revision = integer(input.expectedRevision, 1), reason = plainText(input.reason, 1000);
    return this.store.transaction(state => {
      const message = messageById(state, id); threadAccess(state, actor, message.patientId, message.clinicianId); requirePatientCapability(state, actor, message.patientId, "manage");
      return replay(state, JSON.stringify([actor.id, "message_review", id, clientId]), body, () => {
        if (message.revision !== revision || message.review) fail("STALE_REVISION", "Le message a changé.", 409);
        if (message.authorCategory !== "patient" || message.kind !== "clinical") fail("INVALID_REVIEW", "Revue clinique d'un message patient requise.");
        const guard = assertCurrentMonitoringGuard(state, message.patientId, input.expectedGuard);
        const original = message.forwardedFromMessageId ? messageById(state, message.forwardedFromMessageId) : null;
        if (original && (original.patientId !== message.patientId || original.authorCategory !== "patient" || original.authorId !== message.authorId || original.kind !== "clinical" || original.forwardedFromMessageId || original.text !== message.text || original.revision !== message.forwardedFromMessageRevision || original.review || original.forwardedForReview?.messageId !== message.id || original.forwardedForReview.clinicianId !== actor.id)) fail("STALE_SOURCE", "Le message transmis ou son autorisation a changé.", 409);
        message.review = { clinicianId: actor.id, at: this.clock(), reason, guard }; message.revision++;
        if (original) { original.review = structuredClone(message.review); original.revision++; }
        journalAccess(state, actor, message.patientId, "review_message", "message", id, "allowed");
        return structuredClone(message);
      });
    });
  }

  requestContact(actor: Actor, patientId: string, body: ContactInput): ContactRequest {
    const input = strictMonitoringInput(body, ["clinicianId", "clientId"]);
    const clientId = boundedText(input.clientId, 128), clinicianId = boundedText(input.clinicianId, 100);
    return this.store.transaction(state => {
      threadAccess(state, actor, patientId, clinicianId);
      return replay(state, JSON.stringify([actor.id, "contact_request", patientId, clinicianId, clientId]), body, () => {
        const request: ContactRequest = { id: careId(), revision: 1, patientId, clinicianId, state: "requested", messageId: null, createdAt: this.clock(), history: [{ authorId: actor.id, action: "request", reason: "Demande de contact", at: this.clock() }] };
        state.contactRequests.push(request);
        journalAccess(state, actor, patientId, "request_contact", "contact_request", request.id, "allowed");
        return structuredClone(request);
      });
    });
  }

  updateContact(actor: Actor, id: string, body: ContactUpdate): ContactRequest {
    const input = strictMonitoringInput(body, ["action", "expectedRevision", "reason", "clientId"]);
    const clientId = boundedText(input.clientId, 128), revision = integer(input.expectedRevision, 1), reason = plainText(input.reason, 1000);
    if (!["acknowledge", "contact_reported", "cancel"].includes(String(input.action))) fail("INVALID_ACTION");
    return this.store.transaction(state => {
      const request = state.contactRequests.find(r => r.id === id); if (!request) fail("NOT_FOUND", "Demande inaccessible.", 404);
      threadAccess(state, actor, request.patientId, request.clinicianId);
      if (input.action === "acknowledge" && actor.role !== "clinician") fail("FORBIDDEN", "Accusé réservé au médecin.", 403);
      return replay(state, JSON.stringify([actor.id, "contact_update", id, clientId]), body, () => {
        if (request.revision !== revision || ["cancelled", "contact_reported"].includes(request.state)) fail("STALE_REVISION", "La demande a changé.", 409);
        if (input.action === "acknowledge" && request.state !== "requested") fail("INVALID_TRANSITION", "Demande déjà accusée.", 409);
        request.state = input.action === "acknowledge" ? "acknowledged" : input.action === "cancel" ? "cancelled" : "contact_reported"; request.revision++;
        request.history.push({ authorId: actor.id, action: String(input.action), reason, at: this.clock() });
        journalAccess(state, actor, request.patientId, `contact_${input.action}`, "contact_request", id, "allowed");
        return structuredClone(request);
      });
    });
  }

  listContacts(actor: Actor, patientId: string) {
    return this.store.transaction(state => {
      const access = requirePatientReadScope(state, actor, patientId, "messages");
      if (!access.owner) threadAccess(state, actor, patientId, actor.id);
      const contacts = state.contactRequests.filter(r => r.patientId === patientId && (access.owner || r.clinicianId === actor.id && state.careGrants.some(g => g.patientId === patientId && g.clinicianId === r.clinicianId && g.state === "active" && g.scopes.includes("messages"))));
      journalAccess(state, actor, patientId, "read_contact_requests", "patient", patientId, "allowed");
      return { contacts: structuredClone(contacts) };
    });
  }
}
