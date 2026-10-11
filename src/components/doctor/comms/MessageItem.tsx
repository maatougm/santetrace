"use client";

import { Badge, Button, Timestamp } from "@/components/ui";
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
    <li className={status.mine ? `${styles.message} ${styles.mine}` : styles.message}>
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
      <p className={styles.messageText}>{message.text}</p>
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
          {review.reason}
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
