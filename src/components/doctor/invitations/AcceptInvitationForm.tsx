"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Card, Field, LinkButton, Notice, TextInput, describedBy } from "@/components/ui";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { acceptDoctorInvitation, type CareGrant } from "@/lib/client/grants-api";
import { createClientId } from "@/lib/client/ids";
import { patientHref } from "../shared/routes";
import { INVITATION_TOKEN_MAX, invitationAcceptError, normalizeInvitationToken, readInvitationFragment } from "./invitation-fragment";
import styles from "./Invitations.module.css";

const access = ACCESS_COPY.fr;

interface AcceptInvitationFormProps {
  onAccepted: (grant: CareGrant) => void;
}

/**
 * Reads `#invitation=<token>` once, strips it from the address immediately and
 * keeps it in memory only. Acceptance always needs an explicit click.
 */
function useFragmentToken(onToken: (token: string | null) => void) {
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  useEffect(() => {
    const consume = () => {
      const read = readInvitationFragment(window.location.hash);
      if (!read.present) return;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${read.remainingHash}`);
      onTokenRef.current(read.token);
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => window.removeEventListener("hashchange", consume);
  }, []);
}

export function AcceptInvitationForm({ onAccepted }: AcceptInvitationFormProps) {
  const tokenId = useId();
  const [token, setToken] = useState("");
  const [fromLink, setFromLink] = useState<"read" | "unusable" | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<CareGrant | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One key per token: a retry after a lost answer cannot accept twice.
  const attemptRef = useRef<{ token: string; clientId: string } | null>(null);

  useFragmentToken((read) => {
    setAccepted(null);
    setFailure(null);
    setFromLink(read ? "read" : "unusable");
    if (read) setToken(read);
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeInvitationToken(token);
    setFieldError(normalized ? null : "Saisissez le code d’invitation transmis par le patient (sans espace).");
    if (!normalized) {
      document.getElementById(tokenId)?.focus();
      return;
    }
    const clientId = attemptRef.current?.token === normalized ? attemptRef.current.clientId : createClientId("invitation-accept");
    attemptRef.current = { token: normalized, clientId };
    setSubmitting(true);
    setFailure(null);
    try {
      const { grant } = await acceptDoctorInvitation({ token: normalized, clientId });
      attemptRef.current = null;
      setToken("");
      setFromLink(null);
      setAccepted(grant);
      onAccepted(grant);
    } catch (caught) {
      setFailure(invitationAcceptError(caught));
      document.getElementById(tokenId)?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const hint =
    "Collez le code transmis par le patient, ou ouvrez son lien : le code est alors lu puis retiré de l’adresse. Il n’est ni enregistré sur cet appareil ni affiché ailleurs.";

  return (
    <Card
      title="Accepter une invitation"
      description="Le patient a choisi votre rôle et les sections partagées. Il peut retirer cet accès à tout moment : vos demandes suivantes seront alors refusées."
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        {fromLink === "read" ? (
          <Notice tone="info" icon="link">
            Code lu depuis le lien et retiré de l’adresse. Rien n’est accepté tant que vous ne cliquez pas sur « Accepter
            l’invitation ».
          </Notice>
        ) : null}
        {fromLink === "unusable" ? (
          <Notice tone="neutral" icon="help-circle">
            Le lien contenait un code d’invitation illisible ; il a été retiré de l’adresse. Saisissez le code transmis par le
            patient.
          </Notice>
        ) : null}
        <Field label="Code d’invitation" htmlFor={tokenId} hint={hint} error={fieldError} required>
          <TextInput
            id={tokenId}
            value={token}
            maxLength={INVITATION_TOKEN_MAX}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            invalid={Boolean(fieldError)}
            aria-describedby={describedBy(tokenId, { hint, error: fieldError })}
            onChange={(event) => {
              setToken(event.target.value);
              if (fieldError) setFieldError(null);
            }}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" iconStart="check" loading={submitting}>
            Accepter l’invitation
          </Button>
        </div>
        {failure ? (
          <Notice tone="neutral" icon="x-circle" role="alert" title="Invitation non acceptée">
            {failure}
          </Notice>
        ) : null}
        {accepted ? (
          <Notice
            tone="success"
            title="Invitation acceptée par le serveur"
            action={
              <LinkButton href={patientHref(accepted.patientId)} size="sm" iconEnd="arrow-right">
                Ouvrir le dossier
              </LinkButton>
            }
          >
            {access.relationship[accepted.relationship]} · sections partagées :{" "}
            {accepted.scopes.map((scope) => access.scope[scope]).join(", ")}. {access.grantState[accepted.state]}.
          </Notice>
        ) : null}
      </form>
    </Card>
  );
}
