"use client";

/**
 * Browser-local patient outbox (data-model.md "Outbox").
 *
 * Honest delivery rules implemented here:
 * - Every patient action is written to IndexedDB *before* the first network
 *   attempt, with a stable clientId generated once.
 * - `server_received` is set only after a successful API response and stores
 *   the server's own result (measurement, receivedAt, reminder).
 * - Network/timeout/5xx keep the entry `queued`; 401 keeps it `queued` and
 *   stops replay until the user signs in again; validation/conflict errors and
 *   403 CONSENT_REVOKED become `failed` and are never retried automatically.
 * - Entries belonging to another actor are never listed or replayed.
 * - Clinician acknowledgement is NOT tracked here: it only ever comes from
 *   server alert data.
 */
import {
  acknowledgeReminder,
  submitMeasurement,
  toApiError,
  type ApiError,
  type EvaluatedStatus,
  type GlucoseUnit,
  type MeasurementInput,
  type MeasurementResponse,
  type Reminder,
  type Rules,
} from "./api";
import { createClientId } from "./ids";
import { toOfflineRecord, type OfflineRecord } from "./offline-record";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutboxKind = "measurement" | "reminder_ack";
export type OutboxState = "queued" | "sending" | "server_received" | "failed";
export type OutboxErrorKind =
  | "network"
  | "server"
  | "unavailable"
  | "unauthenticated"
  | "consent_revoked"
  | "forbidden"
  | "rejected"
  | "conflict";

export interface OutboxError {
  kind: OutboxErrorKind;
  code: string;
  status: number;
  /** Server-provided user-facing message, when the server sent one. */
  message: string | null;
  at: string;
}

export interface OutboxScope {
  actorId: string;
  patientId: string;
}

export type MeasurementDraft =
  | { kind: "blood_pressure"; systolic: number; diastolic: number; unit: "mmHg"; measuredAt: string }
  | { kind: "glucose"; value: number; unit: GlucoseUnit; measuredAt: string };

/** Provisional, device-only evaluation against rules cached from the last successful GET. */
export interface LocalEvaluation {
  status: EvaluatedStatus;
  ruleVersion: string;
  /** When the cached rules were last confirmed by the server. */
  rulesSavedAt: string | null;
  rules: Pick<
    Rules,
    "systolicWarn" | "diastolicWarn" | "systolicHigh" | "diastolicHigh" | "glucoseWarn" | "glucoseHigh" | "glucoseUnit"
  >;
  conversion: { fromValue: number; fromUnit: GlucoseUnit; toValue: number; toUnit: GlucoseUnit; factor: number } | null;
}

interface OutboxEntryBase {
  actorId: string;
  patientId: string;
  clientId: string;
  capturedAt: string;
  cachedRuleVersion: string | null;
  state: OutboxState;
  lastError: OutboxError | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  /** Server time of receipt, copied from the server response only. */
  receivedAt?: string;
}

export interface MeasurementEntry extends OutboxEntryBase {
  kind: "measurement";
  payload: MeasurementInput;
  localEvaluation: LocalEvaluation | null;
  result?: MeasurementResponse;
}

export interface ReminderAckEntry extends OutboxEntryBase {
  kind: "reminder_ack";
  payload: { reminderId: string; taken: boolean; clientId: string };
  /** Display context captured from server data at report time. */
  reminder: { label: string; dueAt: string };
  result?: { reminder: Reminder };
}

/**
 * Minimal record kept after a 403 CONSENT_REVOKED: the payload, local
 * evaluation and display context are erased from the device; only what the UI
 * needs to say "bloqué : consentement retiré" remains. Never sent again.
 */
export interface RedactedEntry extends OutboxEntryBase {
  kind: "redacted";
  originalKind: OutboxKind;
  state: "failed";
  payload: null;
}

export type SendableEntry = MeasurementEntry | ReminderAckEntry;
export type OutboxEntry = SendableEntry | RedactedEntry;

export interface PatientSnapshot {
  actorId: string;
  patientId: string;
  savedAt: string;
  /** Allowlisted owner copy only (see offline-record.ts). */
  record: OfflineRecord;
}

export class OutboxStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxStorageError";
  }
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

const DB_NAME = "hackcure-patient";
const DB_VERSION = 1;
const OUTBOX_STORE = "outbox";
const SNAPSHOT_STORE = "snapshots";
const ACTOR_INDEX = "actorId";
/** A "sending" entry with no live request after this long is treated as queued. */
const STALE_SENDING_MS = 60_000;
/** Server-received entries are kept briefly for result screens, then pruned. */
const RECEIVED_RETENTION_MS = 7 * 24 * 3600 * 1000;
const CHANNEL_NAME = "hackcure-outbox";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new OutboxStorageError("IndexedDB is not available on this device."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "clientId" });
        store.createIndex(ACTOR_INDEX, "actorId", { unique: false });
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: "actorId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(new OutboxStorageError(request.error?.message ?? "Unable to open local storage."));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new OutboxStorageError("Local storage is blocked by another open tab."));
    };
  });
  return dbPromise;
}

function runTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => (() => T) | void,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(stores, mode);
        } catch (error) {
          reject(new OutboxStorageError(error instanceof Error ? error.message : "Transaction failed."));
          return;
        }
        const read = work(transaction);
        transaction.oncomplete = () => resolve(read ? read() : (undefined as T));
        transaction.onerror = () => reject(new OutboxStorageError(transaction.error?.message ?? "Transaction failed."));
        transaction.onabort = () => reject(new OutboxStorageError(transaction.error?.message ?? "Transaction aborted."));
      }),
  );
}

// ---------------------------------------------------------------------------
// Shape checks for data read back from storage (never trust stored data)
// ---------------------------------------------------------------------------

const STATES: readonly OutboxState[] = ["queued", "sending", "server_received", "failed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutboxEntry(value: unknown): value is OutboxEntry {
  if (!isRecord(value)) return false;
  const stringsOk = ["actorId", "patientId", "clientId", "capturedAt", "createdAt", "updatedAt"].every(
    (key) => typeof value[key] === "string",
  );
  if (!stringsOk || !STATES.includes(value.state as OutboxState) || typeof value.attempts !== "number") return false;
  if (value.kind === "redacted") {
    return (
      value.payload === null &&
      value.state === "failed" &&
      (value.originalKind === "measurement" || value.originalKind === "reminder_ack")
    );
  }
  if (!isRecord(value.payload)) return false;
  if (value.kind === "measurement") {
    const { payload } = value;
    return (
      payload.clientId === value.clientId &&
      (payload.kind === "blood_pressure" || payload.kind === "glucose") &&
      typeof payload.measuredAt === "string" &&
      typeof payload.unit === "string"
    );
  }
  if (value.kind === "reminder_ack") {
    return (
      value.payload.clientId === value.clientId &&
      typeof value.payload.reminderId === "string" &&
      typeof value.payload.taken === "boolean" &&
      isRecord(value.reminder)
    );
  }
  return false;
}

function isSnapshot(value: unknown, actorId: string): value is PatientSnapshot {
  if (!isRecord(value) || value.actorId !== actorId || typeof value.savedAt !== "string") return false;
  const record = value.record;
  if (!isRecord(record) || !isRecord(record.patient)) return false;
  return (
    record.patient.id === value.patientId &&
    ["measurements", "alerts", "reminders", "observations", "documents", "candidates"].every((key) =>
      Array.isArray(record[key]),
    )
  );
}

// ---------------------------------------------------------------------------
// Change notification (same tab + other tabs)
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => listeners.forEach((listener) => listener());
}

function notifyChange(): void {
  listeners.forEach((listener) => listener());
  channel?.postMessage("changed");
}

export function subscribeOutbox(listener: () => void): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

const nowIso = (): string => new Date().toISOString();

async function saveEntry(entry: OutboxEntry, lease = leaseFor(entry.actorId)): Promise<void> {
  await runTransaction<void>([OUTBOX_STORE], "readwrite", (transaction) => {
    if (!validLease(entry.actorId, lease)) { transaction.abort(); return; }
    transaction.objectStore(OUTBOX_STORE).put(entry);
  });
}

/** Lists this actor's entries for one patient, newest first. */
export async function listEntries(scope: OutboxScope): Promise<OutboxEntry[]> {
  const raw = await runTransaction<unknown[]>([OUTBOX_STORE], "readonly", (transaction) => {
    const request = transaction.objectStore(OUTBOX_STORE).index(ACTOR_INDEX).getAll(IDBKeyRange.only(scope.actorId));
    return () => request.result as unknown[];
  });
  return raw
    .filter(isOutboxEntry)
    .filter((entry) => entry.actorId === scope.actorId && entry.patientId === scope.patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Tombstones: discarded entries and purged actors must never be re-written by
// a send or poll that was already running when the user removed them.
// ---------------------------------------------------------------------------

const discardedClientIds = new Set<string>();
const purgedActorIds = new Set<string>();
/**
 * Per-actor generation. A send captures it when it starts; a purge bumps it.
 * reviveActor() re-allows NEW work but never resets the epoch, so a response
 * that settles after a purge (even after the same actor signs back in) is
 * fenced: it persists nothing and is not reported as received.
 */
const actorEpochs = new Map<string, number>();
// Durable per-actor fences are checked again inside the IndexedDB write
// transaction. Purge-before-write rejects stale work; write-before-purge is
// deleted by the later purge transaction, irrespective of event delivery.
const actorLeases = new Map<string, string>();
const fenceKey = (actorId: string) => `hackcure:actor-fence:${actorId}`;
function durableFence(actorId: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(fenceKey(actorId)) ?? "";
}
function leaseFor(actorId: string): string {
  if (!actorLeases.has(actorId)) actorLeases.set(actorId, durableFence(actorId));
  return actorLeases.get(actorId)!;
}
function validLease(actorId: string, lease: string): boolean {
  try {
    if (durableFence(actorId) !== lease) return false;
    if (typeof window !== "undefined" && window.localStorage.getItem("hackcure:device-revision")) {
      const raw = window.localStorage.getItem("hackcure:device-owner");
      const owner: unknown = raw ? JSON.parse(raw) : null;
      if (!isRecord(owner) || owner.actorId !== actorId || owner.role !== "patient") return false;
    }
    return true;
  } catch { return false; }
}


function epochOf(actorId: string): number {
  return actorEpochs.get(actorId) ?? 0;
}

function isTombstoned(entry: Pick<OutboxEntry, "clientId" | "actorId">): boolean {
  return discardedClientIds.has(entry.clientId) || purgedActorIds.has(entry.actorId);
}

/** Re-enables writes for an actor that signs in again after a purge in this tab. */
export function reviveActor(actorId: string): void {
  purgedActorIds.delete(actorId);
  actorLeases.set(actorId, durableFence(actorId));
}

async function getStoredEntry(clientId: string): Promise<OutboxEntry | null> {
  const raw = await runTransaction<unknown>([OUTBOX_STORE], "readonly", (transaction) => {
    const request = transaction.objectStore(OUTBOX_STORE).get(clientId);
    return () => request.result as unknown;
  });
  return isOutboxEntry(raw) ? raw : null;
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  if (isTombstoned(entry)) throw new OutboxStorageError("This device data was removed.");
  await saveEntry(entry);
  notifyChange();
}

export async function discardEntry(scope: OutboxScope, clientId: string): Promise<void> {
  discardedClientIds.add(clientId);
  await runTransaction<void>([OUTBOX_STORE], "readwrite", (transaction) => {
    const store = transaction.objectStore(OUTBOX_STORE);
    const request = store.get(clientId);
    request.onsuccess = () => {
      const value: unknown = request.result;
      // Only ever delete the current actor's own entry.
      if (isRecord(value) && value.actorId === scope.actorId) store.delete(clientId);
    };
  });
  notifyChange();
}

/**
 * Deletes every outbox entry and cached snapshot of this actor (logout).
 * Does NOT wait for running sends: it fences them (epoch bump + tombstone) so
 * that, whenever they settle, they write nothing back, then deletes at once.
 */
export async function purgeActorData(actorId: string): Promise<void> {
  if (typeof window !== "undefined") window.localStorage.setItem(fenceKey(actorId), crypto.randomUUID());
  purgedActorIds.add(actorId);
  actorEpochs.set(actorId, epochOf(actorId) + 1);
  await runTransaction<void>([OUTBOX_STORE, SNAPSHOT_STORE], "readwrite", (transaction) => {
    const index = transaction.objectStore(OUTBOX_STORE).index(ACTOR_INDEX);
    const cursorRequest = index.openCursor(IDBKeyRange.only(actorId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.objectStore(SNAPSHOT_STORE).delete(actorId);
  });
  notifyChange();
}

/**
 * Deletes ONLY this actor's cached PatientSnapshot (device copy of the record).
 * Used when the server session expired: outbox entries are kept so unsent items
 * can replay after the same patient signs in again, and the actor is NOT
 * tombstoned (they may sign back in during this page lifetime).
 */
export async function discardSnapshot(actorId: string): Promise<void> {
  await runTransaction<void>([SNAPSHOT_STORE], "readwrite", (transaction) => {
    transaction.objectStore(SNAPSHOT_STORE).delete(actorId);
  });
  notifyChange();
}

/** Deletes server-received entries older than the retention window; returns the rest. */
export async function pruneReceivedEntries(entries: OutboxEntry[]): Promise<OutboxEntry[]> {
  const cutoff = Date.now() - RECEIVED_RETENTION_MS;
  const expired = entries.filter((entry) => entry.state === "server_received" && Date.parse(entry.updatedAt) < cutoff);
  if (expired.length === 0) return entries;
  await runTransaction<void>([OUTBOX_STORE], "readwrite", (transaction) => {
    const store = transaction.objectStore(OUTBOX_STORE);
    expired.forEach((entry) => store.delete(entry.clientId));
  });
  const expiredIds = new Set(expired.map((entry) => entry.clientId));
  return entries.filter((entry) => !expiredIds.has(entry.clientId));
}

export async function saveSnapshot(snapshot: PatientSnapshot): Promise<void> {
  // A poll that lands after logout purge must not re-create the device copy.
  if (purgedActorIds.has(snapshot.actorId)) return;
  // Only the allowlisted owner copy is ever written (never a 006 expanded record).
  const record = toOfflineRecord(snapshot.record);
  if (!record) return;
  const allowed: PatientSnapshot = { ...snapshot, record };
  const lease = leaseFor(allowed.actorId);
  await runTransaction<void>([SNAPSHOT_STORE], "readwrite", (transaction) => {
    if (!validLease(allowed.actorId, lease)) { transaction.abort(); return; }
    transaction.objectStore(SNAPSHOT_STORE).put(allowed);
  });
}

export async function loadSnapshot(scope: OutboxScope): Promise<PatientSnapshot | null> {
  const raw = await runTransaction<unknown>([SNAPSHOT_STORE], "readonly", (transaction) => {
    const request = transaction.objectStore(SNAPSHOT_STORE).get(scope.actorId);
    return () => request.result as unknown;
  });
  if (!isSnapshot(raw, scope.actorId) || raw.patientId !== scope.patientId) return null;
  // Older copies may hold more than today's allowlist: re-sanitise on read.
  const record = toOfflineRecord(raw.record);
  return record ? { ...raw, record } : null;
}

// ---------------------------------------------------------------------------
// Entry creation (clientId generated exactly once, here)
// ---------------------------------------------------------------------------

function baseEntry(scope: OutboxScope, clientId: string, capturedAt: string, cachedRuleVersion: string | null) {
  const now = nowIso();
  return {
    actorId: scope.actorId,
    patientId: scope.patientId,
    clientId,
    capturedAt,
    cachedRuleVersion,
    state: "queued" as const,
    lastError: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: null,
  };
}

export function createMeasurementEntry(
  scope: OutboxScope,
  draft: MeasurementDraft,
  localEvaluation: LocalEvaluation | null,
): MeasurementEntry {
  const clientId = createClientId("m");
  const now = nowIso();
  // The server requires capturedAt >= measuredAt.
  const capturedAt = Date.parse(draft.measuredAt) > Date.parse(now) ? draft.measuredAt : now;
  const payload: MeasurementInput =
    draft.kind === "blood_pressure"
      ? {
          kind: "blood_pressure",
          systolic: draft.systolic,
          diastolic: draft.diastolic,
          unit: "mmHg",
          measuredAt: draft.measuredAt,
          capturedAt,
          clientId,
        }
      : { kind: "glucose", value: draft.value, unit: draft.unit, measuredAt: draft.measuredAt, capturedAt, clientId };
  return {
    ...baseEntry(scope, clientId, capturedAt, localEvaluation?.ruleVersion ?? null),
    kind: "measurement",
    payload,
    localEvaluation,
  };
}

export function createReminderAckEntry(
  scope: OutboxScope,
  reminder: Pick<Reminder, "id" | "label" | "dueAt">,
  taken: boolean,
  cachedRuleVersion: string | null,
): ReminderAckEntry {
  const clientId = createClientId("r");
  return {
    ...baseEntry(scope, clientId, nowIso(), cachedRuleVersion),
    kind: "reminder_ack",
    payload: { reminderId: reminder.id, taken, clientId },
    reminder: { label: reminder.label, dueAt: reminder.dueAt },
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function classify(error: ApiError): { state: OutboxState; kind: OutboxErrorKind } {
  if (error.isOffline || error.isAborted) return { state: "queued", kind: "network" };
  // A malformed success may still mean the server stored it: replay is idempotent.
  if (error.kind === "invalid_response") return { state: "queued", kind: "server" };
  if (error.status === 401) return { state: "queued", kind: "unauthenticated" };
  if (error.status === 403 && error.code === "CONSENT_REVOKED") return { state: "failed", kind: "consent_revoked" };
  if (error.status === 403) return { state: "failed", kind: "forbidden" };
  if (error.isUnavailable) return { state: "queued", kind: "unavailable" };
  if (error.status === 408 || error.status === 429 || error.status >= 500) return { state: "queued", kind: "server" };
  if (error.status === 409) return { state: "failed", kind: "conflict" };
  return { state: "failed", kind: "rejected" };
}

function withFailure<E extends OutboxEntry>(entry: E, error: ApiError): E {
  const { state, kind } = classify(error);
  const at = nowIso();
  return {
    ...entry,
    state,
    updatedAt: at,
    lastError: { kind, code: error.code, status: error.status, message: error.serverMessage, at },
  };
}

/**
 * Builds the minimal record kept after consent withdrawal. Constructed field by
 * field (no spread) so payload, local evaluation, reminder label and server
 * result can never leak into storage.
 */
function redact(entry: OutboxEntry, error: OutboxError): RedactedEntry {
  return {
    actorId: entry.actorId,
    patientId: entry.patientId,
    clientId: entry.clientId,
    capturedAt: entry.capturedAt,
    cachedRuleVersion: null,
    state: "failed",
    lastError: error,
    attempts: entry.attempts,
    createdAt: entry.createdAt,
    updatedAt: error.at,
    lastAttemptAt: entry.lastAttemptAt,
    kind: "redacted",
    originalKind: entry.kind === "redacted" ? entry.originalKind : entry.kind,
    payload: null,
  };
}

async function transmit(entry: SendableEntry): Promise<SendableEntry> {
  if (entry.kind === "measurement") {
    const result = await submitMeasurement(entry.patientId, entry.payload);
    return {
      ...entry,
      state: "server_received",
      result,
      receivedAt: result.measurement.receivedAt,
      lastError: null,
      updatedAt: nowIso(),
    };
  }
  const result = await acknowledgeReminder(entry.payload.reminderId, {
    taken: entry.payload.taken,
    clientId: entry.payload.clientId,
  });
  return {
    ...entry,
    state: "server_received",
    result,
    receivedAt: result.reminder.acknowledgedAt ?? undefined,
    lastError: null,
    updatedAt: nowIso(),
  };
}

const inFlight = new Map<string, Promise<OutboxEntry>>();

async function performSend(entry: OutboxEntry, persist: boolean): Promise<OutboxEntry> {
  // Redacted (consent withdrawn) entries have no payload and are never sent.
  if (entry.kind === "redacted") return entry;
  // Removed by the user (discard / logout purge): never send, never re-create.
  if (persist && isTombstoned(entry)) return entry;
  const epoch = epochOf(entry.actorId);
  let lease: string;
  try { lease = leaseFor(entry.actorId); } catch { return entry; }
  const fenced = () => epochOf(entry.actorId) !== epoch || !validLease(entry.actorId, lease);
  if (fenced()) return entry;
  const startedAt = nowIso();
  const sending: SendableEntry = {
    ...entry,
    state: "sending",
    attempts: entry.attempts + 1,
    lastAttemptAt: startedAt,
    updatedAt: startedAt,
  };
  if (persist && !fenced()) {
    try {
      await saveEntry(sending, lease);
      notifyChange();
    } catch {
      // The entry is already stored as "queued"; sending proceeds and the
      // final state below is written (or reconciled by idempotent replay).
    }
  }
  let next: SendableEntry;
  try {
    next = await transmit(sending);
  } catch (error) {
    next = withFailure(sending, toApiError(error));
  }
  // The actor's device data was purged while this request was out (logout):
  // persist nothing and do not report the outcome as received to any screen.
  if (fenced()) return entry;
  if (persist && !isTombstoned(next)) {
    // Consent withdrawn: store only a minimal record. The full entry is still
    // returned to the caller below for the screen currently showing it.
    const stored: OutboxEntry =
      next.lastError?.kind === "consent_revoked" ? redact(next, next.lastError) : next;
    try {
      await saveEntry(stored, lease);
    } catch {
      // The stored copy stays "sending" and becomes replayable after
      // STALE_SENDING_MS; the server's idempotency on clientId reconciles it.
      // The caller still receives the true outcome below.
    }
    notifyChange();
  }
  return fenced() ? entry : next;
}

/**
 * Sends one entry (persisting each state transition unless `persist` is false,
 * used only when local storage is unavailable). Concurrent calls for the same
 * clientId share one request.
 */
export function sendEntry<E extends OutboxEntry>(entry: E, options: { persist?: boolean } = {}): Promise<E> {
  const existing = inFlight.get(entry.clientId);
  if (existing) return existing as Promise<E>;
  const promise = performSend(entry, options.persist ?? true).finally(() => {
    inFlight.delete(entry.clientId);
  });
  inFlight.set(entry.clientId, promise);
  return promise as Promise<E>;
}

function isReplayable(entry: OutboxEntry, now: number): boolean {
  if (entry.state === "queued") return true;
  if (entry.state !== "sending" || inFlight.has(entry.clientId)) return false;
  const last = entry.lastAttemptAt ? Date.parse(entry.lastAttemptAt) : 0;
  return now - last > STALE_SENDING_MS;
}

export interface ReplayReport {
  attempted: number;
  received: number;
  failed: number;
  /** Why replay stopped early (still queued items remain), if it did. */
  stoppedBy: OutboxErrorKind | null;
  finishedAt: string;
}

async function blockRemaining(entries: OutboxEntry[], error: OutboxError): Promise<void> {
  const remaining = entries.filter((entry) => !isTombstoned(entry));
  if (remaining.length === 0) return;
  await runTransaction<void>([OUTBOX_STORE], "readwrite", (transaction) => {
    const store = transaction.objectStore(OUTBOX_STORE);
    remaining.forEach((entry) => {
      const request = store.get(entry.clientId);
      request.onsuccess = () => {
        // Only block entries that still exist and are still waiting; their
        // payloads are erased (consent withdrawn), a minimal record stays visible.
        const stored: unknown = request.result;
        if (isOutboxEntry(stored) && (stored.state === "queued" || stored.state === "sending")) {
          store.put(redact(stored, error));
        }
      };
    });
  });
}

async function runReplay(scope: OutboxScope): Promise<ReplayReport> {
  const now = Date.now();
  const pending = (await listEntries(scope))
    .filter((entry) => isReplayable(entry, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let attempted = 0;
  let received = 0;
  let failed = 0;
  let stoppedBy: OutboxErrorKind | null = null;

  for (let index = 0; index < pending.length; index += 1) {
    // Re-read just before sending: the user may have discarded it, or another
    // tab may already have delivered it, since the queue was listed.
    const fresh = await getStoredEntry(pending[index].clientId);
    if (!fresh || isTombstoned(fresh) || fresh.actorId !== scope.actorId || !isReplayable(fresh, Date.now())) continue;
    const next = await sendEntry(fresh);
    attempted += 1;
    if (next.state === "server_received") {
      received += 1;
      continue;
    }
    if (next.state === "failed") {
      failed += 1;
      if (next.lastError?.kind === "consent_revoked") {
        // Consent withdrawal blocks every later upload from this device.
        const rest = pending.slice(index + 1);
        await blockRemaining(rest, next.lastError);
        failed += rest.length;
        stoppedBy = "consent_revoked";
        break;
      }
      continue;
    }
    // Still queued: offline, server down or session expired. Stop for now.
    stoppedBy = next.lastError?.kind ?? "network";
    break;
  }
  notifyChange();
  return { attempted, received, failed, stoppedBy, finishedAt: nowIso() };
}

let replayPromise: Promise<ReplayReport> | null = null;

/** Replays this actor's queued entries oldest first. Only one replay runs at a time. */
export function replayOutbox(scope: OutboxScope): Promise<ReplayReport> {
  if (replayPromise) return replayPromise;
  replayPromise = runReplay(scope).finally(() => {
    replayPromise = null;
  });
  return replayPromise;
}

