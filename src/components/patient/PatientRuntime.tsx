"use client";

/**
 * Shared patient-app state, provided ABOVE the lead's PatientShell so the
 * shell's status/header slots and the pages read the same data:
 * - the authoritative actor, reported by <SessionBridge/> from inside the shell;
 * - one 2 s poll of GET /api/patients/:id (+ dated device copy);
 * - the IndexedDB outbox with automatic replay;
 * - language preference and PWA state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useActorSession } from "@/components/layout";
import type { Actor, Language } from "@/lib/client/api";
import { useDocumentLanguage } from "@/lib/client/document-language";
import { useLanguagePreference, type Messages } from "@/lib/client/i18n";
import { reviveActor, type MeasurementEntry, type OutboxScope } from "@/lib/client/outbox";
import { useCareTeam, type CareTeam } from "./useCareTeam";
import { useLogoutGuard } from "./LogoutGuard";
import { usePwaStatus, type PwaStatus } from "./pwa";
import { useOutbox, type UseOutboxResult } from "./useOutbox";
import { usePatientRecord, type PatientData } from "./usePatientRecord";

export interface PatientSessionInfo {
  actor: Actor;
  verified: boolean;
  offline: boolean;
}

export interface PatientRuntime {
  lang: Language;
  t: Messages;
  setLanguage: (lang: Language) => void;
  session: PatientSessionInfo | null;
  scope: OutboxScope | null;
  data: PatientData;
  outbox: UseOutboxResult;
  pwa: PwaStatus;
  /** navigator.onLine — a hint only; the server response is what counts. */
  online: boolean;
  /** Latest measurement result of this visit (memory only), shown on home. */
  lastResult: MeasurementEntry | null;
  setLastResult: (entry: MeasurementEntry | null) => void;
  /** Logout guard: warns about unsent items, then purges this actor's device data. */
  beforeLogout: () => Promise<boolean>;
  /**
   * Accepted doctors who can see alerts, from the owner's current grants.
   * "unknown" (loading/offline/refused) must never be shown as a team that saw something.
   */
  careTeam: CareTeam;
}

const RuntimeContext = createContext<PatientRuntime | null>(null);
const SessionReportContext = createContext<((info: PatientSessionInfo | null) => void) | null>(null);

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function PatientRuntimeProvider({ children }: { children: ReactNode }) {
  const { lang, t, setLanguage, adoptDefault } = useLanguagePreference();
  const [session, setSession] = useState<PatientSessionInfo | null>(null);
  const [lastResult, setLastResult] = useState<MeasurementEntry | null>(null);
  const online = useOnline();
  const pwa = usePwaStatus();
  useDocumentLanguage(lang);

  const actorId = session?.actor.id ?? null;
  const patientId = session?.actor.patientId ?? null;
  const scope = useMemo<OutboxScope | null>(
    () => (actorId && patientId ? { actorId, patientId } : null),
    [actorId, patientId],
  );
  // A NEW actor scope (e.g. signing in again in this tab after a purge)
  // re-enables device writes for that actor. Keyed on scope identity, so it
  // does not re-run while a purge of the current scope is in progress.
  // Declared before the data hooks so it runs before their effects.
  useEffect(() => {
    if (scope) reviveActor(scope.actorId);
  }, [scope]);

  const data = usePatientRecord(scope);
  const { refresh } = data;
  const onReplayed = useCallback(
    (report: { received: number }) => {
      if (report.received > 0) void refresh();
    },
    [refresh],
  );
  const outbox = useOutbox(scope, { autoReplay: true, onReplayed });
  const careTeam = useCareTeam(patientId, actorId, data.fence, data.origin === "server");

  const serverLanguage = data.record?.patient.language;
  useEffect(() => {
    if (serverLanguage) adoptDefault(serverLanguage);
  }, [serverLanguage, adoptDefault]);

  // A freshly verified session (sign-in again, or back online) replays the queue.
  const verified = session?.verified ?? false;
  const { replay } = outbox;
  useEffect(() => {
    if (verified && scope) void replay();
  }, [verified, scope, replay]);

  useEffect(() => {
    if (!scope) setLastResult(null);
  }, [scope]);

  const detachSession = useCallback(() => setSession(null), []);
  const guard = useLogoutGuard(scope, t, detachSession);
  const beforeLogout = guard.onBeforeLogout;

  const value = useMemo<PatientRuntime>(
    () => ({ lang, t, setLanguage, session, scope, data, outbox, pwa, online, lastResult, setLastResult, beforeLogout, careTeam }),
    [lang, t, setLanguage, session, scope, data, outbox, pwa, online, lastResult, beforeLogout, careTeam],
  );

  return (
    <SessionReportContext.Provider value={setSession}>
      <RuntimeContext.Provider value={value}>
        {children}
        {guard.dialog}
      </RuntimeContext.Provider>
    </SessionReportContext.Provider>
  );
}

export function usePatientRuntime(): PatientRuntime {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("usePatientRuntime must be used inside PatientRuntimeProvider.");
  return value;
}

/** Rendered inside PatientShell: forwards the shell's verified actor to the runtime. */
export function SessionBridge() {
  const report = useContext(SessionReportContext);
  const { actor, verified, offline } = useActorSession();
  const { id, role, displayName, patientId } = actor;

  useEffect(() => {
    if (!report) return;
    report({ actor: { id, role, displayName, patientId }, verified, offline });
  }, [report, id, role, displayName, patientId, verified, offline]);

  useEffect(() => {
    if (!report) return;
    return () => report(null);
  }, [report]);

  return null;
}
