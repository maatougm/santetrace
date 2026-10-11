"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { Button, ConnectionBadge, DEMO_LABEL_AR, DEMO_LABEL_FR, DemoLabel, Icon, Notice } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { directionFor } from "@/lib/client/document-language";
import { DEVICE_PURGE_FAILED } from "@/lib/client/session-cleanup";
import { useLiveConnection } from "@/lib/client/use-live";
import { BrandMark } from "./BrandMark";
import { ClinicianLanguageProvider, useClinicianLanguage } from "./ClinicianLanguage";
import { RequireSession } from "./RequireSession";
import { useActorSession } from "./SessionContext";
import { CLINICIAN_SHELL_COPY, SHELL_COPY, clinicianNav } from "./shell-copy";
import { isNavActive, type ShellNavItem } from "./nav";
import { useLogout } from "./useLogout";
import styles from "./ClinicianShell.module.css";

/** Default (French) header links, kept for existing imports; the shell renders `clinicianNav(lang)`. */
export const CLINICIAN_NAV: ShellNavItem[] = clinicianNav("fr");

function initials(name: string): string {
  const parts = name
    .replace(/[—–-].*$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

interface HeaderProps {
  nav: ShellNavItem[];
  lang: Language;
  logout: () => Promise<void>;
  pending: boolean;
}

function ClinicianNav({ nav, label }: { nav: ShellNavItem[]; label: string }) {
  const pathname = usePathname() ?? "";
  return (
    <nav className={styles.nav} aria-label={label}>
      <ul className={styles.navList}>
        {nav.map((item) => {
          const active = isNavActive(pathname, item);
          return (
            <li key={item.href} className={styles.navItem}>
              <Link
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={item.icon} size={18} />
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Same control as the patient header: 44px, shows the other language's name in that language. */
function LanguageToggle() {
  const { lang, setLanguage } = useClinicianLanguage();
  const copy = CLINICIAN_SHELL_COPY[lang];
  const next: Language = lang === "fr" ? "ar" : "fr";
  return (
    <button type="button" className={styles.langToggle} onClick={() => setLanguage(next)} aria-label={copy.languageSwitchAria}>
      <span lang={next} dir={directionFor(next)}>
        {copy.languageSwitchLabel}
      </span>
    </button>
  );
}

function ClinicianHeader({ nav, lang, logout, pending }: HeaderProps) {
  const { actor } = useActorSession();
  const copy = SHELL_COPY[lang];

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/doctor" className={styles.brandLink} aria-label={CLINICIAN_SHELL_COPY[lang].brandHome}>
          <BrandMark tone="dark" />
        </Link>
        <ClinicianNav nav={nav} label={copy.mainNav} />
        <div className={styles.actor}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(actor.displayName)}
          </span>
          <span className={styles.actorText}>
            <bdi className={styles.actorName}>{actor.displayName}</bdi>
            <span className={styles.actorRole}>{copy.clinicianRole}</span>
          </span>
          <LanguageToggle />
          <button
            type="button"
            className={styles.logout}
            onClick={() => void logout()}
            disabled={pending}
            aria-label={pending ? copy.loggingOut : copy.logout}
            title={copy.logout}
          >
            <Icon name="log-out" size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}

interface ClinicianShellProps {
  children: ReactNode;
  /** Overrides the default (localized) header links. */
  nav?: ShellNavItem[];
}

function ClinicianFrame({ children, nav }: ClinicianShellProps) {
  const { lang } = useClinicianLanguage();
  const copy = SHELL_COPY[lang];
  const clinicianCopy = CLINICIAN_SHELL_COPY[lang];
  const items = useMemo(() => nav ?? clinicianNav(lang), [nav, lang]);
  const { logout, pending, error } = useLogout();
  // Shares the tab's single live socket with the data hooks; polling stays the fallback.
  const live = useLiveConnection();
  // Not pending + error: the logout stopped before signing out (still signed in).
  // An unconfirmed server sign-out keeps `pending` and is reported on the sign-in page.
  const logoutStopped = error !== null && !pending;

  useEffect(() => {
    if (logoutStopped) window.scrollTo({ top: 0 });
  }, [logoutStopped]);

  return (
    <div className={styles.shell} lang={lang} dir={directionFor(lang)}>
      <a className={styles.skip} href="#main-content">
        {copy.skipToContent}
      </a>
      <ClinicianHeader nav={items} lang={lang} logout={logout} pending={pending} />
      <div className={styles.demoStrip}>
        <div className={styles.demoInner}>
          <DemoLabel>{lang === "ar" ? DEMO_LABEL_AR : DEMO_LABEL_FR}</DemoLabel>
          <p className={styles.demoNote}>{copy.demoRules}</p>
          <ConnectionBadge className={styles.live} status={live.status} lastEventAt={live.lastEventAt} lang={lang} />
        </div>
      </div>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        {logoutStopped && (
          <div className={styles.noticeSlot}>
            <Notice
              tone="neutral"
              icon="alert-triangle"
              role="alert"
              title={clinicianCopy.logoutStoppedTitle}
              action={
                <Button variant="secondary" size="sm" iconStart="refresh" onClick={() => void logout()}>
                  {clinicianCopy.logoutRetry}
                </Button>
              }
            >
              {error === DEVICE_PURGE_FAILED ? clinicianCopy.logoutStoppedPurgeFailed : clinicianCopy.logoutStoppedPreparationFailed}
            </Notice>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** The session gate needs the provider above it so its screens follow the selected language. */
function ClinicianGate({ children, nav }: ClinicianShellProps) {
  const { lang } = useClinicianLanguage();
  return (
    <RequireSession role="clinician" lang={lang}>
      <ClinicianFrame nav={nav}>{children}</ClinicianFrame>
    </RequireSession>
  );
}

/**
 * Responsive clinician frame: blue header band (nav wraps to its own row on
 * phones), FR/AR language toggle on the device preference, role gate, logout.
 */
export function ClinicianShell({ children, nav }: ClinicianShellProps) {
  return (
    <ClinicianLanguageProvider>
      <ClinicianGate nav={nav}>{children}</ClinicianGate>
    </ClinicianLanguageProvider>
  );
}
