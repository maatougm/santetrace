"use client";

import { useEffect, useRef, useState } from "react";
import { Card, EmptyState, Notice, Skeleton } from "@/components/ui";
import { useActorSession } from "@/components/layout";
import type { CareMessage } from "@/lib/client/care-api";
import { describeApiError } from "@/lib/client/transport";
import { hasScope, type DoctorSectionProps } from "../PatientAccessScope";
import { ApiErrorState } from "../shared/ApiErrorState";
import { SyncStatus } from "../shared/SyncStatus";
import { ContactRequestsPanel } from "./ContactRequestsPanel";
import { MessageComposer } from "./MessageComposer";
import { MessageItem } from "./MessageItem";
import { ReviewMessageDialog } from "./ReviewMessageDialog";
import { useMessageThread } from "./use-message-thread";
import styles from "./Comms.module.css";

function ThreadBody({ messages, viewerId, canManageCare, onReview }: {
  messages: readonly CareMessage[];
  viewerId: string;
  canManageCare: boolean;
  onReview: (message: CareMessage) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    // Keep the newest message in view when one arrives.
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId]);

  if (messages.length === 0) {
    return <EmptyState compact icon="message" title="Aucun message" description="Aucun message échangé avec ce patient pour l’instant." />;
  }
  return (
    <div role="log" aria-label="Fil de messages avec le patient">
      <ol ref={listRef} className={styles.thread} tabIndex={0} aria-label="Messages, du plus ancien au plus récent">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} viewerId={viewerId} canManageCare={canManageCare} onReview={onReview} />
        ))}
      </ol>
    </div>
  );
}

/** Thread (this patient, signed-in clinician) with read receipts, explicit review and contact requests. */
export function MessageSection({ patientId, record, fence, refresh }: DoctorSectionProps) {
  const { actor } = useActorSession();
  const shared = hasScope(record, "messages");
  const thread = useMessageThread({ patientId, actorId: actor.id, fence, enabled: shared, onDenied: refresh });
  const [reviewing, setReviewing] = useState<CareMessage | null>(null);
  const canManageCare = record.access.canManageCare;

  if (!shared) {
    return (
      <Notice tone="neutral" icon="lock" title="Section non partagée par le patient">
        Le patient n’a pas partagé ses messages avec vous. Lui seul choisit les sections partagées.
      </Notice>
    );
  }

  const loading = !thread.data && !thread.error;
  let body;
  if (loading) {
    body = <Skeleton lines={4} />;
  } else if (!thread.data) {
    body = thread.denied ? (
      <Notice tone="neutral" icon="lock" title="Messages inaccessibles">
        {describeApiError(thread.error, "fr").message} Le fil n’est plus affiché.
      </Notice>
    ) : (
      <ApiErrorState error={thread.error} onRetry={() => void thread.refresh()} compact />
    );
  } else {
    body = (
      <>
        <ThreadBody messages={thread.data.messages} viewerId={actor.id} canManageCare={canManageCare} onReview={setReviewing} />
        {!thread.data.complete ? <p className={styles.mutedBlock}>Chargement des messages plus récents…</p> : null}
      </>
    );
  }

  return (
    <div className={styles.layout}>
      <Card
        title={`Messages avec ${record.patient.displayName}`}
        description="Fil entre ce patient et vous uniquement. Enregistré, lu et revu sont des états distincts ; aucun ne résout une alerte."
        actions={<SyncStatus lastSuccessAt={thread.lastSuccessAt} error={thread.error} isRefreshing={thread.isRefreshing} />}
      >
        <div className={styles.stack} aria-busy={loading || undefined}>
          {body}
          {thread.receiptError ? (
            <Notice tone="neutral" icon="cloud-off" title="Accusé de lecture non transmis">
              {describeApiError(thread.receiptError, "fr").message} Le message reste « pas encore lu » pour le patient.
            </Notice>
          ) : null}
          {!canManageCare ? (
            <p className={styles.mutedBlock}>
              Seul le médecin référent disposant de tous les accès peut marquer le contexte clinique d’un message comme revu.
            </p>
          ) : null}
          {!thread.denied ? (
            <MessageComposer patientId={patientId} actorId={actor.id} fence={fence} onSent={thread.applyMessage} />
          ) : null}
        </div>
      </Card>
      <ContactRequestsPanel patientId={patientId} actorId={actor.id} fence={fence} onDenied={refresh} />
      <ReviewMessageDialog
        message={reviewing}
        patientId={patientId}
        record={record}
        fence={fence}
        onClose={() => setReviewing(null)}
        onReviewed={thread.applyMessage}
        onReload={() => {
          refresh();
          void thread.refresh();
        }}
      />
    </div>
  );
}
