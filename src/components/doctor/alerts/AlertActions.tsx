"use client";

import { useId, useState } from "react";
import { Button, Field, Notice, TextArea, describedBy } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import { UNGUARDED_MUTATIONS, type MutationGuard } from "@/lib/client/access-fence";
import { updateAlert, type Alert, type AlertAction } from "@/lib/client/api";
import { errorText } from "../shared/ApiErrorState";
import styles from "./AlertDetail.module.css";

interface AlertActionsProps {
  alert: Alert;
  onUpdated: (alert: Alert) => void;
  /** Element focused after a successful action (the clicked button may unmount). */
  focusAfterId?: string;
  /**
   * Patient-record views pass the record's mutation guard: a result held across
   * an authority change (narrower scopes, revocation, patient switch) is discarded.
   */
  guard?: MutationGuard;
}

const DISCARDED = "Résultat écarté : l’accès au dossier a changé pendant l’opération. Vérifiez l’état actuel avant de recommencer.";

const NOTE_MAX = 500;

const NOTE_REQUIRED: Record<Exclude<AlertAction, "acknowledge">, string> = {
  resolve: "Décrivez le suivi effectué pour résoudre l’alerte.",
  reject: "Indiquez le motif du rejet de l’alerte.",
};

const SUCCESS: Record<AlertAction, string> = {
  acknowledge:
    "Réception accusée. L’alerte reste ouverte jusqu’à sa résolution ; cette action ne contacte pas le patient.",
  resolve: "Alerte résolue avec votre note de suivi. Elle reste consultable dans l’historique.",
  reject: "Alerte rejetée avec votre motif. La mesure source et l’historique sont conservés.",
};

/**
 * Three distinct clinician actions. Acknowledge is one click; resolve and
 * reject require a non-blank note and are terminal on the server.
 */
export function AlertActions({ alert, onUpdated, focusAfterId, guard = UNGUARDED_MUTATIONS }: AlertActionsProps) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pending, setPending] = useState<AlertAction | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const open = alert.status === "new" || alert.status === "acknowledged";
  // Persistent live region: present before the message so screen readers announce it.
  const liveRegion = (
    <p className={styles.srOnly} role="status" aria-live="polite">
      {success ?? ""}
    </p>
  );
  const visibleSuccess = success ? (
    <Notice tone="success" role="note">
      {success}
    </Notice>
  ) : null;

  if (!open) {
    return (
      <div className={styles.actions}>
        {liveRegion}
        {visibleSuccess ?? (
          <p className={styles.muted}>Alerte clôturée : aucune autre action n’est possible. L’historique reste consultable.</p>
        )}
      </div>
    );
  }

  const run = async (action: AlertAction) => {
    const trimmed = note.trim();
    if (action !== "acknowledge" && !trimmed) {
      setNoteError(NOTE_REQUIRED[action]);
      document.getElementById(noteId)?.focus();
      return;
    }
    if (trimmed.length > NOTE_MAX) {
      setNoteError(`La note ne peut pas dépasser ${NOTE_MAX} caractères.`);
      return;
    }
    setNoteError(null);
    setFailure(null);
    setSuccess(null);
    setPending(action);
    // Ticket taken before the request: success AND failure are both gated by it.
    const commit = guard.begin();
    try {
      const input =
        action === "acknowledge"
          ? { action, ...(trimmed ? { note: trimmed } : {}) }
          : { action, note: trimmed };
      const result = await updateAlert(alert.id, input);
      if (!commit(() => onUpdated(result.alert))) {
        setFailure(DISCARDED);
        return;
      }
      setNote("");
      setSuccess(SUCCESS[action]);
      if (focusAfterId) {
        requestAnimationFrame(() => document.getElementById(focusAfterId)?.focus({ preventScroll: false }));
      }
    } catch (error) {
      if (!commit(() => setFailure(errorText(error)))) setFailure(DISCARDED);
    } finally {
      setPending(null);
    }
  };

  const hint = "Obligatoire pour résoudre ou rejeter ; facultative pour accuser réception.";

  return (
    <div className={styles.actions}>
      {liveRegion}
      <ul className={styles.definitions}>
        <li>
          <strong>Accuser réception</strong> : vous avez vu l’alerte. Ce n’est ni une résolution, ni un contact avec le
          patient.
        </li>
        <li>
          <strong>Résoudre</strong> : le suivi a été effectué (décrivez-le). Définitif.
        </li>
        <li>
          <strong>Rejeter</strong> : alerte jugée non pertinente (motif requis). Définitif ; la mesure est conservée.
        </li>
      </ul>

      <Field label="Note de suivi" htmlFor={noteId} hint={hint} error={noteError}>
        <TextArea
          {...UNKNOWN_LANGUAGE_TEXT}
          id={noteId}
          value={note}
          rows={3}
          maxLength={NOTE_MAX}
          invalid={Boolean(noteError)}
          aria-describedby={describedBy(noteId, { hint, error: noteError })}
          onChange={(event) => {
            setNote(event.target.value);
            if (noteError) setNoteError(null);
          }}
        />
      </Field>

      <div className={styles.buttonRow}>
        {alert.status === "new" ? (
          <Button
            variant="primary"
            iconStart="check"
            loading={pending === "acknowledge"}
            disabled={pending !== null}
            onClick={() => void run("acknowledge")}
          >
            Accuser réception
          </Button>
        ) : null}
        <Button
          variant="secondary"
          iconStart="check-circle"
          loading={pending === "resolve"}
          disabled={pending !== null}
          onClick={() => void run("resolve")}
        >
          Résoudre
        </Button>
        <Button
          variant="secondary"
          iconStart="x-circle"
          loading={pending === "reject"}
          disabled={pending !== null}
          onClick={() => void run("reject")}
        >
          Rejeter
        </Button>
      </div>

      {failure ? (
        <Notice tone="neutral" icon="x-circle" role="alert" title="Action non enregistrée">
          {failure}
        </Notice>
      ) : null}
      {visibleSuccess}
    </div>
  );
}
