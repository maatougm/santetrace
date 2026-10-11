import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Actor, Observation } from "../contracts/care";
import type { ExternalVisitGrant, ExternalVisitSession, ExternalNote, GuestNoteInput, GuestRecord, GuestSelection, GuestVisit,
  VisitIssueResult, VisitRedeemInput, VisitSelectionInput, VisitSelectionRef, VisitSessionResult } from "../contracts/external-visit";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { CareError } from "./care-error";
import { boundedText, canonical, fail, hash, integer, replay } from "./monitoring-utils";
import { bumpPatientRevision, journalAccess, requirePatientCapability, resolvePatientAccess } from "./patient-access-service";

type VisitOptions = { clock?: () => number; directory?: string; fileReader?: (path: string) => Promise<Buffer> };
type RevokeInput = { action: "revoke"; expectedRevision: number; clientId: string };
const ABSOLUTE_MS = 60 * 60000, IDLE_MS = 15 * 60000, REDEEM_MS = 24 * 3600000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function unavailable(): never { fail("VISIT_UNAVAILABLE", "Consultation indisponible.", 404); }
function onlyKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail("INVALID_INPUT");
}
function publicGrant(grant: ExternalVisitGrant): VisitIssueResult["grant"] {
  const { tokenHash: _token, frozenProjection: _medicalData, ...visible } = grant;
  return structuredClone(visible);
}
function guestVisit(session: ExternalVisitSession): GuestVisit {
  return { id: session.id, grantId: session.grantId, declaredName: session.declaredName, organization: session.organization,
    verification: "unverified", openedAt: session.openedAt, expiresAt: session.expiresAt,
    idleExpiresAt: new Date(Math.min(Date.parse(session.lastSeenAt) + IDLE_MS, Date.parse(session.expiresAt))).toISOString() };
}
function observationVersion(observation: Observation, revision: number): Observation | null {
  const current = observation.revisions.length + 1;
  if (revision > current) return null;
  if (revision === current) return structuredClone(observation);
  const prior = observation.revisions[revision - 1];
  if (!prior) return null;
  return { ...structuredClone(observation), value: prior.value, unit: prior.unit, examDate: prior.examDate,
    revisions: structuredClone(observation.revisions.slice(0, revision - 1)) };
}
function freezeSelection(state: CareState, patientId: string, selection: VisitSelectionRef[]): GuestSelection {
  const result: GuestSelection = { measurements: [], observations: [], medicalFacts: [], documents: [], actions: [] };
  for (const selected of selection) {
    if (selected.kind === "measurement") {
      const resource = state.measurements.find(item => item.id === selected.id && item.patientId === patientId);
      if (!resource || selected.revision !== 1) fail("INVALID_SELECTION");
      result.measurements.push(structuredClone(resource));
    } else if (selected.kind === "observation") {
      const resource = state.observations.find(item => item.id === selected.id && item.patientId === patientId);
      const version = resource ? observationVersion(resource, selected.revision) : null;
      if (!version) fail("INVALID_SELECTION");
      result.observations.push(version);
    } else if (selected.kind === "patient_fact") {
      const resource = state.medicalFacts.find(item => item.id === selected.id && item.patientId === patientId && item.revision === selected.revision);
      if (!resource) fail("INVALID_SELECTION");
      const frozen = structuredClone(resource);
      // Later corrections and unselected evidence never enter a previously selected version.
      frozen.supersededBy = null;
      frozen.sources = frozen.sources.filter(source => source.kind === "reference" || selection.some(ref => ref.kind === source.kind && ref.id === source.id && ref.revision === source.revision)
        || (source.documentId && selection.some(ref => ref.kind === "document" && ref.id === source.documentId)));
      result.medicalFacts.push(frozen);
    } else if (selected.kind === "document") {
      const resource = state.documents.find(item => item.id === selected.id && item.patientId === patientId);
      if (!resource || selected.revision !== 1 || !resource.contentHash || !/^[a-f0-9]{64}$/.test(resource.contentHash)) fail("INVALID_SELECTION");
      result.documents.push(structuredClone(resource));
    } else {
      const resource = state.careActions.find(item => item.id === selected.id && item.patientId === patientId && item.revision === selected.revision);
      const protocol = resource?.protocolId ? state.protocols.find(item => item.id === resource.protocolId && item.patientId === patientId) : null;
      const proposalId = resource?.proposalId ?? protocol?.sourceProposalId;
      const approved = state.careProposals.some(item => item.id === proposalId && item.patientId === patientId && item.state === "approved" && item.decision !== null);
      if (!resource || !approved) fail("INVALID_SELECTION");
      result.actions.push(structuredClone(resource));
    }
  }
  return result;
}
function parseSelection(input: VisitSelectionInput): { selection: VisitSelectionRef[]; clientId: string } {
  onlyKeys(input, ["selection", "clientId"]);
  const clientId = boundedText(input.clientId, 128);
  if (!Array.isArray(input.selection) || !input.selection.length || input.selection.length > 100) fail("INVALID_SELECTION");
  const seen = new Set<string>();
  const selection = input.selection.map(value => {
    onlyKeys(value, ["kind", "id", "revision"]);
    if (!["measurement", "observation", "patient_fact", "document", "approved_action"].includes(value.kind)) fail("INVALID_SELECTION");
    const id = boundedText(value.id, 128), revision = integer(value.revision, 1), key = `${value.kind}:${id}`;
    if (seen.has(key)) fail("INVALID_SELECTION");
    seen.add(key); return { kind: value.kind, id, revision } as VisitSelectionRef;
  });
  return { selection, clientId };
}

export class ExternalVisitService {
  private clock: () => number;
  private directory: string;
  private fileReader: (path: string) => Promise<Buffer>;
  constructor(public store: CareStoreAdapter, options: VisitOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.directory = options.directory ?? process.env.HACKCURE_DOCUMENT_DIRECTORY ?? ".data/care-documents";
    this.fileReader = options.fileReader ?? readFile;
  }

  list(actor: Actor, patientId: string): { grants: VisitIssueResult["grant"][] } {
    const state = this.store.read();
    if (!resolvePatientAccess(state, actor, patientId).owner) fail("FORBIDDEN", "Accès propriétaire requis.", 403);
    return { grants: state.externalVisitGrants.filter(grant => grant.patientId === patientId).map(grant => {
      const visible = publicGrant(grant);
      if (visible.state === "pending" && Date.parse(visible.redeemBy) <= this.clock()) visible.state = "expired";
      return visible;
    }) };
  }

  issue(actor: Actor, patientId: string, input: VisitSelectionInput): VisitIssueResult {
    const normalized = parseSelection(input);
    return this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "owner");
      const key = JSON.stringify([actor.id, "external_visit_issue", patientId, normalized.clientId]), digest = hash(canonical(normalized)), old = state.idempotency[key];
      if (old) {
        if (old.hash !== digest) fail("IDEMPOTENCY_CONFLICT", "Identifiant déjà utilisé.", 409);
        const grant = state.externalVisitGrants.find(item => item.id === (old.result as { grantId: string }).grantId);
        if (!grant || grant.patientId !== patientId) unavailable();
        return { grant: publicGrant(grant), url: null };
      }
      const frozenProjection = freezeSelection(state, patientId, normalized.selection), token = randomBytes(32).toString("base64url"), now = this.clock();
      const grant: ExternalVisitGrant = { id: careId(), patientId, selection: normalized.selection, frozenProjection,
        appendGuestNotes: true, state: "pending", tokenHash: hash(token), redeemBy: new Date(now + REDEEM_MS).toISOString(), createdAt: new Date(now).toISOString(), revision: 1 };
      state.externalVisitGrants.push(grant);
      state.idempotency[key] = { hash: digest, result: { grantId: grant.id } };
      journalAccess(state, actor, patientId, "issue_external_visit", "external_visit", grant.id, "allowed");
      return { grant: publicGrant(grant), url: `/share#${token}` };
    });
  }

  revoke(actor: Actor, grantId: string, input: RevokeInput): { grant: VisitIssueResult["grant"] } {
    onlyKeys(input, ["action", "expectedRevision", "clientId"]);
    const clientId = boundedText(input.clientId, 128), expectedRevision = integer(input.expectedRevision, 1);
    if (input.action !== "revoke") fail("INVALID_INPUT");
    return this.store.transaction(state => {
      const grant = state.externalVisitGrants.find(item => item.id === grantId);
      if (!grant) unavailable();
      if (!resolvePatientAccess(state, actor, grant.patientId).owner) fail("FORBIDDEN", "Accès propriétaire requis.", 403);
      return replay(state, JSON.stringify([actor.id, "external_visit_revoke", grantId, clientId]), input, () => {
        if (grant.revision !== expectedRevision) fail("STALE_REVISION", "La consultation a changé.", 409);
        grant.state = "revoked"; grant.revision++;
        const at = new Date(this.clock()).toISOString();
        for (const session of state.externalVisitSessions.filter(item => item.grantId === grantId)) session.invalidatedAt = at;
        journalAccess(state, actor, grant.patientId, "revoke_external_visit", "external_visit", grantId, "allowed");
        return { grant: publicGrant(grant) };
      });
    });
  }

  redeem(input: VisitRedeemInput): VisitSessionResult {
    onlyKeys(input, ["token", "declaredName", "organization"]);
    if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) unavailable();
    const declaredName = boundedText(input.declaredName, 100);
    if (typeof input.organization !== "string" || input.organization.length > 100) fail("INVALID_INPUT");
    const organization = input.organization.trim();
    return this.store.transaction(state => {
      const now = this.clock(), grant = state.externalVisitGrants.find(item => item.tokenHash === hash(input.token));
      if (!grant || grant.state !== "pending" || Date.parse(grant.redeemBy) <= now
        || !state.patients.some(patient => patient.id === grant.patientId && patient.consent)
        || !state.accounts.some(account => account.role === "patient" && account.patientId === grant.patientId && account.enabled)) unavailable();
      const sessionToken = randomBytes(32).toString("base64url"), at = new Date(now).toISOString();
      const session: ExternalVisitSession = { id: careId(), grantId: grant.id, sessionHash: hash(sessionToken), declaredName, organization,
        verification: "unverified", openedAt: at, expiresAt: new Date(now + ABSOLUTE_MS).toISOString(), lastSeenAt: at, invalidatedAt: null };
      grant.state = "active"; grant.revision++;
      state.externalVisitSessions.push(session);
      this.journal(state, session, grant, "redeem_external_visit", "external_visit", grant.id, "allowed");
      return { visit: guestVisit(session), sessionToken };
    });
  }

  private live(state: CareState, token: string): { grant: ExternalVisitGrant; session: ExternalVisitSession } {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) unavailable();
    const now = this.clock(), session = state.externalVisitSessions.find(item => item.sessionHash === hash(token));
    const grant = state.externalVisitGrants.find(item => item.id === session?.grantId);
    if (!session || !grant || session.invalidatedAt || grant.state !== "active" || Date.parse(session.expiresAt) <= now
      || Date.parse(session.lastSeenAt) + IDLE_MS <= now || !state.patients.some(patient => patient.id === grant.patientId && patient.consent)
      || !state.accounts.some(account => account.role === "patient" && account.patientId === grant.patientId && account.enabled)) unavailable();
    return { grant, session };
  }

  private journal(state: CareState, session: ExternalVisitSession, grant: ExternalVisitGrant, action: string, resourceType: string, resourceId: string, outcome: "allowed" | "denied") {
    state.accessJournal.push({ id: careId(), patientId: grant.patientId, actorId: session.id, actorCategory: "guest", actorDisplayName: session.declaredName,
      action, resourceType, resourceId, grantId: grant.id, grantRevision: grant.revision, outcome, at: new Date(this.clock()).toISOString() });
    if (state.accessJournal.length > 10000) state.accessJournal.splice(0, state.accessJournal.length - 10000);
  }

  private denied(token: string, action: string): void {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    this.store.transaction(state => {
      const session = state.externalVisitSessions.find(item => item.sessionHash === hash(token));
      const grant = state.externalVisitGrants.find(item => item.id === session?.grantId);
      if (session && grant) this.journal(state, session, grant, action, "external_visit", grant.id, "denied");
    });
  }

  private transactGuest<T>(token: string, action: string, work: (state: CareState, grant: ExternalVisitGrant, session: ExternalVisitSession) => T): T {
    try {
      return this.store.transaction(state => {
        const { grant, session } = this.live(state, token);
        const result = work(state, grant, session);
        session.lastSeenAt = new Date(this.clock()).toISOString();
        this.journal(state, session, grant, action, "external_visit", grant.id, "allowed");
        return result;
      });
    } catch (error) {
      if (error instanceof CareError && error.code === "VISIT_UNAVAILABLE") this.denied(token, action);
      throw error;
    }
  }

  record(sessionToken: string): GuestRecord {
    return this.transactGuest(sessionToken, "read_guest_record", (state, grant, session) => {
      // Compute timer for this successful access, without extending the absolute bound.
      session.lastSeenAt = new Date(this.clock()).toISOString();
      return { visit: guestVisit(session), selection: structuredClone(grant.frozenProjection),
        notes: structuredClone(state.externalNotes.filter(note => note.grantId === grant.id)) };
    });
  }

  appendNote(sessionToken: string, input: GuestNoteInput): ExternalNote {
    onlyKeys(input, ["text", "consultationDate", "correctsNoteId", "clientId"]);
    const text = boundedText(input.text, 4000), clientId = boundedText(input.clientId, 128);
    if (input.consultationDate !== null && (typeof input.consultationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.consultationDate)
      || !Number.isFinite(Date.parse(input.consultationDate)) || new Date(input.consultationDate).toISOString().slice(0, 10) !== input.consultationDate)) fail("INVALID_INPUT");
    if (input.correctsNoteId !== null && (typeof input.correctsNoteId !== "string" || input.correctsNoteId.length > 128)) fail("INVALID_INPUT");
    const normalized = { text, consultationDate: input.consultationDate, correctsNoteId: input.correctsNoteId, clientId };
    return this.transactGuest(sessionToken, "append_guest_note", (state, grant, session) => {
      if (!grant.appendGuestNotes) unavailable();
      if (input.correctsNoteId && !state.externalNotes.some(note => note.id === input.correctsNoteId && note.grantId === grant.id && note.patientId === grant.patientId)) fail("INVALID_INPUT");
      return replay(state, JSON.stringify(["guest_note", session.id, clientId]), normalized, () => {
        const note: ExternalNote = { id: careId(), patientId: grant.patientId, grantId: grant.id, sessionId: session.id,
          declaredName: session.declaredName, organization: session.organization, verification: "external_unverified", text,
          consultationDate: input.consultationDate, receivedAt: new Date(this.clock()).toISOString(), correctsNoteId: input.correctsNoteId };
        state.externalNotes.push(note);
        bumpPatientRevision(state, grant.patientId, "context");
        bumpPatientRevision(state, grant.patientId, "evidence");
        return note;
      });
    });
  }

  async source(sessionToken: string, documentId: string): Promise<Buffer> {
    const check = (state: CareState) => {
      const { grant } = this.live(state, sessionToken);
      const selected = grant.selection.find(item => item.kind === "document" && item.id === documentId && item.revision === 1);
      const frozen = grant.frozenProjection.documents.find(item => item.id === documentId);
      const current = state.documents.find(item => item.id === documentId && item.patientId === grant.patientId);
      if (!UUID.test(documentId) || !selected || !frozen?.contentHash || !current || current.contentHash !== frozen.contentHash) unavailable();
      return frozen.contentHash;
    };
    try {
      const expectedHash = check(this.store.read());
      const bytes = await this.fileReader(join(this.directory, `${documentId}.pdf`));
      if (!Buffer.isBuffer(bytes) || bytes.length > 5 * 1024 * 1024 || bytes.length < 8 || bytes.subarray(0, 5).toString() !== "%PDF-"
        || createHash("sha256").update(bytes).digest("hex") !== expectedHash) unavailable();
      // No awaits after the transactional live selection/version check and release.
      this.store.transaction(state => {
        if (check(state) !== expectedHash) unavailable();
        const {grant,session}=this.live(state,sessionToken);
        session.lastSeenAt=new Date(this.clock()).toISOString();
        this.journal(state,session,grant,"read_guest_document","document",documentId,"allowed");
      });
      return bytes;
    } catch {
      this.denied(sessionToken, "read_guest_document");
      return unavailable();
    }
  }

  endSession(sessionToken: string): void {
    if (typeof sessionToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return;
    this.store.transaction(state => {
      const session = state.externalVisitSessions.find(item => item.sessionHash === hash(sessionToken));
      if (!session || session.invalidatedAt) return;
      session.invalidatedAt = new Date(this.clock()).toISOString();
      const grant = state.externalVisitGrants.find(item => item.id === session.grantId);
      if (grant) this.journal(state, session, grant, "end_guest_session", "external_visit", grant.id, "allowed");
    });
  }
}
