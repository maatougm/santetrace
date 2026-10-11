"use client";

/**
 * Notes left by external practitioners through a one-time share. Read-only and
 * append-only: no edit or delete here; a correction is a new note marked as
 * such. The author's name and organisation are declared, never verified, and
 * the text is shown as plain text.
 */
import { Card, Icon } from "@/components/ui";
import type { ExternalNote } from "@/contracts/external-visit";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { formatDate } from "@/lib/client/format";
import type { Language } from "@/lib/client/transport";
import { When } from "../bits";
import { VerificationBadge } from "./FactItem";
import { sortExternalNotes } from "./record-model";
import styles from "../patient.module.css";
import rec from "./record.module.css";

interface ExternalNotesProps {
  notes: readonly ExternalNote[];
  lang: Language;
  /** "Reçue par le serveur le" label (patient common copy). */
  receivedLabel: string;
}

export function ExternalNotes({ notes, lang, receivedLabel }: ExternalNotesProps) {
  const copy = SHARE_COPY[lang].share;
  return (
    <Card id="record-external-notes" title={copy.notesTitle}>
      <ul className={rec.factList}>
        {sortExternalNotes(notes).map((note) => (
          <li key={note.id} className={rec.fact}>
            <div className={rec.factHead}>
              <h3 className={rec.factLabel}>
                <bdi>{copy.noteBy(note.declaredName, note.organization)}</bdi>
              </h3>
              <VerificationBadge verification={note.verification} lang={lang} />
            </div>
            <p className={styles.metaLine}>
              <Icon name="help-circle" size={14} /> {copy.noteUnverified}
            </p>
            {note.correctsNoteId ? (
              <p className={styles.metaLine}>
                <Icon name="edit" size={14} /> {copy.noteCorrects}
              </p>
            ) : null}
            <p className={rec.factValue}>
              <bdi>{note.text}</bdi>
            </p>
            {note.consultationDate ? <p className={styles.metaLine}>{copy.consultationDate(formatDate(note.consultationDate, lang))}</p> : null}
            <p className={styles.metaLine}>
              <When iso={note.receivedAt} lang={lang} label={receivedLabel} />
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
