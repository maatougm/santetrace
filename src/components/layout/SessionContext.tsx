"use client";

import { createContext, useContext } from "react";
import type { Actor } from "@/lib/client/api";

export interface ActorSession {
  actor: Actor;
  /** True only when GET /api/session confirmed the actor during this visit. */
  verified: boolean;
  /** Server unreachable; actor is the last verified one cached on this device. */
  offline: boolean;
  /** ISO time of the last server verification (null when unknown). */
  verifiedAt: string | null;
  refresh: () => Promise<void>;
}

export const SessionContext = createContext<ActorSession | null>(null);

/** Actor for the current gated area. Only usable under ClinicianShell/PatientShell. */
export function useActorSession(): ActorSession {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useActorSession must be used inside ClinicianShell or PatientShell.");
  }
  return value;
}
