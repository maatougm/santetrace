"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** Current epoch ms, re-rendered every `intervalMs` (for "il y a X s" labels). */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Media query match; false during SSR and the first client render. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tab state mirrored in the URL hash so links can open a given section. */
export function useHashTab<T extends string>(valid: readonly T[], fallback: T): [T, (next: T) => void] {
  const [tab, setTab] = useState<T>(fallback);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      const match = valid.find((id) => id === hash);
      if (match) setTab(match);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
    // `valid` is a module-level constant at every call site: read once on mount.
  }, []);

  const select = (next: T) => {
    setTab(next);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${next}`);
  };

  return [tab, select];
}
