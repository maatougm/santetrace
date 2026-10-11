"use client";

/**
 * Clinician shell language. Reuses the existing device preference
 * (`useLanguagePreference`, same storage key and cleanup rules as the patient
 * space) and `useDocumentLanguage` for <html lang/dir>; no second persisted
 * preference is created. Doctor components read it with `useClinicianLanguage()`;
 * outside the provider they fall back to French, the previous behaviour.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Language } from "@/lib/client/api";
import { useDocumentLanguage } from "@/lib/client/document-language";
import { useLanguagePreference } from "@/lib/client/i18n";

export interface ClinicianLanguage {
  lang: Language;
  /** Explicit choice: applied and persisted on this device (existing preference). */
  setLanguage: (lang: Language) => void;
  /** True once the stored preference has been read. */
  ready: boolean;
}

const FRENCH_FALLBACK: ClinicianLanguage = Object.freeze({ lang: "fr", setLanguage: () => undefined, ready: false });

const ClinicianLanguageContext = createContext<ClinicianLanguage>(FRENCH_FALLBACK);

export function ClinicianLanguageProvider({ children }: { children: ReactNode }) {
  const { lang, setLanguage, ready } = useLanguagePreference();
  useDocumentLanguage(lang);
  const value = useMemo<ClinicianLanguage>(() => ({ lang, setLanguage, ready }), [lang, setLanguage, ready]);
  return <ClinicianLanguageContext.Provider value={value}>{children}</ClinicianLanguageContext.Provider>;
}

export function useClinicianLanguage(): ClinicianLanguage {
  return useContext(ClinicianLanguageContext);
}
