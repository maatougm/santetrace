"use client";

import { useEffect } from "react";
import type { Language } from "./api";

export function directionFor(lang: Language): "ltr" | "rtl" {
  return lang === "ar" ? "rtl" : "ltr";
}

/**
 * Applies lang/dir to <html> while the calling screen is mounted, so native
 * controls, scrollbars and logical CSS properties all follow the language.
 * Restores French/LTR on unmount (the root layout default).
 */
export function useDocumentLanguage(lang: Language): void {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = directionFor(lang);
    return () => {
      root.lang = "fr";
      root.dir = "ltr";
    };
  }, [lang]);
}
