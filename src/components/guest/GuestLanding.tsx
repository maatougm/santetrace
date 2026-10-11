"use client";

/**
 * /share — public landing of a one-use consultation link. On mount the token
 * is read from the fragment (never sent to the server by the browser), kept
 * in memory only, and the fragment is stripped from history. Nothing is
 * requested on load: only the explicit submit redeems the link, so a link
 * preview reveals and consumes nothing. Every refusal looks the same.
 */
import { useEffect, useId, useReducer, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Field, Notice, PageHeader, Skeleton, TextInput, describedBy } from "@/components/ui";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { getMessages } from "@/lib/client/i18n";
import { GUEST_LIMITS, readGuestToken, redeemExternalVisit } from "@/lib/client/share-api";
import { describeApiError, toApiError, type Language } from "@/lib/client/transport";
import { useGuestLanguage } from "./GuestFrame";
import { INITIAL_LANDING, landingReducer, validateDeclaration, type DeclarationError, type GuestDeclaration } from "./guest-state";
import styles from "./guest.module.css";

/** Reads the token once and removes the fragment so it never stays in history or a shared URL. */
function takeTokenFromFragment(): string | null {
  const { hash, pathname, search } = window.location;
  const token = readGuestToken(hash);
  if (hash) window.history.replaceState(null, "", pathname + search);
  return token;
}

function declarationErrorText(error: DeclarationError, lang: Language): string {
  const copy = SHARE_COPY[lang].guest;
  return error === "nameRequired" ? copy.nameRequired : copy.fieldTooLong;
}

export function GuestLanding() {
  const { lang, copy } = useGuestLanguage();
  const router = useRouter();
  const base = useId();
  const nameId = `${base}-name`;
  const orgId = `${base}-org`;
  const [state, dispatch] = useReducer(landingReducer, INITIAL_LANDING);
  const [declaration, setDeclaration] = useState<GuestDeclaration>({ declaredName: "", organization: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof GuestDeclaration, DeclarationError>>>({});

  useEffect(() => {
    dispatch({ type: "fragment_read", token: takeTokenFromFragment() });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.phase !== "ready") return;
    const validation = validateDeclaration(declaration);
    if (!validation.ok) {
      setErrors(validation.errors);
      document.getElementById(validation.errors.declaredName ? nameId : orgId)?.focus();
      return;
    }
    setErrors({});
    const { token } = state;
    dispatch({ type: "submit" });
    try {
      await redeemExternalVisit({ token, ...validation.value });
      dispatch({ type: "redeemed" });
      router.push("/share/session");
    } catch (caught) {
      dispatch({ type: "redeem_failed", error: toApiError(caught) });
    }
  };

  const header = <PageHeader title={copy.landingTitle} description={copy.landingBody} />;

  if (state.phase === "reading") {
    return (
      <div className={styles.page} aria-busy="true">
        {header}
        <Skeleton lines={3} />
      </div>
    );
  }
  if (state.phase === "no_token") {
    return (
      <div className={styles.page}>
        {header}
        <EmptyState icon="link" title={copy.unavailable} description={copy.noToken} />
      </div>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <div className={styles.page}>
        {header}
        <EmptyState icon="lock" title={copy.unavailable} description={copy.unavailableBody} />
      </div>
    );
  }
  if (state.phase === "opened") {
    return (
      <div className={styles.page} aria-busy="true">
        {header}
        <Notice tone="info" icon="clock">
          {copy.opening}
        </Notice>
      </div>
    );
  }

  const submitting = state.phase === "submitting";
  const failure = state.phase === "ready" ? state.failure : null;
  const failureText = failure ? describeApiError(failure, lang) : null;
  const nameError = errors.declaredName ? declarationErrorText(errors.declaredName, lang) : null;
  const orgError = errors.organization ? declarationErrorText(errors.organization, lang) : null;

  return (
    <div className={styles.page}>
      {header}
      <Card id="guest-open">
        <form className={styles.form} onSubmit={submit} noValidate>
          <Notice tone="info" icon="lock">
            {copy.tokenReady}
          </Notice>
          <Field label={copy.declaredNameLabel} htmlFor={nameId} error={nameError} required requiredLabel={getMessages(lang).common.required}>
            <TextInput
              id={nameId}
              autoComplete="name"
              maxLength={GUEST_LIMITS.declaredNameMax}
              value={declaration.declaredName}
              onChange={(event) => setDeclaration((current) => ({ ...current, declaredName: event.target.value }))}
              invalid={Boolean(nameError)}
              aria-describedby={describedBy(nameId, { error: nameError })}
            />
          </Field>
          <Field label={copy.organizationLabel} htmlFor={orgId} error={orgError}>
            <TextInput
              id={orgId}
              autoComplete="organization"
              maxLength={GUEST_LIMITS.organizationMax}
              value={declaration.organization}
              onChange={(event) => setDeclaration((current) => ({ ...current, organization: event.target.value }))}
              invalid={Boolean(orgError)}
              aria-describedby={describedBy(orgId, { error: orgError })}
            />
          </Field>
          <p className={styles.meta}>{copy.declarationNote}</p>
          <Notice tone="neutral" icon="info">
            {copy.oneUse}
          </Notice>
          {failureText ? (
            <Notice tone="neutral" icon="x-circle" title={failureText.title} role="alert">
              {failureText.message}
            </Notice>
          ) : null}
          <Button type="submit" variant="primary" size="lg" fullWidth iconStart="eye" loading={submitting}>
            {submitting ? copy.opening : copy.open}
          </Button>
        </form>
      </Card>
    </div>
  );
}
