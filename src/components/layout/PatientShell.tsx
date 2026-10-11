"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button, ConnectionBadge, DemoLabel, Icon, Notice } from "@/components/ui";
import type { Language } from "@/lib/client/api";
import { formatRelative } from "@/lib/client/format";
import { getMessages } from "@/lib/client/i18n";
import { DEVICE_PURGE_FAILED } from "@/lib/client/session-cleanup";
import { useLiveConnection } from "@/lib/client/use-live";
import { BrandMark } from "./BrandMark";
import { isNavActive, type ShellNavItem } from "./nav";
import { RequireSession } from "./RequireSession";
import { useActorSession } from "./SessionContext";
import { SHELL_COPY } from "./shell-copy";
import { useLogout } from "./useLogout";
import styles from "./PatientShell.module.css";

export interface PatientShellProps {
  children: ReactNode;
  lang: Language;
  /** Bottom tab bar (≤ 5 items). */
  nav: ShellNavItem[];
  /** Top bar end slot, e.g. the FR/AR toggle. */
  headerSlot?: ReactNode;
  /** Full-width strip under the top bar, e.g. connectivity + outbox status. */
  statusSlot?: ReactNode;
  /** Runs before logout (warn about unsent items here). Return false to cancel. The device purge runs regardless. */
  onBeforeLogout?: () => Promise<boolean> | boolean;
}

function PatientFrameInner({ children, lang, nav, headerSlot, statusSlot, onBeforeLogout }: PatientShellProps) {
  const pathname = usePathname() ?? "";
  const copy = SHELL_COPY[lang];
  const logoutCopy = getMessages(lang).logout;
  const { offline, verifiedAt } = useActorSession();
  const { logout, pending, error: logoutError } = useLogout({ onBeforeLogout });
  // Shares the tab's single live socket with the data hooks; polling stays the fallback.
  const live = useLiveConnection();
  // Not pending + error: the logout stopped before signing out (still signed in).
  // An unconfirmed server sign-out keeps `pending` and is reported on the sign-in page.
  const logoutStopped = logoutError !== null && !pending;

  return (
    <div className={styles.shell} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <a className={styles.skip} href="#main-content">
        {copy.skipToContent}
      </a>

      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <BrandMark />
          <div className={styles.topbarEnd}>
            {headerSlot}
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void logout()}
              disabled={pending}
              aria-label={pending ? copy.loggingOut : copy.logout}
              title={copy.logout}
            >
              <Icon name="log-out" size={20} />
            </button>
          </div>
        </div>
        <div className={styles.metaRow}>
          <DemoLabel>{copy.demo}</DemoLabel>
          <ConnectionBadge status={live.status} lastEventAt={live.lastEventAt} lang={lang} />
          {offline && (
            <span className={styles.unverified} role="status">
              <Icon name="cloud-off" size={14} />
              <span>
                {copy.offlineUnverified}
                {verifiedAt ? ` · ${formatRelative(verifiedAt, lang)}` : ""}
              </span>
            </span>
          )}
        </div>
        {logoutStopped && (
          // Inside the sticky bar, next to the button that failed, so it stays visible.
          <div className={styles.statusStrip} style={{ paddingBottom: "var(--space-3)" }}>
            <Notice
              tone="neutral"
              icon="alert-triangle"
              role="alert"
              title={logoutCopy.blockedTitle}
              action={
                <Button variant="secondary" size="sm" iconStart="refresh" onClick={() => void logout()}>
                  {logoutCopy.retryLogout}
                </Button>
              }
            >
              {logoutError === DEVICE_PURGE_FAILED ? logoutCopy.blockedBody : logoutCopy.preparationFailedBody}
            </Notice>
          </div>
        )}
      </header>

      {/* Before main in the DOM: fixed bottom bar on phones, sticky top bar on desktop. */}
      <nav className={styles.tabbar} aria-label={copy.mainNav}>
        <ul className={styles.tabList}>
          {nav.map((item) => {
            const active = isNavActive(pathname, item);
            return (
              <li key={item.href} className={styles.tabItem}>
                <Link
                  href={item.href}
                  className={`${styles.tab} ${active ? styles.tabActive : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={item.icon} size={22} />
                  <span className={styles.tabLabel}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {statusSlot && <div className={styles.statusStrip}>{statusSlot}</div>}

      <main id="main-content" className={styles.main} tabIndex={-1}>
        {children}
      </main>

    </div>
  );
}

/**
 * Mobile-first patient frame: bottom tab bar on phones, top navigation and a
 * wider workspace on desktop. Gates on a patient actor; while offline it keeps
 * working with the last actor verified on this device and says so.
 */
export function PatientShell(props: PatientShellProps) {
  return (
    <RequireSession role="patient" lang={props.lang} allowOffline>
      <PatientFrameInner {...props} />
    </RequireSession>
  );
}
