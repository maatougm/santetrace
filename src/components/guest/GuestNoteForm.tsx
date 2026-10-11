"use client";

/**
 * Append-only note from the external practitioner. A correction is a new
 * note pointing at an earlier note of this grant; nothing is edited or
 * validated. One clientId per note, reused on retry of the same text. Only
 * the server's answer is shown as recorded; a refusal ends the session view.
 */
import { useId, useState, type FormEvent } from "react";
import { Button, Field, Notice, Select, TextArea, TextInput, describedBy } from "@/components/ui";
import type { ExternalNote, GuestRecord } from "@/contracts/external-visit";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { formatDateTime, toDateInputValue } from "@/lib/client/format";
import { getMessages } from "@/lib/client/i18n";
import { createClientId } from "@/lib/client/ids";
import { addGuestNote, GUEST_LIMITS, isGuestSessionOver } from "@/lib/client/share-api";
import { describeApiError, toApiError, type ApiError, type Language } from "@/lib/client/transport";
import { correctableNotes, guestNoteInput, type GuestNoteDraft, type NoteError, type PendingNote } from "./guest-state";
import styles from "./guest.module.css";

const EMPTY_DRAFT: GuestNoteDraft = { text: "", consultationDate: "", correctsNoteId: "" };
const EXCERPT_LENGTH = 40;

function correctionLabel(note: ExternalNote, lang: Language): string {
  const excerpt = note.text.length > EXCERPT_LENGTH ? `${note.text.slice(0, EXCERPT_LENGTH)}…` : note.text;
  return `${formatDateTime(note.receivedAt, lang)} · ${excerpt}`;
}

interface GuestNoteFormProps {
  record: GuestRecord;
  lang: Language;
  onAdded: (note: ExternalNote) => void;
  onSessionOver: () => void;
}

export function GuestNoteForm({ record, lang, onAdded, onSessionOver }: GuestNoteFormProps) {
  const copy = SHARE_COPY[lang].guest;
  const base = useId();
  const textId = `${base}-text`;
  const dateId = `${base}-date`;
  const correctsId = `${base}-corrects`;
  const [draft, setDraft] = useState<GuestNoteDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState<PendingNote | null>(null);
  const [fieldError, setFieldError] = useState<NoteError | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const correctable = correctableNotes(record);

  const set = (patch: Partial<GuestNoteDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setAdded(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const result = guestNoteInput(draft, record, pending, () => createClientId("guest-note"));
    if (!result.ok) {
      setFieldError(result.error);
      document.getElementById(textId)?.focus();
      return;
    }
    setFieldError(null);
    setFailure(null);
    setPending({ input: result.input, received: false });
    setBusy(true);
    try {
      const { note } = await addGuestNote(result.input);
      setPending({ input: result.input, received: true });
      setDraft(EMPTY_DRAFT);
      setAdded(true);
      onAdded(note);
    } catch (caught) {
      const error = toApiError(caught);
      if (isGuestSessionOver(error)) {
        onSessionOver();
        return;
      }
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const textError = fieldError ? copy[fieldError] : null;
  const failureText = failure ? describeApiError(failure, lang) : null;
  const length = draft.text.trim().length;

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Field label={copy.noteLabel} htmlFor={textId} hint={copy.noteHint} error={textError} required requiredLabel={getMessages(lang).common.required}>
        <TextArea
          id={textId}
          rows={5}
          dir="auto"
          readOnly={busy}
          value={draft.text}
          onChange={(event) => set({ text: event.target.value })}
          invalid={Boolean(textError)}
          aria-describedby={describedBy(textId, { hint: copy.noteHint, error: textError })}
        />
      </Field>
      <p className={styles.counter} aria-hidden="true">
        <bdi dir="ltr">
          {length} / {GUEST_LIMITS.noteMax}
        </bdi>
      </p>
      <Field label={copy.consultationDateLabel} htmlFor={dateId}>
        <TextInput
          id={dateId}
          type="date"
          dir="ltr"
          max={toDateInputValue(new Date().toISOString())}
          readOnly={busy}
          value={draft.consultationDate}
          onChange={(event) => set({ consultationDate: event.target.value })}
        />
      </Field>
      {correctable.length > 0 ? (
        <Field label={copy.correctsLabel} htmlFor={correctsId}>
          <Select id={correctsId} disabled={busy} value={draft.correctsNoteId} onChange={(event) => set({ correctsNoteId: event.target.value })}>
            <option value="">{copy.correctsNone}</option>
            {correctable.map((note) => (
              <option key={note.id} value={note.id}>
                {correctionLabel(note, lang)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {failureText ? (
        <Notice tone="neutral" icon="x-circle" title={failureText.title} role="alert">
          {failureText.message}
        </Notice>
      ) : null}
      {added ? (
        <Notice tone="success" icon="check">
          {copy.noteAdded}
        </Notice>
      ) : null}
      <Button type="submit" variant="primary" iconStart="send" loading={busy}>
        {busy ? copy.addingNote : copy.addNote}
      </Button>
    </form>
  );
}
