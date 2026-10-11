"use client";

/**
 * Service worker registration for the installed patient app.
 * Registered only in secure contexts and only in production, or in dev with an
 * explicit `?sw=1` opt-in (so Next dev HMR is not intercepted). `?sw=0`
 * unregisters it. "Offline ready" is claimed only after the worker confirms it
 * cached the patient pages.
 */
import { useEffect, useState } from "react";

const SW_URL = "/sw.js";
const OPT_IN_KEY = "hackcure:sw-opt-in";
const WARM_TIMEOUT_MS = 20_000;

export const PATIENT_ROUTES = [
  "/patient",
  "/patient/measure",
  "/patient/reminders",
  "/patient/history",
  "/patient/documents",
  "/patient/summary",
] as const;

export type ServiceWorkerState = "disabled" | "unsupported" | "registering" | "active" | "error";

export interface PwaStatus {
  /** Launched from the home screen (display-mode standalone). */
  installed: boolean;
  worker: ServiceWorkerState;
  /** The worker confirmed the patient pages are cached for offline use. */
  offlineReady: boolean;
}

/** `?sw=1` opts this tab in (remembered for the tab session), `?sw=0` opts out. */
function readOptIn(): boolean {
  const param = new URLSearchParams(window.location.search).get("sw");
  if (param === "1" || param === "0") {
    try {
      if (param === "1") window.sessionStorage.setItem(OPT_IN_KEY, "1");
      else window.sessionStorage.removeItem(OPT_IN_KEY);
    } catch {
      // Session storage unavailable: the URL parameter still applies to this load.
    }
    return param === "1";
  }
  try {
    return window.sessionStorage.getItem(OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

async function unregisterOwnWorker(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => (registration.active ?? registration.waiting ?? registration.installing)?.scriptURL.includes(SW_URL))
      .map((registration) => registration.unregister()),
  );
}

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function warmCache(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(false), WARM_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      window.clearTimeout(timer);
      const data = event.data;
      resolve(typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true);
    };
    // Online: (re)cache the patient pages. Offline: only report what is cached.
    const type = navigator.onLine ? "warm" : "status";
    worker.postMessage({ type, urls: PATIENT_ROUTES }, [channel.port2]);
  });
}

export function usePwaStatus(): PwaStatus {
  const [status, setStatus] = useState<PwaStatus>({ installed: false, worker: "disabled", offlineReady: false });

  useEffect(() => {
    let cancelled = false;
    const update = (patch: Partial<PwaStatus>) => {
      if (!cancelled) setStatus((current) => ({ ...current, ...patch }));
    };
    update({ installed: isStandalone() });

    const isProduction = process.env.NODE_ENV === "production";
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      update({ worker: "unsupported" });
      return () => {
        cancelled = true;
      };
    }
    if (!isProduction && !readOptIn()) {
      // Dev without opt-in: make sure no earlier opt-in worker keeps intercepting HMR.
      unregisterOwnWorker().catch(() => update({ worker: "error" }));
      update({ worker: "disabled" });
      return () => {
        cancelled = true;
      };
    }

    update({ worker: "registering" });
    const url = isProduction ? SW_URL : `${SW_URL}?mode=dev`;
    navigator.serviceWorker
      .register(url, { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then(async (registration) => {
        update({ worker: "active" });
        if (registration.active) update({ offlineReady: await warmCache(registration.active) });
      })
      .catch(() => update({ worker: "error", offlineReady: false }));

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
