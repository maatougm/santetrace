"use client";

/**
 * /share/session — the external practitioner's short session. Guest data
 * lives only in this component's state: no storage, no analytics. Any refusal
 * (VISIT_UNAVAILABLE, 401/403/404/410, including a PDF read), the idle or
 * absolute deadline, or an explicit end replaces the whole state, unmounting
 * the selection, notes and open PDF. The record is read once, then only on a
 * user action (reload, opening a PDF, adding a note): a read counts as
 * activity on the server, so nothing reads on a timer. The times shown are
 * informational; the server decides when the session ends.
 */
import { useCallback, useReducer, useState } from "react";
import { Button, Card, Dialog, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from "@/components/ui";
import type { ExternalNote, GuestRecord } from "@/contracts/external-visit";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { formatTime } from "@/lib/client/format";
import { getMessages } from "@/lib/client/i18n";
import { endGuestSession } from "@/lib/client/share-api";
import { describeApiError, type ApiError, type Language } from "@/lib/client/transport";
import { ExternalNoteItem } from "./ExternalNoteItem";
import { useGuestLanguage } from "./GuestFrame";
import { GuestNoteForm } from "./GuestNoteForm";
import { GuestSelectionView } from "./GuestSelectionView";
import { INITIAL_SESSION, guestSessionReducer } from "./guest-state";
import { useGuestRecord, useLocalExpiry } from "./useGuestSession";
import styles from "./guest.module.css";

function TimerNotice({ record, lang, onReload }: { record: GuestRecord; lang: Language; onReload: () => void }) {
  const copy = SHARE_COPY[lang].guest;
  return (
    <Notice
      tone="neutral"
      icon="clock"
      action={
        <Button size="sm" variant="secondary" iconStart="refresh" onClick={onReload}>
          {getMessages(lang).common.refresh}
        </Button>
      }
    >
      <p className={styles.meta}>{copy.expiresAt(formatTime(record.visit.expiresAt, lang))}</p>
      <p className={styles.meta}>{copy.idleAt(formatTime(record.visit.idleExpiresAt, lang))}</p>
      <p className={styles.meta}>{copy.timerNote}</p>
    </Notice>
  );
}

function StaleNotice({ error, lang }: { error: ApiError; lang: Language }) {
  const description = describeApiError(error, lang);
  return (
    <Notice tone="neutral" icon="cloud-off" title={description.title}>
      {description.message}
    </Notice>
  );
}

function NotesList({ notes, lang }: { notes: ExternalNote[]; lang: Language }) {
  const copy = SHARE_COPY[lang].guest;
  if (notes.length === 0) return <p className={styles.meta}>{copy.notesEmpty}</p>;
  const ordered = [...notes].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  return (
    <div className={styles.stack}>
      {ordered.map((note) => (
        <ExternalNoteItem key={note.id} note={note} lang={lang} unverifiedLabel={copy.noteUnverified} />
      ))}
    </div>
  );
}

function EndSession({ lang, onEnded }: { lang: Language; onEnded: (confirmed: boolean) => void }) {
  const copy = SHARE_COPY[lang].guest;
  const common = getMessages(lang).common;
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState(false);

  const end = async () => {
    setEnding(true);
    // The view is cleared either way; a failed call is reported as "endedLocal".
    const confirmed = await endGuestSession().then(
      () => true,
      () => false,
    );
    setEnding(false);
    setOpen(false);
    onEnded(confirmed);
  };

  return (
    <div className={styles.endRow}>
      <Button variant="secondary" iconStart="log-out" onClick={() => setOpen(true)}>
        {copy.end}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.end}
        description={copy.oneUse}
        closeLabel={common.close}
        size="sm"
        footer={
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={ending}>
              {common.cancel}
            </Button>
            <Button variant="primary" iconStart="log-out" loading={ending} onClick={() => void end()}>
              {ending ? copy.ending : copy.end}
            </Button>
          </div>
        }
      />
    </div>
  );
}

export function GuestSessionView() {
  const { lang, copy } = useGuestLanguage();
  const [state, dispatch] = useReducer(guestSessionReducer, INITIAL_SESSION);
  const terminal = state.phase === "unavailable" || state.phase === "ended";
  const reload = useGuestRecord(dispatch, !terminal);
  const visit = state.phase === "active" ? state.record.visit : null;
  useLocalExpiry(visit?.expiresAt ?? null, visit?.idleExpiresAt ?? null, dispatch);

  // Genuine user activity re-reads the record, which also refreshes the idle deadline shown.
  const onAdded = useCallback(
    (note: ExternalNote) => {
      dispatch({ type: "note_added", note });
      reload();
    },
    [reload],
  );
  const onOpenDocument = useCallback(
    (documentId: string | null) => {
      dispatch({ type: "open_document", documentId });
      if (documentId) reload();
    },
    [reload],
  );
  const onSessionOver = useCallback(() => dispatch({ type: "session_over" }), []);
  const onSourceDenied = useCallback(() => dispatch({ type: "source_denied" }), []);
  const onEnded = useCallback((confirmed: boolean) => dispatch({ type: "ended", confirmed }), []);

  const meta = state.phase === "active" ? copy.sessionMeta(state.record.visit.declaredName) : undefined;
  const header = <PageHeader title={copy.sessionTitle} description={meta} />;

  if (state.phase === "unavailable") {
    return (
      <div className={styles.page}>
        {header}
        <EmptyState icon="lock" title={copy.unavailable} description={copy.unavailableBody} />
      </div>
    );
  }
  if (state.phase === "ended") {
    return (
      <div className={styles.page}>
        {header}
        <EmptyState icon="lock" title={state.confirmed ? copy.ended : copy.endedLocal} />
      </div>
    );
  }
  if (state.phase === "loading") {
    const description = state.error ? describeApiError(state.error, lang) : null;
    return (
      <div className={styles.page} aria-busy={description ? undefined : true}>
        {header}
        {description ? (
          <ErrorState title={description.title} message={description.message} code={description.code} onRetry={reload} retryLabel={getMessages(lang).common.retry} />
        ) : (
          <Skeleton lines={4} />
        )}
      </div>
    );
  }

  const { record, openDocumentId, stale } = state;
  return (
    <div className={styles.page}>
      {header}
      <TimerNotice record={record} lang={lang} onReload={reload} />
      {stale ? <StaleNotice error={stale} lang={lang} /> : null}
      <Card id="guest-selection" title={copy.selectionTitle} description={copy.frozenNote}>
        <GuestSelectionView
          selection={record.selection}
          lang={lang}
          openDocumentId={openDocumentId}
          onOpenDocument={onOpenDocument}
          onSourceDenied={onSourceDenied}
        />
      </Card>
      <Card id="guest-notes" title={copy.notesTitle}>
        <div className={styles.stack}>
          <NotesList notes={record.notes} lang={lang} />
          <GuestNoteForm record={record} lang={lang} onAdded={onAdded} onSessionOver={onSessionOver} />
        </div>
      </Card>
      <EndSession lang={lang} onEnded={onEnded} />
    </div>
  );
}
