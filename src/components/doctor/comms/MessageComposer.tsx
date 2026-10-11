"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Notice, SegmentedControl, TextArea, describedBy } from "@/components/ui";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { sendMessage, type CareMessage, type MessageInput } from "@/lib/client/care-api";
import { createClientId } from "@/lib/client/ids";
import { errorText } from "../shared/ApiErrorState";
import { MESSAGE_TEXT_MAX, validateMessageText, type MessageTextProblem } from "./message-state";
import styles from "./Comms.module.css";

type Kind = MessageInput["kind"];

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "clinical", label: "Message clinique" },
  { value: "administrative", label: "Message administratif" },
];

const PROBLEM_TEXT: Record<MessageTextProblem, string> = {
  empty: "Écrivez un message.",
  too_long: `Message trop long (${MESSAGE_TEXT_MAX} caractères au plus).`,
  invalid: "Texte simple uniquement : retirez les caractères de contrôle.",
};

interface MessageComposerProps {
  patientId: string;
  actorId: string;
  fence: AccessFence;
  onSent: (message: CareMessage) => void;
}

/** Plain-text message to the patient. A failed send keeps the text and retries with the same key. */
export function MessageComposer({ patientId, actorId, fence, onSent }: MessageComposerProps) {
  const textId = useId();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("clinical");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pendingRef = useRef<{ text: string; kind: Kind; clientId: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateMessageText(text);
    setError(problem ? PROBLEM_TEXT[problem] : null);
    if (problem) {
      document.getElementById(textId)?.focus();
      return;
    }
    const pending = pendingRef.current;
    const clientId = pending && pending.text === text && pending.kind === kind ? pending.clientId : createClientId("message");
    pendingRef.current = { text, kind, clientId };
    setSubmitting(true);
    setFailure(null);
    setSent(false);
    try {
      const result = await runFenced(fence, () =>
        sendMessage(patientId, { text: text.trim(), kind, clinicianId: actorId, clientId }),
      );
      if (result.status === "stale") return;
      pendingRef.current = null;
      setText("");
      setSent(true);
      onSent(result.value.message);
    } catch (caught) {
      setFailure(errorText(caught));
      document.getElementById(textId)?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const hint = `Texte simple, ${MESSAGE_TEXT_MAX} caractères au plus. Le patient le lit dans son espace Contact ; aucune notification externe ni délai de lecture n’est garanti.`;

  return (
    <form className={styles.composer} onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Votre message" htmlFor={textId} hint={hint} error={error} required>
        <TextArea
          id={textId}
          value={text}
          rows={4}
          maxLength={MESSAGE_TEXT_MAX}
          invalid={Boolean(error)}
          aria-describedby={describedBy(textId, { hint, error })}
          onChange={(event) => {
            setText(event.target.value);
            setSent(false);
            if (error) setError(null);
          }}
        />
      </Field>
      <div className={styles.composerFoot}>
        <SegmentedControl<Kind> ariaLabel="Type de message" options={KIND_OPTIONS} value={kind} onChange={setKind} size="md" />
        <span className={styles.counter} aria-hidden="true">
          {text.length} / {MESSAGE_TEXT_MAX}
        </span>
        <Button type="submit" variant="primary" iconStart="send" loading={submitting}>
          Envoyer
        </Button>
      </div>
      {failure ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title="Message non envoyé">
          {failure} Votre texte est conservé ; un nouvel essai ne crée pas de doublon.
        </Notice>
      ) : null}
      {sent ? <Notice tone="success">Enregistré par le serveur. Cela ne signifie pas que le patient l’a lu.</Notice> : null}
    </form>
  );
}
