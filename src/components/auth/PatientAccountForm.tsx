"use client";

/**
 * Patient-owned account: sign in again, or create the record (optionally
 * claiming an existing fictional record with an operator code read from
 * `#claim=…`, then stripped from the URL). Credentials and codes live only in
 * this form's memory; the parent admits the actor (device purge) before any
 * navigation.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Card, Checkbox, Field, Notice, SegmentedControl, Select, TextInput, describedBy } from "@/components/ui";
import { loginAccount, registerPatient } from "@/lib/client/accounts-api";
import { toApiError, type Actor, type Language } from "@/lib/client/api";
import { readClaimCode } from "@/lib/client/config";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { createClientId } from "@/lib/client/ids";
import { accountErrorText, type AccountErrorText } from "./account-errors";
import {
  REGISTRATION_FIELDS,
  firstInvalid,
  toRegistration,
  validateLogin,
  validateRegistration,
  type FieldErrors,
  type RegistrationDraft,
  type RegistrationField,
} from "./account-validation";
import styles from "./SignIn.module.css";

type Mode = "signin" | "register";

interface PatientAccountFormProps {
  lang: Language;
  onSignedIn: (actor: Actor) => void;
}

const EMPTY_DRAFT: RegistrationDraft = {
  login: "",
  password: "",
  passwordConfirm: "",
  displayName: "",
  region: "",
  age: "",
  language: "fr",
  consent: false,
  fictional: false,
  claimCode: "",
};

function takeClaimFromFragment(): string | null {
  const code = readClaimCode(window.location.hash);
  if (code) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return code;
}

export function PatientAccountForm({ lang, onSignedIn }: PatientAccountFormProps) {
  const copy = ACCESS_COPY[lang].auth;
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;
  const [mode, setMode] = useState<Mode>("signin");
  const [draft, setDraft] = useState<RegistrationDraft>({ ...EMPTY_DRAFT, language: lang });
  const [errors, setErrors] = useState<FieldErrors<RegistrationField>>({});
  const [submitError, setSubmitError] = useState<AccountErrorText | null>(null);
  const [pending, setPending] = useState(false);
  const [claimFromLink, setClaimFromLink] = useState(false);
  /** One idempotency key per registration attempt, reused on retry until the draft changes. */
  const clientIdRef = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const claim = takeClaimFromFragment();
    if (claim) {
      setDraft((current) => ({ ...current, claimCode: claim }));
      setClaimFromLink(true);
      setMode("register");
    }
  }, []);

  const update = <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => {
    clientIdRef.current = null;
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const focusField = (field: RegistrationField | null) => {
    if (!field) return;
    formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(fieldId(field))}`)?.focus();
  };

  async function submitSignIn() {
    const nextErrors = validateLogin(draft.login, draft.password, copy);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusField(firstInvalid<RegistrationField>(["login", "password"], nextErrors));
      return;
    }
    const envelope = await loginAccount({ login: draft.login.trim().toLowerCase(), password: draft.password });
    if (!envelope.actor || envelope.actor.role !== "patient") {
      setSubmitError({ title: lang === "fr" ? "Connexion refusée" : "تم رفض الدخول", message: copy.invalidCredentials });
      return;
    }
    setDraft({ ...EMPTY_DRAFT, language: lang });
    onSignedIn(envelope.actor);
  }

  async function submitRegister() {
    const nextErrors = validateRegistration(draft, copy);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusField(firstInvalid(REGISTRATION_FIELDS, nextErrors));
      return;
    }
    clientIdRef.current ??= createClientId("account");
    const result = await registerPatient(toRegistration(draft, clientIdRef.current));
    setDraft({ ...EMPTY_DRAFT, language: lang });
    clientIdRef.current = null;
    onSignedIn(result.actor);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setPending(true);
    try {
      if (mode === "signin") await submitSignIn();
      else await submitRegister();
    } catch (caught) {
      setSubmitError(accountErrorText(toApiError(caught), lang, copy));
    } finally {
      setPending(false);
    }
  }

  const textField = (
    name: "login" | "password" | "passwordConfirm" | "displayName" | "region" | "age" | "claimCode",
    label: string,
    options: { type?: string; autoComplete?: string; hint?: string; ltr?: boolean; inputMode?: "numeric"; required?: boolean } = {},
  ) => {
    const error = errors[name] ?? null;
    return (
      <Field label={label} htmlFor={fieldId(name)} hint={options.hint} error={error} required={options.required ?? true}>
        <TextInput
          id={fieldId(name)}
          name={name}
          type={options.type ?? "text"}
          value={draft[name]}
          onChange={(event) => update(name, event.target.value)}
          autoComplete={options.autoComplete}
          inputMode={options.inputMode}
          dir={options.ltr ? "ltr" : undefined}
          invalid={Boolean(error)}
          aria-describedby={describedBy(fieldId(name), { hint: Boolean(options.hint), error: Boolean(error) })}
        />
      </Field>
    );
  };

  return (
    <Card as="section" id="patient-account" eyebrow={copy.patientTab} title={mode === "signin" ? copy.signInTitle : copy.registerTitle} description={copy.ownership} padding="lg">
      <form ref={formRef} className={styles.form} onSubmit={handleSubmit} noValidate>
        <SegmentedControl<Mode>
          ariaLabel={copy.patientTab}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setErrors({});
            setSubmitError(null);
          }}
          options={[
            { value: "signin", label: copy.signInTitle },
            { value: "register", label: copy.registerTitle },
          ]}
          fullWidth
        />
        {textField("login", copy.loginLabel, { autoComplete: "username", hint: mode === "register" ? copy.loginHint : undefined, ltr: true })}
        {textField("password", copy.passwordLabel, {
          type: "password",
          autoComplete: mode === "signin" ? "current-password" : "new-password",
          hint: mode === "register" ? copy.passwordHint : undefined,
          ltr: true,
        })}
        {mode === "register" && (
          <>
            {textField("passwordConfirm", copy.passwordConfirmLabel, { type: "password", autoComplete: "new-password", ltr: true })}
            {textField("displayName", copy.displayNameLabel, { autoComplete: "nickname" })}
            {textField("region", copy.regionLabel)}
            {textField("age", copy.ageLabel, { inputMode: "numeric", ltr: true })}
            <Field label={copy.languageLabel} htmlFor={fieldId("language")}>
              <Select id={fieldId("language")} value={draft.language} onChange={(event) => update("language", event.target.value === "ar" ? "ar" : "fr")}>
                <option value="fr">Français</option>
                <option value="ar">العربية</option>
              </Select>
            </Field>
            {claimFromLink && <Notice tone="info">{copy.claimDetected}</Notice>}
            {textField("claimCode", copy.claimLabel, { hint: copy.claimHint, ltr: true, required: false })}
            <Checkbox
              id={fieldId("consent")}
              checked={draft.consent}
              onChange={(event) => update("consent", event.target.checked)}
              label={copy.consentLabel}
              description={errors.consent}
              invalid={Boolean(errors.consent)}
            />
            <Checkbox
              id={fieldId("fictional")}
              checked={draft.fictional}
              onChange={(event) => update("fictional", event.target.checked)}
              label={copy.fictionalLabel}
              description={errors.fictional}
              invalid={Boolean(errors.fictional)}
            />
          </>
        )}

        {submitError && (
          <Notice tone="red" title={submitError.title} role="alert">
            {submitError.message}
          </Notice>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={pending} iconEnd="arrow-right">
          {pending ? copy.submitting : mode === "signin" ? copy.submitSignIn : copy.submitRegister}
        </Button>
      </form>
    </Card>
  );
}
