"use client";

/**
 * Minimal public frame for /share/**: no account shell, no navigation, no
 * analytics. The FR/AR choice lives in React state only (never stored), and
 * survives the landing → session navigation because the layout persists.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DemoLabel } from "@/components/ui";
import { SHARE_COPY, type ShareCopy } from "@/lib/client/copy/share";
import { directionFor, useDocumentLanguage } from "@/lib/client/document-language";
import { getMessages } from "@/lib/client/i18n";
import type { Language } from "@/lib/client/transport";
import styles from "./guest.module.css";

interface GuestLanguage {
  lang: Language;
  copy: ShareCopy["guest"];
}

const GuestLanguageContext = createContext<GuestLanguage | null>(null);

export function useGuestLanguage(): GuestLanguage {
  const value = useContext(GuestLanguageContext);
  if (!value) throw new Error("useGuestLanguage must be used inside GuestFrame.");
  return value;
}

export function GuestFrame({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>("fr");
  useDocumentLanguage(lang);
  const value = useMemo<GuestLanguage>(() => ({ lang, copy: SHARE_COPY[lang].guest }), [lang]);
  const next: Language = lang === "fr" ? "ar" : "fr";

  return (
    <GuestLanguageContext.Provider value={value}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.brandRow}>
            <span className={styles.brand}>{getMessages(lang).common.appName}</span>
            <DemoLabel>{value.copy.demo}</DemoLabel>
          </div>
          <button type="button" className={styles.langToggle} onClick={() => setLang(next)} aria-label={value.copy.languageAria}>
            <span lang={next} dir={directionFor(next)}>
              {value.copy.language}
            </span>
          </button>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </GuestLanguageContext.Provider>
  );
}
