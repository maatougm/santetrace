"use client";

import { Badge, Card, EmptyState, Timestamp } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import type { ExternalNote } from "@/contracts/external-visit";
import { SHARE_COPY } from "@/lib/client/copy/share";
import styles from "./Record.module.css";

const copy = SHARE_COPY.fr.share;

/**
 * Notes appended by external practitioners during a one-use consultation.
 * Append-only and unverified: a correction is a new note, nothing here edits
 * history, confirms a fact or approves an action.
 */
export function ExternalNotesSection({ notes }: { notes: readonly ExternalNote[] }) {
  if (notes.length === 0) {
    return <EmptyState icon="file-text" title={copy.notesEmpty} description="Aucune consultation externe n’a ajouté de note à ce dossier." />;
  }
  const ordered = [...notes].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return (
    <Card title={copy.notesTitle} description="Ajoutées par un médecin externe, identité déclarée et non vérifiée. Elles ne modifient ni ne valident rien.">
      <ol className={styles.facts}>
        {ordered.map((note) => (
          <li key={note.id} className={styles.externalNote}>
            <p className={styles.externalNoteHead}>
              <strong>{copy.noteBy(note.declaredName, note.organization)}</strong>
              <Badge tone="outline" icon="help-circle">
                {copy.noteUnverified}
              </Badge>
              {note.correctsNoteId ? <Badge tone="muted">{copy.noteCorrects}</Badge> : null}
            </p>
            {/* Authored by an external practitioner, language not recorded: unknown lang + automatic direction. */}
            <p className={styles.externalNoteText} {...UNKNOWN_LANGUAGE_TEXT}>
              {note.text}
            </p>
            <p className={styles.externalNoteMeta}>
              <Timestamp iso={note.receivedAt} label="Reçue le" />
              {note.consultationDate ? <span>{copy.consultationDate(note.consultationDate.slice(0, 10))}</span> : null}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
