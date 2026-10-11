"use client";

/**
 * Builds an explicit selection from the current record, states every limit
 * of the share before issuing (whole PDF, frozen selection, one activation,
 * no identity proof, no recall), then reveals the one-time link once.
 */
import { useId, useMemo, useRef, useState } from "react";
import { Button, Card, Checkbox, EmptyState, Notice } from "@/components/ui";
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import type { PatientRecord } from "@/lib/client/api";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { createClientId } from "@/lib/client/ids";
import { createExternalVisit } from "@/lib/client/share-api";
import { toApiError, type ApiError, type Language } from "@/lib/client/transport";
import { Ltr } from "../bits";
import { ApiErrorNotice } from "./ApiErrorNotice";
import { shareEntryText } from "./share-entry-text";
import {
  buildShareGroups,
  countSelected,
  issueClientId,
  selectAll,
  selectionHasDocument,
  selectionRefs,
  toggleSelection,
  type IssueAttempt,
  type ShareGroup,
} from "./share-selection";
import { ShareLinkReveal } from "./ShareLinkReveal";
import { invalidatesList } from "./use-fenced-resource";
import styles from "../patient.module.css";
import share from "./share.module.css";

function SelectionGroups({ groups, selected, lang, onToggle }: { groups: ShareGroup[]; selected: ReadonlySet<string>; lang: Language; onToggle: (key: string, on: boolean) => void }) {
  const copy = SHARE_COPY[lang].share;
  return (
    <>
      {groups
        .filter((group) => group.entries.length > 0)
        .map((group) => (
          <fieldset key={group.kind} className={share.group}>
            <legend className={share.legend}>
              {copy.kind[group.kind]} <Ltr>({group.entries.length})</Ltr>
            </legend>
            {group.entries.map((entry) => {
              const text = shareEntryText(entry, lang);
              return (
                <Checkbox
                  key={entry.key}
                  label={text.label}
                  description={text.description}
                  checked={selected.has(entry.key)}
                  onChange={(event) => onToggle(entry.key, event.target.checked)}
                />
              );
            })}
          </fieldset>
        ))}
    </>
  );
}

function Disclosures({ lang, hasDocument }: { lang: Language; hasDocument: boolean }) {
  const copy = SHARE_COPY[lang].share;
  return (
    <ul className={share.disclosures}>
      <li className={hasDocument ? share.disclosureStrong : undefined}>{copy.wholePdf}</li>
      <li>{copy.frozen}</li>
      <li>{copy.limits}</li>
      <li>{copy.identity}</li>
      <li>{copy.noRecall}</li>
    </ul>
  );
}

interface ShareComposerProps {
  record: PatientRecord;
  fence: AccessFence;
  /** Online: issuing needs the server. */
  live: boolean;
  onIssued: () => void;
  /** 409 or access refused: the issued-links list reloads so it cannot outlive the refusal. */
  onRefused: () => void;
  lang: Language;
}

export function ShareComposer({ record, fence, live, onIssued, onRefused, lang }: ShareComposerProps) {
  const copy = SHARE_COPY[lang].share;
  const errorId = `${useId()}-required`;
  const groupsRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => buildShareGroups(record), [record]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [attempt, setAttempt] = useState<IssueAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [required, setRequired] = useState(false);
  const [reveal, setReveal] = useState<{ url: string | null } | null>(null);

  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const count = countSelected(groups, selected);
  const patientId = record.patient.id;

  const toggle = (key: string, on: boolean) => {
    setSelected((current) => toggleSelection(current, key, on));
    setRequired(false);
  };

  const issue = async () => {
    if (busy) return;
    const refs = selectionRefs(groups, selected);
    if (refs.length === 0) {
      setRequired(true);
      groupsRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
      return;
    }
    if (!live) return;
    const current = issueClientId(attempt, refs, () => createClientId("share"));
    setAttempt(current);
    setBusy(true);
    setFailure(null);
    setReveal(null);
    try {
      const result = await runFenced(fence, () => createExternalVisit(patientId, { selection: refs, clientId: current.clientId }));
      if (result.status === "current") {
        setAttempt({ ...current, settled: true });
        setReveal({ url: result.value.url });
        setSelected(new Set());
        onIssued();
      }
    } catch (caught) {
      const error = toApiError(caught);
      setFailure(error);
      if (invalidatesList(error)) onRefused();
    } finally {
      setBusy(false);
    }
  };

  if (total === 0) {
    return (
      <Card id="share-select" title={copy.selectTitle}>
        <EmptyState compact icon="inbox" title={copy.selectEmpty} />
      </Card>
    );
  }

  return (
    <>
      <Card
        id="share-select"
        title={copy.selectTitle}
        actions={
          <div className={styles.inlineActions}>
            <Button variant="ghost" onClick={() => setSelected(selectAll(groups))}>
              {copy.selectAll}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              {copy.selectNone}
            </Button>
          </div>
        }
      >
        <div className={styles.stack} ref={groupsRef}>
          <SelectionGroups groups={groups} selected={selected} lang={lang} onToggle={toggle} />
          <p className={share.count} role="status">
            {copy.selectedCount(count)}
          </p>
          <Disclosures lang={lang} hasDocument={selectionHasDocument(groups, selected)} />
          {required ? (
            <p id={errorId} className={styles.slipError} role="alert">
              {copy.selectionRequired}
            </p>
          ) : null}
          {failure ? <ApiErrorNotice error={failure} lang={lang} /> : null}
          {!live ? (
            <Notice tone="neutral" icon="cloud-off">
              {copy.offline}
            </Notice>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            iconStart="link"
            loading={busy}
            disabled={!live}
            aria-describedby={required ? errorId : undefined}
            onClick={() => void issue()}
          >
            {busy ? copy.creating : copy.create}
          </Button>
        </div>
      </Card>
      {reveal ? <ShareLinkReveal url={reveal.url} lang={lang} onHide={() => setReveal(null)} /> : null}
    </>
  );
}
