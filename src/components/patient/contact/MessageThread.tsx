"use client";

/**
 * Conversation with one clinician. Own messages show only what the server
 * says: recorded (unread), read (readAt) or reviewed. Incoming messages are
 * marked read while displayed and the tab is visible; that is a read receipt
 * only, never completion of an action or resolution of an alert. In a
 * secondary doctor's thread, the patient may explicitly forward one of their
 * own clinical messages to the primary referent (ForwardControl).
 */
import { useEffect, useRef } from "react";
import { Badge, ErrorState, Notice } from "@/components/ui";
import type { CareMessage } from "@/contracts/monitoring";
import type { CareGrant } from "@/contracts/patient-platform";
import type { AccessFence } from "@/lib/client/access-fence";
import { runFenced } from "@/lib/client/access-fence";
import { markMessageRead } from "@/lib/client/care-api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { createClientId } from "@/lib/client/ids";
import { formatDateTime } from "@/lib/client/format";
import { describeApiError, toApiError, type Language } from "@/lib/client/transport";
import { When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { LoadingBlock } from "../RecordGate";
import { ForwardControl } from "./ForwardControl";
import { forwardOption, isIncoming, messagesToMarkRead, ownMessageState, type ForwardOption } from "./contact-view";
import type { ThreadState } from "./useMessageThread";
import patientStyles from "../patient.module.css";
import styles from "./contact.module.css";

function useReadReceipts(messages: readonly CareMessage[], fence: AccessFence, onUpdated: (message: CareMessage) => void) {
  const requestedRef = useRef<ReadonlySet<string>>(new Set());
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;

  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const ids = messagesToMarkRead(messages, requestedRef.current);
    if (ids.length === 0) return;
    requestedRef.current = new Set([...requestedRef.current, ...ids]);
    for (const id of ids) {
      runFenced(fence, () => markMessageRead(id, { clientId: createClientId("read") }))
        .then((result) => {
          if (result.status === "current") onUpdatedRef.current(result.value.message);
        })
        .catch((caught: unknown) => {
          // Receipt only: the message stays unread on the server and is shown as such.
          // A transient failure is retried with the next thread update; a refusal is not.
          const error = toApiError(caught);
          if (error.isAccessDenied || error.isConflict) return;
          requestedRef.current = new Set([...requestedRef.current].filter((requested) => requested !== id));
        });
    }
  }, [messages, fence]);
}

function OwnStates({ message, lang }: { message: CareMessage; lang: Language }) {
  const copy = CARE_COPY[lang].messageState;
  const state = ownMessageState(message);
  return (
    <div className={styles.states}>
      {state === "recorded" ? (
        <>
          <Badge tone="outline" icon="check">
            {copy.recorded}
          </Badge>
          <Badge tone="outline" icon="clock">
            {copy.unread}
          </Badge>
        </>
      ) : null}
      {state === "read" ? (
        <Badge tone="neutral" icon="eye">
          {copy.read}
        </Badge>
      ) : null}
      {state === "reviewed" ? (
        <Badge tone="accent" icon="check-circle">
          {copy.reviewed}
        </Badge>
      ) : null}
    </div>
  );
}

interface MessageItemProps {
  message: CareMessage;
  forward: ForwardOption;
  lang: Language;
  onForwarded: () => void;
}

function MessageItem({ message, forward, lang, onForwarded }: MessageItemProps) {
  const copy = CARE_COPY[lang];
  const incoming = isIncoming(message);
  const author =
    message.authorCategory === "patient"
      ? copy.contact.fromYou
      : message.authorCategory === "clinician"
        ? copy.contact.fromDoctor
        : copy.contact.fromSystem;
  return (
    <li className={`${styles.message} ${incoming ? styles.incoming : styles.own}`}>
      <div className={styles.messageHead}>
        <span className={styles.author}>{author}</span>
        <span>{copy.messageKind[message.kind]}</span>
        <When iso={message.createdAt} lang={lang} />
      </div>
      {message.forwardedFromMessageId ? (
        <div className={styles.states}>
          <Badge tone="muted" icon="send">
            {copy.contact.forwardedCopy}
          </Badge>
        </div>
      ) : null}
      <p className={styles.text} dir="auto">
        {message.text}
      </p>
      {incoming ? (
        message.readAt ? (
          <div className={styles.states}>
            <Badge tone="muted" icon="eye">
              {copy.contact.markedRead}
            </Badge>
          </div>
        ) : null
      ) : (
        <OwnStates message={message} lang={lang} />
      )}
      <ForwardControl message={message} option={forward} lang={lang} onForwarded={onForwarded} />
    </li>
  );
}

interface MessageThreadViewProps {
  thread: ThreadState;
  /** Doctor of this thread and the patient's grants: decide whether forwarding is offered. */
  clinicianId: string;
  grants: readonly CareGrant[];
  lang: Language;
}

export function MessageThreadView({ thread, clinicianId, grants, lang }: MessageThreadViewProps) {
  const { data, t } = usePatientRuntime();
  const messages = thread.data?.messages ?? [];
  const { mutate, refresh } = thread;
  useReadReceipts(messages, data.fence, (message) =>
    mutate((current) => (current ? { ...current, messages: current.messages.map((m) => (m.id === message.id ? message : m)) } : current)),
  );

  if (!thread.data) {
    if (thread.error && !thread.isRefreshing) {
      const description = describeApiError(thread.error, lang);
      return (
        <ErrorState
          compact
          title={description.title}
          message={description.message}
          code={description.code}
          onRetry={thread.restart}
          retryLabel={t.common.retry}
        />
      );
    }
    return <LoadingBlock label={t.common.loading} lines={2} />;
  }
  // A failing poll keeps the last thread on screen, dated, never as live.
  const staleNote =
    thread.error && thread.lastSuccessAt !== null ? (
      <p className={patientStyles.metaLine}>{t.connection.staleSince(formatDateTime(new Date(thread.lastSuccessAt).toISOString(), lang))}</p>
    ) : null;
  if (messages.length === 0) {
    return (
      <>
        {staleNote}
        <p className={patientStyles.emptyLine}>{CARE_COPY[lang].contact.empty}</p>
      </>
    );
  }
  const forwards = new Map(messages.map((message) => [message.id, forwardOption(message, clinicianId, grants)]));
  // Said once for the thread, not under every message.
  const noPrimary = [...forwards.values()].some((option) => option.kind === "no_primary");
  return (
    <>
      {staleNote}
      {thread.data.truncated ? (
        <Notice tone="neutral" icon="info">
          {CARE_COPY[lang].contact.truncated}
        </Notice>
      ) : null}
      {noPrimary ? (
        <Notice tone="neutral" icon="info">
          {CARE_COPY[lang].contact.forwardNoPrimary}
        </Notice>
      ) : null}
      <ol className={styles.thread}>
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            forward={forwards.get(message.id) ?? { kind: "none" }}
            lang={lang}
            onForwarded={() => void refresh()}
          />
        ))}
      </ol>
    </>
  );
}
