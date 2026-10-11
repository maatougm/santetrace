"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Card, Field, Notice, TextInput, describedBy } from "@/components/ui";
import { loginAccount, normalizeLogin } from "@/lib/client/accounts-api";
import { toApiError, type Actor, type Language } from "@/lib/client/api";
import { DEMO_CLINICIAN_LOGINS } from "@/lib/client/config";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { accountErrorText, type AccountErrorText } from "./account-errors";
import { validateLogin, type FieldErrors } from "./account-validation";
import { SIGN_IN_COPY } from "./sign-in-copy";
import styles from "./SignIn.module.css";

interface ClinicianLoginFormProps {
  lang: Language;
  onSignedIn: (actor: Actor) => void;
}

/** Preconfigured fictional doctors sign in with login + password. No doctor creates a patient record. */
export function ClinicianLoginForm({ lang, onSignedIn }: ClinicianLoginFormProps) {
  const copy = SIGN_IN_COPY[lang];
  const auth = ACCESS_COPY[lang].auth;
  const ids = useId();
  const loginId = `${ids}-login`;
  const passwordId = `${ids}-password`;
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<"login" | "password">>({});
  const [submitError, setSubmitError] = useState<AccountErrorText | null>(null);
  const [pending, setPending] = useState(false);
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    const nextErrors = validateLogin(login, password, auth);
    setErrors(nextErrors);
    if (nextErrors.login) return loginRef.current?.focus();
    if (nextErrors.password) return passwordRef.current?.focus();
    setPending(true);
    try {
      const envelope = await loginAccount({ login: normalizeLogin(login), password });
      if (!envelope.actor || envelope.actor.role !== "clinician") {
        setSubmitError({ title: copy.rejectedTitle, message: auth.invalidCredentials });
        return;
      }
      setPassword("");
      onSignedIn(envelope.actor);
    } catch (caught) {
      setSubmitError(accountErrorText(toApiError(caught), lang, auth));
    } finally {
      setPending(false);
    }
  }

  const loginHint =
    DEMO_CLINICIAN_LOGINS.length > 0 ? (
      <span className={styles.hint}>
        {auth.clinicianHint}{" "}
        {DEMO_CLINICIAN_LOGINS.map((name, index) => (
          <span key={name}>
            {index > 0 ? ", " : ""}
            <code dir="ltr">{name}</code>
          </span>
        ))}
      </span>
    ) : (
      auth.clinicianHint
    );

  return (
    <Card
      as="section"
      id="clinician-sign-in"
      eyebrow={copy.clinicianRole}
      title={copy.clinicianTitle}
      description={copy.clinicianDescription}
      padding="lg"
    >
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field label={auth.loginLabel} htmlFor={loginId} hint={loginHint} error={errors.login ?? null} required>
          <TextInput
            ref={loginRef}
            id={loginId}
            name="login"
            value={login}
            onChange={(event) => {
              setLogin(event.target.value);
              setErrors((current) => ({ ...current, login: undefined }));
            }}
            autoComplete="username"
            dir="ltr"
            invalid={Boolean(errors.login)}
            aria-describedby={describedBy(loginId, { hint: true, error: Boolean(errors.login) })}
          />
        </Field>
        <Field label={copy.passwordLabel} htmlFor={passwordId} error={errors.password ?? null} required>
          <TextInput
            ref={passwordRef}
            id={passwordId}
            type="password"
            name="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setErrors((current) => ({ ...current, password: undefined }));
            }}
            autoComplete="current-password"
            dir="ltr"
            invalid={Boolean(errors.password)}
            aria-describedby={describedBy(passwordId, { error: Boolean(errors.password) })}
          />
        </Field>

        {submitError && (
          <Notice tone="red" title={submitError.title} role="alert">
            {submitError.message}
          </Notice>
        )}

        <Button type="submit" variant="secondary" size="lg" fullWidth loading={pending} iconEnd="arrow-right">
          {copy.clinicianSubmit}
        </Button>
      </form>
    </Card>
  );
}
