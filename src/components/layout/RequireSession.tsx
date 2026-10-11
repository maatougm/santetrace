"use client";

import { useMemo, type ReactNode } from "react";
import { Button, ErrorState, Icon, LinkButton, Spinner } from "@/components/ui";
import { describeApiError, type Language, type Role } from "@/lib/client/api";
import { homePathFor, useSession } from "@/lib/client/session";
import { BrandMark } from "./BrandMark";
import { SessionContext, type ActorSession } from "./SessionContext";
import { SHELL_COPY } from "./shell-copy";
import styles from "./RequireSession.module.css";

interface RequireSessionProps {
  role: Role;
  lang?: Language;
  /** Let an installed patient app keep working with the last verified actor while offline. */
  allowOffline?: boolean;
  children: ReactNode;
}

function GateScreen({ lang, children }: { lang: Language; children: ReactNode }) {
  return (
    <main id="main-content" className={styles.gate} lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className={styles.panel}>
        <BrandMark />
        {children}
      </div>
    </main>
  );
}

/**
 * Renders children only for an actor of the expected role. The server cookie
 * stays authoritative: every API call is still authorized server-side.
 */
export function RequireSession({ role, lang = "fr", allowOffline = false, children }: RequireSessionProps) {
  const { state, refresh } = useSession();
  const copy = SHELL_COPY[lang];

  const session = useMemo<ActorSession | null>(() => {
    if (state.status === "authenticated" && state.actor.role === role) {
      return { actor: state.actor, verified: true, offline: false, verifiedAt: new Date().toISOString(), refresh };
    }
    if (state.status === "offline" && allowOffline && state.actor?.role === role) {
      return { actor: state.actor, verified: false, offline: true, verifiedAt: state.verifiedAt, refresh };
    }
    return null;
  }, [state, role, allowOffline, refresh]);

  if (session) {
    return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
  }

  if (state.status === "loading") {
    return (
      <GateScreen lang={lang}>
        <div className={styles.loading} role="status">
          <Spinner label={copy.checkingSession} />
          <span>{copy.checkingSession}</span>
        </div>
      </GateScreen>
    );
  }

  if (state.status === "authenticated") {
    return (
      <GateScreen lang={lang}>
        <div className={styles.message}>
          <Icon name="lock" size={22} />
          <h1 className={styles.title}>{copy.wrongRoleTitle}</h1>
          <p className={styles.body}>{copy.wrongRoleBody}</p>
          <LinkButton href={homePathFor(state.actor.role)} variant="primary" iconEnd="arrow-right">
            {copy.goToMySpace}
          </LinkButton>
        </div>
      </GateScreen>
    );
  }

  if (state.status === "offline") {
    return (
      <GateScreen lang={lang}>
        <div className={styles.message}>
          <Icon name="wifi-off" size={22} />
          <h1 className={styles.title}>{copy.offlineTitle}</h1>
          <p className={styles.body}>{copy.offlineBody}</p>
          <Button variant="primary" iconStart="refresh" onClick={() => void refresh()}>
            {copy.retry}
          </Button>
        </div>
      </GateScreen>
    );
  }

  if (state.status === "error") {
    const description = describeApiError(state.error, lang);
    return (
      <GateScreen lang={lang}>
        <ErrorState
          title={description.title}
          message={description.message}
          code={description.code}
          onRetry={() => void refresh()}
          retryLabel={copy.retry}
        />
      </GateScreen>
    );
  }

  return (
    <GateScreen lang={lang}>
      <div className={styles.message}>
        <Icon name="user" size={22} />
        <h1 className={styles.title}>{copy.sessionRequiredTitle}</h1>
        <p className={styles.body}>{copy.sessionRequiredBody}</p>
        <LinkButton href="/" variant="primary" iconEnd="arrow-right">
          {copy.signIn}
        </LinkButton>
      </div>
    </GateScreen>
  );
}
