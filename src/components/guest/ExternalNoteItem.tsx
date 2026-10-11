"use client";

/**
 * One external note as recorded by the server: declared (unverified) author,
 * plain text, optional consultation date, and the correction marker. Notes
 * are append-only: a correction is a new note pointing at an earlier one.
 */
import { Badge } from "@/components/ui";
import type { ExternalNote } from "@/contracts/external-visit";
import { CARE_COPY } from "@/lib/client/copy/care";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { Language } from "@/lib/client/transport";
import { When } from "@/components/patient/bits";
import { formatCalendarDate } from "./guest-state";
import styles from "./guest.module.css";

interface ExternalNoteItemProps {
  note: ExternalNote;
  lang: Language;
  /** "Identité déclarée, non vérifiée" (owner) or "Auteur déclaré, non vérifié" (guest). */
  unverifiedLabel: string;
}

export function noteAnchorId(noteId: string): string {
  return `note-${noteId}`;
}

export function ExternalNoteItem({ note, lang, unverifiedLabel }: ExternalNoteItemProps) {
  const copy = SHARE_COPY[lang].share;
  return (
    <article className={styles.note} id={noteAnchorId(note.id)}>
      <header className={styles.noteHead}>
        <p className={styles.noteAuthor}>
          <bdi>{copy.noteBy(note.declaredName, note.organization)}</bdi>
        </p>
        <div className={styles.badges}>
          <Badge tone="outline" icon="user">
            {unverifiedLabel}
          </Badge>
          <Badge tone="outline" icon="message">
            {CARE_COPY[lang].verification[note.verification]}
          </Badge>
          {note.correctsNoteId ? (
            <Badge tone="neutral" icon="edit">
              {copy.noteCorrects}
            </Badge>
          ) : null}
        </div>
      </header>
      <p className={styles.noteText} dir="auto">
        {note.text}
      </p>
      <p className={styles.meta}>
        {note.consultationDate ? (
          <>
            {copy.consultationDate(formatCalendarDate(note.consultationDate, lang))}
            {" · "}
          </>
        ) : null}
        <When iso={note.receivedAt} lang={lang} />
      </p>
    </article>
  );
}
