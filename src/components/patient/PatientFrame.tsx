"use client";

/**
 * Client frame for /patient/**: owns language, data and outbox state (via the
 * runtime provider) and renders the lead's PatientShell with the FR/AR toggle,
 * the connectivity/outbox strip and the logout guard.
 */
import { useMemo, type ReactNode } from "react";
import { PatientShell, type ShellNavItem } from "@/components/layout";
import { patientNavItems } from "./patient-nav";
import { PatientRuntimeProvider, SessionBridge, usePatientRuntime } from "./PatientRuntime";
import { StatusStrip } from "./StatusStrip";
import styles from "./patient.module.css";

function LanguageToggle() {
  const { lang, setLanguage, t } = usePatientRuntime();
  const next = lang === "fr" ? "ar" : "fr";
  return (
    <button type="button" className={styles.langToggle} onClick={() => setLanguage(next)} aria-label={t.language.switchAria}>
      <span lang={next} dir={next === "ar" ? "rtl" : "ltr"}>
        {t.language.switchLabel}
      </span>
    </button>
  );
}

function FrameShell({ children }: { children: ReactNode }) {
  const { lang, t, beforeLogout } = usePatientRuntime();
  // Accueil · Mesurer · Messages · Plan · Dossier (patient-nav.ts keeps every route ≤ 2 taps away).
  const nav = useMemo<ShellNavItem[]>(() => patientNavItems(t, lang), [t, lang]);

  return (
    <PatientShell
      lang={lang}
      nav={nav}
      headerSlot={<LanguageToggle />}
      statusSlot={<StatusStrip />}
      onBeforeLogout={beforeLogout}
    >
      <SessionBridge />
      {children}
    </PatientShell>
  );
}

export function PatientFrame({ children }: { children: ReactNode }) {
  return (
    <PatientRuntimeProvider>
      <FrameShell>{children}</FrameShell>
    </PatientRuntimeProvider>
  );
}
