"use client";

/**
 * Plain-text message to one clinician (≤ 2000 characters). Always clinical:
 * the server treats all patient text as clinical context, so no type is
 * offered. Online only: offline nothing is sent or queued. One clientId per
 * message, reused on a retry of the same text; any edit makes it a new
 * message. "Sent" means recorded by the server, never read.
 */
import { useState, type FormEvent } from "react";
import { Button, Field, Notice, TextArea, describedBy } from "@/components/ui";
import type { CareMessage } from "@/contracts/monitoring";
import { runFenced } from "@/lib/client/access-fence";
import { sendMessage } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { describeApiError, toApiError, type ErrorDescription, type Language } from "@/lib/client/transport";
import { Ltr } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { buildMessageInput, validateMessage, type MessageError } from "./contact-view";
import styles from "./contact.module.css";

const TEXT_ID = "contact-message";

interface MessageComposerProps {
  patientId: string;
  clinicianId: string;
  lang: Language;
  onSent: (message: CareMessage) => void;
}

export function MessageComposer({ patientId, clinicianId, lang, onSent }: MessageComposerProps) {
  const { data, online, t } = usePatientRuntime();
  const copy = CARE_COPY[lang];
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<MessageError | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorDescription | null>(null);
  const [sent, setSent] = useState(false);

  const edit = (next: string) => {
    setText(next);
    setDraftId(null);
    setFieldError(null);
    setSent(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!online) return;
    const invalid = validateMessage(text);
    setFieldError(invalid);
    if (invalid) {
      document.getElementById(TEXT_ID)?.focus();
      return;
    }
    const clientId = draftId ?? createClientId("msg");
    setDraftId(clientId);
    setBusy(true);
    setFailure(null);
    setSent(false);
    try {
      const result = await runFenced(data.fence, () => sendMessage(patientId, buildMessageInput(text, clinicianId, clientId)));
      if (result.status === "stale") return;
      onSent(result.value.message);
      setText("");
      setDraftId(null);
      setSent(true);
    } catch (caught) {
      const apiError = toApiError(caught);
      setFailure(describeApiError(apiError, lang));
      // The text is kept. A conflict means this attempt cannot be replayed as is.
      if (apiError.isConflict) setDraftId(null);
    } finally {
      setBusy(false);
    }
  };

  const errorText = fieldError ? copy.contact[fieldError] : null;
  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={copy.contact.composeLabel} htmlFor={TEXT_ID} hint={copy.contact.composeHint} error={errorText} required requiredLabel={t.common.required}>
        <TextArea
          id={TEXT_ID}
          value={text}
          rows={4}
          dir="auto"
          readOnly={busy}
          invalid={Boolean(errorText)}
          aria-describedby={describedBy(TEXT_ID, { hint: copy.contact.composeHint, error: errorText })}
          onChange={(event) => edit(event.target.value)}
        />
      </Field>
      {failure ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title={`${copy.messageState.notSent} — ${failure.title}`}>
          {failure.message} <Ltr>{failure.code}</Ltr>
        </Notice>
      ) : null}
      {sent ? (
        <Notice tone="neutral" icon="check">
          {copy.contact.sentNote}
        </Notice>
      ) : null}
      <div className={styles.submit}>
        <Button type="submit" variant="primary" iconStart="send" loading={busy} disabled={!online || busy}>
          {busy ? copy.contact.sending : copy.contact.send}
        </Button>
      </div>
    </form>
  );
}
