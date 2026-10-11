"use client";

/**
 * Device binding: which actor's private data this browser may still hold, and
 * the only code allowed to change it.
 *
 * Two localStorage keys:
 * - `hackcure:last-actor`: the last verified actor (display identity), used
 *   solely so an installed patient app can keep queueing while offline.
 * - `hackcure:device-owner`: the actor whose outbox/snapshot may be on this
 *   device (id + role only). It survives session expiry and is removed only
 *   once that actor's data has been purged.
 *
 * Rules enforced here, whatever the calling screen does:
 * - Another actor is never cached or reported as signed in before the
 *   departing actor's device data is purged. A failed purge publishes nothing.
 * - Explicit logout always purges, after any optional UI callback, and keeps
 *   the server session when the purge fails (no "logout anyway").
 * - A session read that started before a logout can no longer bind anyone
 *   (durable device revision). Outbox writers additionally check durable actor
 *   fences inside their IndexedDB transactions. Storage denial blocks admission.
 */
import { ApiError, type Actor, type Role } from "./api";

const CACHED_ACTOR_KEY = "hackcure:last-actor";
const DEVICE_OWNER_KEY = "hackcure:device-owner";
const DEVICE_REVISION_KEY = "hackcure:device-revision";

/** Fail closed: absence and an unreadable identity store are different states. */
export function deviceRevision(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(DEVICE_REVISION_KEY) ?? "";
}
function advanceRevision(pending = false): string {
  const revision = `${pending ? "pending:" : ""}${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_REVISION_KEY, revision);
  return revision;
}
function requireIdentityStorage(): void {
  deviceRevision();
  const key = "hackcure:storage-probe";
  window.localStorage.setItem(key, "1");
  if (window.localStorage.getItem(key) !== "1") throw new Error("Identity storage unavailable");
  window.localStorage.removeItem(key);
}


export const DEVICE_PURGE_FAILED = "DEVICE_PURGE_FAILED";

export interface CachedActor {
  actor: Actor;
  verifiedAt: string;
}

/** Minimal reference to the actor whose data may remain on this device. */
export interface DeviceOwner {
  actorId: string;
  role: Role;
}

export class DevicePurgeError extends Error {
  readonly code = DEVICE_PURGE_FAILED;

  constructor(cause: unknown) {
    super("Private data of the previous session could not be erased from this device.", { cause });
    this.name = "DevicePurgeError";
  }

  /** Session-state form: honest user-facing French text, shown by error screens. */
  toApiError(): ApiError {
    return new ApiError({
      status: 0,
      code: DEVICE_PURGE_FAILED,
      kind: "http",
      message: this.message,
      serverMessage:
        "Les données de la session précédente n’ont pas pu être effacées de cet appareil. Aucun autre compte n’est affiché tant que ce n’est pas fait. Fermez les autres onglets Santetrace puis réessayez.",
    });
  }
}

// ---------------------------------------------------------------------------
// Storage (never trust what is read back)
// ---------------------------------------------------------------------------

function isRole(value: unknown): value is Role {
  return value === "clinician" || value === "patient";
}

function isActor(value: unknown): value is Actor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    isRole(candidate.role) &&
    typeof candidate.displayName === "string" &&
    (candidate.patientId === null || typeof candidate.patientId === "string")
  );
}

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (cause) {
    throw new DevicePurgeError(cause);
  }
}

function removeKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch (cause) {
    throw new DevicePurgeError(cause);
  }
}

export function readCachedActor(): CachedActor | null {
  const parsed = readJson(CACHED_ACTOR_KEY);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { actor, verifiedAt } = parsed as Record<string, unknown>;
  if (!isActor(actor) || typeof verifiedAt !== "string") return null;
  return { actor, verifiedAt };
}

export function readDeviceOwner(): DeviceOwner | null {
  const parsed = readJson(DEVICE_OWNER_KEY);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { actorId, role } = parsed as Record<string, unknown>;
  return typeof actorId === "string" && actorId && isRole(role) ? { actorId, role } : null;
}

const ownerOf = (actor: Actor): DeviceOwner => ({ actorId: actor.id, role: actor.role });

/** Owner reference, cached actor (devices written before the owner key) and an optional hint. */
function knownOwners(hint: Actor | null = null): DeviceOwner[] {
  const cached = readCachedActor();
  const candidates = [readDeviceOwner(), cached ? ownerOf(cached.actor) : null, hint ? ownerOf(hint) : null];
  return candidates.reduce<DeviceOwner[]>((unique, owner) => {
    if (!owner || unique.some((known) => known.actorId === owner.actorId)) return unique;
    return [...unique, owner];
  }, []);
}

function bind(actor: Actor): void {
  // Owner first: if the second write fails, the data is still referenced.
  writeJson(DEVICE_OWNER_KEY, ownerOf(actor));
  writeJson(CACHED_ACTOR_KEY, { actor, verifiedAt: new Date().toISOString() } satisfies CachedActor);
}

function unbind(): void {
  removeKey(CACHED_ACTOR_KEY);
  removeKey(DEVICE_OWNER_KEY);
}

// ---------------------------------------------------------------------------
// Purge driver
// ---------------------------------------------------------------------------

export interface DevicePurger {
  /** Deletes every queued action and device copy of this patient actor, fencing in-flight sends. */
  purgeActor: (actorId: string) => Promise<void>;
  /** Deletes only the device copy of the record (session expiry). */
  discardSnapshot: (actorId: string) => Promise<void>;
}

/** Real driver: the IndexedDB outbox, loaded only when a patient's data is involved. */
const outboxPurger: DevicePurger = {
  purgeActor: async (actorId) => {
    // Without IndexedDB nothing can have been stored on this device.
    if (typeof indexedDB === "undefined") return;
    const { purgeActorData } = await import("./outbox");
    await purgeActorData(actorId);
  },
  discardSnapshot: async (actorId) => {
    if (typeof indexedDB === "undefined") return;
    const { discardSnapshot } = await import("./outbox");
    await discardSnapshot(actorId);
  },
};

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/** Taken before a session request is sent; stale once a logout has started since. */
export interface SessionTicket {
  readonly generation: number;
  readonly revision: string | null;
}

export type AdmitOutcome =
  | { status: "admitted" }
  /** A newer check or a logout overtook this one: nothing was written. */
  | { status: "superseded" }
  /** The departing actor's data is still on the device: nothing was written. */
  | { status: "purge_failed"; error: DevicePurgeError };

export interface AdmitOptions {
  ticket: SessionTicket;
  /** Aborted when a newer session check replaces this one. */
  signal?: AbortSignal;
  /** Called before another actor's data is purged, so screens hide both actors meanwhile. */
  onReplacing?: () => void;
}

export interface LogoutRequest {
  /** The actor the screen shows; purged too even if no binding was recorded. */
  actor?: Actor | null;
  /** Optional UI step (e.g. unsent-items warning). false cancels. It cannot skip the purge. */
  beforeLogout?: () => Promise<boolean> | boolean;
  /** DELETE /api/session. Called only after the device purge succeeded. */
  endServerSession: () => Promise<void>;
}

export type LogoutOutcome =
  | { status: "cancelled" }
  | { status: "preparation_failed"; message: string }
  /** Nothing was signed out: the user stays signed in and can retry. */
  | { status: "purge_failed"; error: DevicePurgeError }
  /** Device purged. serverError is set when the server did not confirm the sign-out. */
  | { status: "signed_out"; serverError: unknown };

export interface DeviceBinding {
  takeTicket: () => SessionTicket;
  /** Server verified `actor`: purge any other actor's device data, then cache `actor`. */
  admit: (actor: Actor, options: AdmitOptions) => Promise<AdmitOutcome>;
  /** Server reports no session: drop the offline identity and record copy, keep the owner reference. */
  expire: (ticket: SessionTicket) => Promise<"expired" | "superseded">;
  /** Explicit logout or account switch. */
  logout: (request: LogoutRequest) => Promise<LogoutOutcome>;
}

export function createDeviceBinding(purger: DevicePurger = outboxPurger): DeviceBinding {
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();

  /** Runs binding changes one at a time (session checks, expiry and logout). */
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  }

  const isCurrent = (ticket: SessionTicket, signal?: AbortSignal): boolean =>
    ticket.generation === generation && ticket.revision !== null && ticket.revision === deviceRevision() && !signal?.aborted;

  /** Purges the device data of every patient listed. Clinicians store nothing in the outbox. */
  async function purge(owners: DeviceOwner[]): Promise<DevicePurgeError | null> {
    for (const owner of owners) {
      if (owner.role !== "patient") continue;
      try {
        await purger.purgeActor(owner.actorId);
      } catch (cause) {
        return new DevicePurgeError(cause);
      }
    }
    return null;
  }

  const admit: DeviceBinding["admit"] = (actor, options) => {
    let ownedRevision: string | null = null;
    return exclusive(async () => {
      try { requireIdentityStorage(); } catch (cause) {
        return { status: "purge_failed", error: new DevicePurgeError(cause) };
      }
      if (!isCurrent(options.ticket, options.signal)) return { status: "superseded" };
      const departing = knownOwners().filter((owner) => owner.actorId !== actor.id);
      if (departing.length > 0) {
        // Persist before awaiting: another tab's earlier request is now obsolete.
        ownedRevision = advanceRevision(true);
        options = { ...options, ticket: { ...options.ticket, revision: ownedRevision } };
        options.onReplacing?.();
        // The departing actor must no longer be offered offline, even if the purge fails.
        removeKey(CACHED_ACTOR_KEY);
        const failure = await purge(departing);
        if (failure) return { status: "purge_failed", error: failure };
        // Check before mutating shared identity: another tab may have already
        // admitted a newer actor while this purge was awaiting completion.
        if (!isCurrent(options.ticket, options.signal)) return { status: "superseded" };
        // Their data is gone and this operation still owns the reference.
        unbind();
      }
      if (!isCurrent(options.ticket, options.signal)) return { status: "superseded" };
      if (!readDeviceOwner()) advanceRevision();
      bind(actor);
      return { status: "admitted" } as AdmitOutcome;
    }).catch((cause): AdmitOutcome => ({ status: "purge_failed", error: new DevicePurgeError(cause) }))
      .finally(() => {
        try { if (ownedRevision && deviceRevision() === ownedRevision) advanceRevision(); } catch { /* Next admission fails closed. */ }
      }) as Promise<AdmitOutcome>;
  };

  const expire: DeviceBinding["expire"] = (ticket) =>
    exclusive(async () => {
      if (!isCurrent(ticket)) return "superseded";
      const cached = readCachedActor();
      const owner = readDeviceOwner() ?? (cached ? ownerOf(cached.actor) : null);
      // Keep (or migrate) the reference: the queue may replay for the same
      // actor, and any other actor triggers a full purge before being shown.
      if (owner) writeJson(DEVICE_OWNER_KEY, owner);
      removeKey(CACHED_ACTOR_KEY);
      if (owner?.role === "patient") {
        try {
          await purger.discardSnapshot(owner.actorId);
        } catch {
          // The record copy stays until the owner's full purge, which the
          // retained reference forces before any other actor is published.
        }
      }
      // An awaited snapshot deletion must not publish anonymous over a newer
      // verified actor admitted by another context in the meantime.
      return isCurrent(ticket) ? "expired" : "superseded";
    });

  const logout: DeviceBinding["logout"] = async ({ actor = null, beforeLogout, endServerSession }) => {
    if (beforeLogout) {
      try {
        if (!(await beforeLogout())) return { status: "cancelled" };
      } catch (caught) {
        return { status: "preparation_failed", message: caught instanceof Error ? caught.message : "LOGOUT_PREPARATION_FAILED" };
      }
    }
    // Session reads already in flight may no longer bind anyone.
    generation += 1;
    let logoutRevision: string;
    try { requireIdentityStorage(); logoutRevision = advanceRevision(true); }
    catch (cause) { return { status: "purge_failed", error: new DevicePurgeError(cause) }; }
    return exclusive<LogoutOutcome>(async () => {
      if (deviceRevision() !== logoutRevision) return { status: "purge_failed", error: new DevicePurgeError("Another tab changed the account during logout") };
      const failure = await purge(knownOwners(actor));
      // References are kept: the user stays signed in and a retry finds them.
      if (failure) return { status: "purge_failed", error: failure };
      if (deviceRevision() !== logoutRevision) return { status: "purge_failed", error: new DevicePurgeError("Another tab changed the account during logout") };
      unbind();
      let serverError: unknown = null;
      try {
        await endServerSession();
      } catch (caught) {
        serverError = caught;
      }
      // Reads started while signing out are obsolete too.
      generation += 1;
      if (deviceRevision() === logoutRevision) { advanceRevision(); unbind(); }
      return { status: "signed_out", serverError };
    }).catch((cause): LogoutOutcome => ({ status: "purge_failed", error: new DevicePurgeError(cause) }))
      .finally(() => {
        try { if (deviceRevision() === logoutRevision) advanceRevision(); } catch { /* Retry stays blocked. */ }
      });
  };

  return { takeTicket: () => {
    let revision: string | null;
    try { revision = deviceRevision(); if (revision.startsWith("pending:")) revision = null; } catch { revision = null; }
    return { generation, revision };
  }, admit, expire, logout };
}

/** The binding used by the app (one per tab). */
export const deviceBinding: DeviceBinding = createDeviceBinding();
