"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { signOut, toApiError, type Actor } from "@/lib/client/api";
import { DEVICE_PURGE_FAILED, deviceBinding } from "@/lib/client/session-cleanup";

export interface UseLogoutOptions {
  /** Runs first (e.g. warn about unsent items). Return false to cancel. Device data is purged afterwards in every case. */
  onBeforeLogout?: () => Promise<boolean> | boolean;
  /** The actor this screen shows; purged too, even if this device recorded no binding for it. */
  actor?: Actor | null;
  /** For screens that stay mounted after logout (the sign-in page): re-check the session. */
  onSignedOut?: () => void;
}

export interface UseLogoutResult {
  logout: () => Promise<void>;
  pending: boolean;
  /**
   * DEVICE_PURGE_FAILED: this device's private data could not be erased, so
   * nothing was signed out (retry). Any other code: local data was erased but
   * the server could not confirm the logout.
   */
  error: string | null;
}

export const LOGOUT_NOTICE_KEY = "hackcure:logout-notice";

const SIGN_OUT_TIMEOUT_MS = 8_000;

export function useLogout(options: UseLogoutOptions = {}): UseLogoutResult {
  const router = useRouter();
  const { onBeforeLogout, actor = null, onSignedOut } = options;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const logout = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setPending(true);
    const outcome = await deviceBinding.logout({
      actor,
      beforeLogout: onBeforeLogout,
      endServerSession: async () => {
        await signOut({ timeoutMs: SIGN_OUT_TIMEOUT_MS });
      },
    });
    if (outcome.status !== "signed_out") {
      // Still signed in, device data untouched or partially purged: allow a retry.
      running.current = false;
      setPending(false);
      if (outcome.status === "preparation_failed") setError(outcome.message);
      if (outcome.status === "purge_failed") setError(DEVICE_PURGE_FAILED);
      return;
    }
    const serverConfirmed = outcome.serverError === null;
    if (!serverConfirmed) setError(toApiError(outcome.serverError).code);
    try {
      window.sessionStorage.setItem(LOGOUT_NOTICE_KEY, serverConfirmed ? "ok" : "unconfirmed");
    } catch {
      // The notice is informational only.
    }
    if (onSignedOut) {
      // The screen stays mounted; if the server still reports a session, the
      // user must be able to try again.
      running.current = false;
      setPending(false);
      onSignedOut();
    }
    // Otherwise `pending` stays true: the shell unmounts on navigation, and
    // re-enabling the button first would allow a second signOut on double click.
    router.replace("/");
    router.refresh();
  }, [actor, onBeforeLogout, onSignedOut, router]);

  return { logout, pending, error };
}
