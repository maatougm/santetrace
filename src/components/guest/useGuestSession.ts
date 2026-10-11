"use client";

/**
 * Guest session reads and local deadlines. GET /api/external-visit/record
 * counts as activity on the server (it moves the idle deadline), so it is
 * never called on a timer: once on mount, then only for an explicit user
 * action (see guest-record-loader.ts). The view also clears itself at the
 * earliest of the idle deadline and the absolute cap the server last gave;
 * the server stays the authority and may end the session earlier.
 */
import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { getGuestRecord } from "@/lib/client/share-api";
import { createGuestRecordLoader, type GuestRecordLoader } from "./guest-record-loader";
import { isVisitExpired, visitDeadline, type GuestSessionAction } from "./guest-state";

/** setTimeout's ceiling (~24.8 days); longer delays would fire immediately. */
const MAX_TIMER_MS = 2_147_483_647;

/** Reads once while `enabled`; returns a reload for explicit user actions (no-op once the session is over). */
export function useGuestRecord(dispatch: Dispatch<GuestSessionAction>, enabled: boolean): () => void {
  const loaderRef = useRef<GuestRecordLoader | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const loader = createGuestRecordLoader((signal) => getGuestRecord({ signal }), dispatch);
    loaderRef.current = loader;
    loader.load();
    return () => {
      loader.stop();
      if (loaderRef.current === loader) loaderRef.current = null;
    };
  }, [dispatch, enabled]);

  return useCallback(() => loaderRef.current?.load(), []);
}

/** Clears the view at the earliest local deadline; re-armed whenever a server answer moves it. */
export function useLocalExpiry(expiresAt: string | null, idleExpiresAt: string | null, dispatch: Dispatch<GuestSessionAction>): void {
  useEffect(() => {
    if (!expiresAt || !idleExpiresAt) return undefined;
    const visit = { expiresAt, idleExpiresAt };
    const deadline = visitDeadline(visit);
    if (deadline === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Re-armed until the instant really passed (a delay above the timer ceiling fires early).
    const arm = () => {
      if (isVisitExpired(visit, Date.now())) {
        dispatch({ type: "expired_locally" });
        return;
      }
      timer = setTimeout(arm, Math.min(deadline - Date.now(), MAX_TIMER_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [expiresAt, idleExpiresAt, dispatch]);
}
