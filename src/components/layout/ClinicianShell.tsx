"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Button, ConnectionBadge, DemoLabel, Icon, Notice } from "@/components/ui";
import { DEVICE_PURGE_FAILED } from "@/lib/client/session-cleanup";
import { useLiveConnection } from "@/lib/client/use-live";
import { BrandMark } from "./BrandMark";
import { RequireSession } from "./RequireSession";
import { useActorSession } from "./SessionContext";
import { SHELL_COPY } from "./shell-copy";
import { isNavActive, type ShellNavItem } from "./nav";
import { useLogout } from "./useLogout";
import styles from "./ClinicianShell.module.css";

const copy = SHELL_COPY.fr;

/** The logout stopped before signing out: the clinician is still signed in. */
const LOGOUT_STOPPED_COPY = {
  title: "Déconnexion interrompue",
  purgeFailed:
    "Des données privées laissées sur cet appareil n’ont pas pu être effacées. Vous restez connecté·e. Fermez les autres onglets Santetrace, puis réessayez.",
  preparationFailed: "La déconnexion n’a pas pu être préparée. Vous restez connecté·e et rien n’a été effacé.",
  retry: "Réessayer la déconnexion",
};

export const CLINICIAN_NAV: ShellNavItem[] = [
  // Exact on the queue, plus every patient record page.
  { href: "/doctor", label: "Patients", icon: "users", exact: true, matches: ["/doctor/patients"] },
  { href: "/doctor/invitations", label: "Invitations", icon: "inbox" },
];

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
  logout: () => Promise<void>;
  pending: boolean;
}

function ClinicianNav({ nav }: { nav: ShellNavItem[] }) {
  const pathname = usePathname() ?? "";
  return (
    <nav className={styles.nav} aria-label={copy.mainNav}>
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

function ClinicianHeader({ nav, logout, pending }: HeaderProps) {
  const { actor } = useActorSession();

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/doctor" className={styles.brandLink} aria-label="Santetrace — liste des patients">
          <BrandMark tone="dark" />
        </Link>
        <ClinicianNav nav={nav} />
        <div className={styles.actor}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(actor.displayName)}
          </span>
          <span className={styles.actorText}>
            <span className={styles.actorName}>{actor.displayName}</span>
            <span className={styles.actorRole}>{copy.clinicianRole}</span>
          </span>
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
  /** Overrides the default header links. */
  nav?: ShellNavItem[];
}

function ClinicianFrame({ children, nav }: { children: ReactNode; nav: ShellNavItem[] }) {
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
    <div className={styles.shell}>
      <a className={styles.skip} href="#main-content">
        {copy.skipToContent}
      </a>
      <ClinicianHeader nav={nav} logout={logout} pending={pending} />
      <div className={styles.demoStrip}>
        <div className={styles.demoInner}>
          <DemoLabel />
          <p className={styles.demoNote}>{copy.demoRules}</p>
          <ConnectionBadge className={styles.live} status={live.status} lastEventAt={live.lastEventAt} />
        </div>
      </div>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        {logoutStopped && (
          <div className={styles.noticeSlot}>
            <Notice
              tone="neutral"
              icon="alert-triangle"
              role="alert"
              title={LOGOUT_STOPPED_COPY.title}
              action={
                <Button variant="secondary" size="sm" iconStart="refresh" onClick={() => void logout()}>
                  {LOGOUT_STOPPED_COPY.retry}
                </Button>
              }
            >
              {error === DEVICE_PURGE_FAILED ? LOGOUT_STOPPED_COPY.purgeFailed : LOGOUT_STOPPED_COPY.preparationFailed}
            </Notice>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** Responsive clinician frame: blue header band (nav wraps to its own row on phones), role gate, logout. */
export function ClinicianShell({ children, nav = CLINICIAN_NAV }: ClinicianShellProps) {
  return (
    <RequireSession role="clinician" lang="fr">
      <ClinicianFrame nav={nav}>{children}</ClinicianFrame>
    </RequireSession>
  );
}
