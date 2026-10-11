"use client";

/**
 * Who read or tried to read the record (owner only). Metadata only: actor
 * category, declared name, action and resource codes, outcome and time; no
 * clinical content. Pages are appended with the server cursor; a failed
 * "Afficher plus" keeps the entries already shown.
 */
import { useCallback, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState } from "@/components/ui";
import type { AccessJournalEntry } from "@/contracts/patient-platform";
import { ACCESS_COPY } from "@/lib/client/copy/access";
import { getAccessJournal } from "@/lib/client/grants-api";
import { describeApiError, type ApiError, type Language } from "@/lib/client/transport";
import { When } from "../bits";
import { usePatientRuntime } from "../PatientRuntime";
import { LoadingBlock } from "../RecordGate";
import { ApiErrorNotice } from "../record/ApiErrorNotice";
import { fencedCall } from "../record/fenced-call";
import { useFencedRead } from "../record/use-fenced-read";
import { mergeJournal } from "./access-model";
import styles from "./access.module.css";

const PAGE_SIZE = 20;

function Entry({ entry, lang }: { entry: AccessJournalEntry; lang: Language }) {
  const copy = ACCESS_COPY[lang].doctors;
  const allowed = entry.outcome === "allowed";
  return (
    <li className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryActor}>
          {copy.actorCategory[entry.actorCategory]}
          {entry.actorCategory !== "patient" && entry.actorDisplayName ? (
            <>
              {" · "}
              <bdi>{entry.actorDisplayName}</bdi>
            </>
          ) : null}
        </span>
        <Badge tone={allowed ? "neutral" : "outline"} icon={allowed ? "check" : "lock"}>
          {copy.outcome[entry.outcome]}
        </Badge>
      </div>
      <span className={styles.code}>
        <bdi dir="ltr">
          {entry.action} · {entry.resourceType}
        </bdi>
      </span>
      <When iso={entry.at} lang={lang} />
    </li>
  );
}

interface AccessJournalProps {
  patientId: string;
  /** Bumped by the parent after an access change: the first page is read again. */
  reloadKey: number;
}

export function AccessJournal({ patientId, reloadKey }: AccessJournalProps) {
  const { lang, t, data } = usePatientRuntime();
  const copy = ACCESS_COPY[lang].doctors;
  const { fence } = data;
  const read = useCallback(
    (signal: AbortSignal) => getAccessJournal(patientId, { limit: PAGE_SIZE }, { signal }),
    // reloadKey makes a new reader, which re-runs the read while the current page stays shown.
    [patientId, reloadKey],
  );
  const journal = useFencedRead(fence, read);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<ApiError | null>(null);

  const loadMore = async () => {
    if (journal.state.status !== "ready" || moreBusy) return;
    const cursor = journal.state.value.nextCursor;
    if (!cursor) return;
    setMoreBusy(true);
    setMoreError(null);
    const result = await fencedCall(fence, () => getAccessJournal(patientId, { cursor, limit: PAGE_SIZE }));
    setMoreBusy(false);
    if (result.status === "stale") return;
    if (result.status === "error") {
      setMoreError(result.error);
      return;
    }
    journal.update((current) => ({ entries: mergeJournal(current.entries, result.value), nextCursor: result.value.nextCursor }));
  };

  const body = () => {
    const { state } = journal;
    if (state.status === "loading") return <LoadingBlock label={t.common.loading} lines={2} />;
    if (state.status === "error") {
      return <ErrorState compact {...describeApiError(state.error, lang)} onRetry={journal.retry} retryLabel={t.common.retry} />;
    }
    if (state.value.entries.length === 0) return <EmptyState compact icon="eye" title={copy.journalEmpty} />;
    return (
      <div className={styles.stack}>
        <ul className={styles.journalList}>
          {state.value.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} lang={lang} />
          ))}
        </ul>
        {moreError ? <ApiErrorNotice error={moreError} lang={lang} /> : null}
        {state.value.nextCursor ? (
          <div>
            <Button variant="secondary" iconStart="chevron-down" loading={moreBusy} onClick={() => void loadMore()}>
              {copy.journalMore}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Card id="access-journal" title={copy.journalTitle} description={copy.journalDescription}>
      {body()}
    </Card>
  );
}
