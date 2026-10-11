"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Icon, LinkButton, Notice, Spinner } from "@/components/ui";
import { LOGOUT_NOTICE_KEY, useLogout } from "@/components/layout";
import type { Actor, Language } from "@/lib/client/api";
import { useDocumentLanguage } from "@/lib/client/document-language";
import { adoptSignedInActor, homePathFor, useSession } from "@/lib/client/session";
import { DEVICE_PURGE_FAILED } from "@/lib/client/session-cleanup";
import { ClinicianLoginForm } from "./ClinicianLoginForm";
import { DemoQuickLogin } from "./DemoQuickLogin";
import { IdentityPanel } from "./IdentityPanel";
import { PatientAccountForm } from "./PatientAccountForm";
import { SIGN_IN_COPY } from "./sign-in-copy";
import styles from "./SignIn.module.css";

type LogoutNotice = "ok" | "unconfirmed" | null;

/** A previous actor's device data could not be erased: no account is opened or closed until it is. */
const PURGE_COPY: Record<Language, { title: string; switchBlocked: string; logoutBlocked: string; retry: string }> = {
  fr: {
    title: "Données de la session précédente non effacées",
    switchBlocked:
      "Les données privées de la session précédente n’ont pas pu être effacées de cet appareil. Aucun autre compte n’est ouvert tant que ce n’est pas fait. Fermez les autres onglets Santetrace, puis réessayez.",
    logoutBlocked:
      "Les données de ce compte n’ont pas pu être effacées de cet appareil : vous restez connecté·e. Fermez les autres onglets Santetrace, puis réessayez.",
    retry: "Réessayer",
  },
  ar: {
    title: "لم تُمحَ بيانات الجلسة السابقة",
    switchBlocked:
      "تعذّر محو البيانات الخاصة بالجلسة السابقة من هذا الجهاز. لن يُفتح أي حساب آخر قبل ذلك. أغلق علامات تبويب Santetrace الأخرى ثم أعد المحاولة.",
    logoutBlocked: "تعذّر محو بيانات هذا الحساب من هذا الجهاز: ما زلت متصلًا. أغلق علامات تبويب Santetrace الأخرى ثم أعد المحاولة.",
    retry: "إعادة المحاولة",
  },
};

function readLogoutNotice(): LogoutNotice {
  try {
    const value = window.sessionStorage.getItem(LOGOUT_NOTICE_KEY);
    window.sessionStorage.removeItem(LOGOUT_NOTICE_KEY);
    return value === "ok" || value === "unconfirmed" ? value : null;
  } catch {
    return null;
  }
}

interface ActiveSessionProps {
  actor: Actor;
  lang: Language;
  /** This page stays mounted after "switch account": re-check the session. */
  onSignedOut: () => void;
}

function ActiveSession({ actor, lang, onSignedOut }: ActiveSessionProps) {
  const copy = SIGN_IN_COPY[lang];
  const { logout, pending, error } = useLogout({ actor, onSignedOut });
  const role = actor.role === "clinician" ? copy.clinicianRole : copy.patientRole;
  return (
    <Card as="section" id="active-session" title={copy.activeTitle} padding="lg">
      <div className={styles.form}>
        <p className={styles.activeText}>{copy.activeAs(actor.displayName, role)}</p>
        {error === DEVICE_PURGE_FAILED && (
          <Notice tone="neutral" icon="alert-triangle" role="alert" title={PURGE_COPY[lang].title}>
            {PURGE_COPY[lang].logoutBlocked}
          </Notice>
        )}
        <div className={styles.activeActions}>
          <LinkButton href={homePathFor(actor.role)} variant="primary" size="lg" iconEnd="arrow-right">
            {copy.continue}
          </LinkButton>
          <Button variant="ghost" size="lg" iconStart="log-out" loading={pending} onClick={() => void logout()}>
            {copy.switchAccount}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function SignInScreen() {
  const router = useRouter();
  const [lang, setLang] = useState<Language>("fr");
  const [notice, setNotice] = useState<LogoutNotice>(null);
  /** A sign-in succeeded on the server; the device is being cleared for this actor. */
  const [admission, setAdmission] = useState<{ actor: Actor; failed: boolean } | null>(null);
  const { state, refresh } = useSession();
  const copy = SIGN_IN_COPY[lang];
  const purgeCopy = PURGE_COPY[lang];
  useDocumentLanguage(lang);

  useEffect(() => {
    setNotice(readLogoutNotice());
  }, []);

  const handleSignedOut = useCallback(() => {
    const next = readLogoutNotice();
    if (next) setNotice(next);
    void refresh();
  }, [refresh]);

  // Another actor is cached and opened only after the previous one's device data is erased.
  const handleSignedIn = useCallback(
    async (actor: Actor) => {
      setAdmission({ actor, failed: false });
      const outcome = await adoptSignedInActor(actor);
      if (outcome === "admitted") {
        router.replace(homePathFor(actor.role));
        return;
      }
      setAdmission(outcome === "purge_failed" ? { actor, failed: true } : null);
    },
    [router],
  );

  const sessionPurgeBlocked = state.status === "error" && state.error.code === DEVICE_PURGE_FAILED;
  const showForms =
    admission === null &&
    !sessionPurgeBlocked &&
    (state.status === "anonymous" || state.status === "error" || state.status === "offline");

  return (
    <div className={styles.page}>
      <div className={styles.langBar}>
        <button
          type="button"
          className={styles.langToggle}
          onClick={() => setLang(lang === "fr" ? "ar" : "fr")}
          aria-label={copy.langToggleLabel}
          lang={lang === "fr" ? "ar" : "fr"}
        >
          <Icon name="languages" size={16} />
          {copy.langToggle}
        </button>
      </div>

      <main className={styles.layout}>
        <IdentityPanel lang={lang} />

        <div className={styles.entry}>
          {notice === "ok" && <Notice tone="success">{copy.loggedOut}</Notice>}
          {notice === "unconfirmed" && <Notice tone="info">{copy.logoutUnconfirmed}</Notice>}

          {(state.status === "loading" || (admission !== null && !admission.failed)) && (
            <div className={styles.checking} role="status">
              <Spinner label={copy.checking} />
              <span>{copy.checking}</span>
            </div>
          )}

          {(admission?.failed || sessionPurgeBlocked) && (
            <Notice
              tone="neutral"
              icon="alert-triangle"
              role="alert"
              title={purgeCopy.title}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  iconStart="refresh"
                  onClick={() => void (admission ? handleSignedIn(admission.actor) : refresh())}
                >
                  {purgeCopy.retry}
                </Button>
              }
            >
              {purgeCopy.switchBlocked}
            </Notice>
          )}

          {admission === null && state.status === "authenticated" && (
            <ActiveSession actor={state.actor} lang={lang} onSignedOut={handleSignedOut} />
          )}

          {admission === null && state.status === "offline" && (
            <Notice
              tone="neutral"
              icon="wifi-off"
              title={copy.offlineTitle}
              action={
                state.actor ? (
                  <LinkButton href={homePathFor(state.actor.role)} variant="secondary" size="sm">
                    {copy.offlineContinue}
                  </LinkButton>
                ) : undefined
              }
            >
              {copy.offlineBody}
            </Notice>
          )}

          {showForms && (
            <div className={styles.forms}>
              <DemoQuickLogin lang={lang} onSignedIn={(actor) => void handleSignedIn(actor)} />
              <PatientAccountForm lang={lang} onSignedIn={(actor) => void handleSignedIn(actor)} />
              <ClinicianLoginForm lang={lang} onSignedIn={(actor) => void handleSignedIn(actor)} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
