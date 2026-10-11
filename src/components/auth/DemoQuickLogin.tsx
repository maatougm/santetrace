"use client";

import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import type { Actor, Language } from "@/lib/client/api";
import { getDemoLoginRoles, postDemoLogin } from "@/lib/client/demo-login-api";
import { describeApiError, type ErrorDescription } from "@/lib/client/transport";
import type { DemoRole } from "./demo-login";
import { SIGN_IN_COPY } from "./sign-in-copy";
import styles from "./SignIn.module.css";

interface DemoQuickLoginProps {
  lang: Language;
  /** The regular admission (device cleanup, then navigation to the role's space). */
  onSignedIn: (actor: Actor) => void;
}

/**
 * Demo-only buttons, shown only for the roles the server enables. A disabled
 * feature or an unreachable endpoint renders nothing (no error banner).
 */
export function DemoQuickLogin({ lang, onSignedIn }: DemoQuickLoginProps) {
  const copy = SIGN_IN_COPY[lang];
  const [roles, setRoles] = useState<DemoRole[]>([]);
  const [pending, setPending] = useState<DemoRole | null>(null);
  const [failure, setFailure] = useState<ErrorDescription | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getDemoLoginRoles({ signal: controller.signal }).then((enabled) => {
      if (!controller.signal.aborted) setRoles(enabled);
    });
    return () => controller.abort();
  }, []);

  if (roles.length === 0) return null;

  const signIn = async (role: DemoRole) => {
    setPending(role);
    setFailure(null);
    try {
      onSignedIn(await postDemoLogin(role));
    } catch (caught) {
      setFailure(describeApiError(caught, lang));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card as="section" id="demo-sign-in" title={copy.demoTitle} description={copy.demoDescription} padding="lg">
      <div className={styles.form}>
        <div className={styles.activeActions}>
          {roles.map((role) => (
            <Button
              key={role}
              variant="secondary"
              size="lg"
              iconStart={role === "clinician" ? "stethoscope" : "user"}
              loading={pending === role}
              disabled={pending !== null}
              onClick={() => void signIn(role)}
            >
              {role === "clinician" ? copy.demoClinician : copy.demoPatient}
            </Button>
          ))}
        </div>
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title={failure.title}>
            {failure.message}
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}
