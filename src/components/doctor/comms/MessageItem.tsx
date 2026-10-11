"use client";

import { Badge, Button, Timestamp } from "@/components/ui";
import { UNKNOWN_LANGUAGE_TEXT } from "@/components/layout/source-language";
import type { CareMessage } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { canReviewMessage, messageStatus } from "./message-state";
import styles from "./Comms.module.css";

const copy = CARE_COPY.fr;

interface MessageItemProps {
  message: CareMessage;
  viewerId: string;
  canManageCare: boolean;
  onReview: (message: CareMessage) => void;
}

/** Marks a message as the focus stand-in for its own review button (see messageReviewFocusFallback). */
const REVIEW_FOCUS_RETURN = "[data-message-review-focus-return]";

/**
 * Captured by the review dialog when it opens, from the button that opened it:
 * the message holding that button. Recording the review removes the button
 * together with the dialog, so focus lands on the message that was just reviewed.
 */
export function messageReviewFocusFallback(opener: HTMLElement): HTMLElement | null {
  return opener.closest<HTMLElement>(REVIEW_FOCUS_RETURN);
}

function authorLabel(message: CareMessage, mine: boolean): string {
  if (mine) return "Vous";
  if (message.authorCategory === "patient") return "Patient";
  if (message.authorCategory === "system") return "Message automatique";
  return "Autre médecin";
}

/** One message with its separate states: recorded, read receipt, clinical review. */
export function MessageItem({ message, viewerId, canManageCare, onReview }: MessageItemProps) {
  const status = messageStatus(message, viewerId);
  const review = message.review;
  return (
    // tabIndex -1 on every message, reviewed or not: focusable by script once its button is gone, never a tab stop.
    <li className={status.mine ? `${styles.message} ${styles.mine}` : styles.message} data-message-review-focus-return tabIndex={-1}>
      <div className={styles.messageHead}>
        <span className={styles.author}>{authorLabel(message, status.mine)}</span>
        <Badge tone="muted">{copy.messageKind[message.kind]}</Badge>
        <Timestamp iso={message.createdAt} />
      </div>
      {status.forwarded === "copy" ? (
        <p className={styles.reviewLine}>
          <Badge tone="outline" icon="send">
            Copie transférée par le patient
          </Badge>{" "}
          Message initialement adressé à un autre médecin. Seul ce message vous a été transféré, pas le reste de cette
          conversation.
        </p>
      ) : null}
      {/* Authored text, language not recorded: unknown lang + automatic direction (never the French island's fr/ltr). */}
      <p className={styles.messageText} {...UNKNOWN_LANGUAGE_TEXT}>
        {message.text}
      </p>
      <div className={styles.badges}>
        <Badge tone="neutral" icon="check">
          {copy.messageState.recorded}
        </Badge>
        {status.read === "read" ? (
          <Badge tone="accent" icon="eye">
            {status.mine ? copy.messageState.read : "Lu (accusé de lecture envoyé)"}
          </Badge>
        ) : (
          <Badge tone="outline" icon="clock">
            {copy.messageState.unread}
          </Badge>
        )}
        {status.review === "reviewed" ? (
          <Badge tone="accent" icon="check-circle">
            {copy.messageState.reviewed}
          </Badge>
        ) : null}
        {status.review === "unreviewed" ? (
          <Badge tone="outline" icon="help-circle">
            Contexte clinique non revu
          </Badge>
        ) : null}
        {status.forwarded === "forwarded_out" && message.forwardedForReview ? (
          <Badge tone="muted" icon="send">
            Transféré par le patient pour revue <Timestamp iso={message.forwardedForReview.at} format="relative" /> — ce
            n’est pas une revue
          </Badge>
        ) : null}
      </div>
      {review ? (
        <p className={styles.reviewLine}>
          Revu {review.clinicianId === viewerId ? "par vous" : "par un autre médecin"} <Timestamp iso={review.at} format="relative" /> — motif :{" "}
          <span {...UNKNOWN_LANGUAGE_TEXT}>{review.reason}</span>
        </p>
      ) : null}
      {canReviewMessage(message, canManageCare) ? (
        <div>
          <Button size="sm" variant="secondary" iconStart="check-circle" onClick={() => onReview(message)}>
            Marquer le contexte comme revu
          </Button>
          {status.forwarded === "copy" ? (
            <p className={styles.reviewLine}>
              Revoir cette copie lève le signalement « contexte clinique non évalué » ; elle ne réautorise aucun protocole.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
