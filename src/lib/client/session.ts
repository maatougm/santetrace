"use client";

/**
 * Client-side session awareness. The server cookie is the only authority; the
 * cached actor exists solely so an installed patient app can keep queueing
 * measurements while offline, and is always labelled "unverified".
 *
 * Every change of the actor bound to this device goes through
 * `session-cleanup.ts`, which purges a departing actor's device data before
 * another actor is cached or reported as signed in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, toApiError, type Actor, type ApiError, type Role } from "./api";
import { deviceBinding, readCachedActor, type AdmitOutcome, type DeviceBinding } from "./session-cleanup";

export { readCachedActor };

const SESSION_TIMEOUT_MS = 8_000;

export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; actor: Actor; verified: true }
  /** Server unreachable; actor comes from the last verified session on this device. */
  | { status: "offline"; actor: Actor | null; verified: false; verifiedAt: string | null; error: ApiError }
  | { status: "anonymous" }
  /** Includes DEVICE_PURGE_FAILED: the previous actor's data could not be erased, nobody is shown. */
  | { status: "error"; error: ApiError };

function isActor(value: unknown): value is Actor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "clinician" || candidate.role === "patient") &&
    typeof candidate.displayName === "string" &&
    (candidate.patientId === null || typeof candidate.patientId === "string")
  );
}

const SESSION_INVALIDATED_EVENT = "hackcure:session-invalidated";

/** Any API consumer that receives a 401 calls this so the session gate re-checks. */
export function notifySessionInvalidated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
}

/** Where a signed-in actor lands after sign-in. */
export function homePathFor(role: Role): string {
  return role === "clinician" ? "/doctor" : "/patient";
}

export type SessionCheck =
  | { kind: "settled"; state: SessionState }
  /** Network/server failure: a screen verified earlier in this visit stays mounted. */
  | { kind: "transient"; error: ApiError }
  /** Aborted, or overtaken by a logout: keep the current state. */
  | { kind: "superseded" };

export interface CheckSessionOptions {
  signal: AbortSignal;
  /** Called before a departing actor's data is purged; hide every actor meanwhile. */
  onReplacing?: () => void;
  binding?: DeviceBinding;
}

const SUPERSEDED: SessionCheck = { kind: "superseded" };

/** One GET /api/session, then the matching device-binding change. */
export async function checkSession({ signal, onReplacing, binding = deviceBinding }: CheckSessionOptions): Promise<SessionCheck> {
  // Taken before the request: a logout that starts meanwhile makes the answer obsolete.
  const ticket = binding.takeTicket();
  const expire = async (): Promise<SessionCheck> => {
    const outcome = await binding.expire(ticket);
    if (outcome === "superseded" || signal.aborted) return SUPERSEDED;
    return { kind: "settled", state: { status: "anonymous" } };
  };
  try {
    const envelope = await getSession({ signal, timeoutMs: SESSION_TIMEOUT_MS });
    if (signal.aborted) return SUPERSEDED;
    if (!envelope.actor || !isActor(envelope.actor)) return await expire();
    const actor = envelope.actor;
    const outcome = await binding.admit(actor, { ticket, signal, onReplacing });
    if (outcome.status === "purge_failed") {
      return { kind: "settled", state: { status: "error", error: outcome.error.toApiError() } };
    }
    if (outcome.status === "superseded" || signal.aborted) return SUPERSEDED;
    return { kind: "settled", state: { status: "authenticated", actor, verified: true } };
  } catch (caught) {
    if (signal.aborted) return SUPERSEDED;
    const error = toApiError(caught);
    if (error.isAborted) return SUPERSEDED;
    if (error.isUnauthenticated) return expire();
    return { kind: "transient", error };
  }
}

/**
 * A sign-in form just received `actor` from the server: purge any other
 * actor's device data before caching it. Navigate only on "admitted".
 */
export async function adoptSignedInActor(
  actor: Actor,
  binding: DeviceBinding = deviceBinding,
): Promise<AdmitOutcome["status"]> {
  const outcome = await binding.admit(actor, { ticket: binding.takeTicket() });
  return outcome.status;
}

export interface UseSessionResult {
  state: SessionState;
  refresh: () => Promise<void>;
}

/**
 * Reads GET /api/session once on mount, then on demand, when connectivity
 * returns, and when any API call reports a 401.
 */
export function useSession(): UseSessionResult {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const inFlight = useRef<AbortController | null>(null);
  const showingLoading = useRef(true);

  const publish = useCallback((next: SessionState) => {
    showingLoading.current = next.status === "loading";
    setState(next);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const result = await checkSession({
      signal: controller.signal,
      onReplacing: () => publish({ status: "loading" }),
    });
    if (controller.signal.aborted) return;
    if (result.kind === "superseded") {
      // Overtaken by a logout: a verified screen stays until navigation, but a
      // loading screen re-checks (the binding queues it behind the logout).
      if (showingLoading.current) void refresh();
      return;
    }
    if (result.kind === "settled") {
      publish(result.state);
      return;
    }
    const { error } = result;
    showingLoading.current = false;
    // A transient failure after this visit already verified the actor keeps
    // the screen mounted; data views show their own stale/offline banners.
    setState((previous) => {
      if (previous.status === "authenticated") return previous;
      if (error.isOffline) {
        const cached = readCachedActor();
        return {
          status: "offline",
          actor: cached?.actor ?? null,
          verified: false,
          verifiedAt: cached?.verifiedAt ?? null,
          error,
        };
      }
      return { status: "error", error };
    });
  }, [publish]);

  useEffect(() => {
    void refresh();
    const onRecheck = () => void refresh();
    const onDeviceChange = (event: StorageEvent) => {
      if (event.key !== "hackcure:device-revision") return;
      // Hide the old actor immediately; transient errors must not retain it.
      inFlight.current?.abort();
      publish({ status: "loading" });
      void refresh();
    };
    window.addEventListener("storage", onDeviceChange);
    window.addEventListener("online", onRecheck);
    window.addEventListener(SESSION_INVALIDATED_EVENT, onRecheck);
    return () => {
      window.removeEventListener("storage", onDeviceChange);
      window.removeEventListener("online", onRecheck);
      window.removeEventListener(SESSION_INVALIDATED_EVENT, onRecheck);
      inFlight.current?.abort();
    };
  }, [refresh]);

  return { state, refresh };
}
