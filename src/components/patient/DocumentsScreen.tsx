"use client";

/**
 * EndoRecord patient side: PDF upload (type, size and %PDF header checked on
 * the device; the 20-page limit is enforced by the server), list of the
 * patient's documents with server status, and clinician-confirmed results only.
 * Proposed (unreviewed) values are counted, never displayed as results.
 * A 501 ENDORECORD_PENDING answer is shown as "en cours d'intégration".
 * The upload runs under the access fence captured when it starts: an answer
 * that returns after an account switch, revocation or authority change is
 * never applied, and a neutral note says so.
 */
import { useRef, useState, type ChangeEvent } from "react";
import { Badge, Button, Card, EmptyState, Icon, Notice, PageHeader, type BadgeTone, type IconName } from "@/components/ui";
import {
  DOCUMENT_LIMITS,
  describeApiError,
  uploadDocument,
  type CareDocument,
  type Language,
  type PatientRecord,
  type UploadDocumentResponse,
} from "@/lib/client/api";
import { formatNumber } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import { Ltr, NumberWithUnit, SectionTitle, When } from "./bits";
import { usePatientRuntime } from "./PatientRuntime";
import { RecordGate } from "./RecordGate";
import { captureAction, runAction } from "./record/fenced-call";
import doc from "./documents.module.css";
import styles from "./patient.module.css";

type UploadState =
  | { name: "idle" }
  | { name: "uploading" }
  | { name: "received"; response: UploadDocumentResponse }
  | { name: "pending" }
  /** The answer came back after access changed: not shown. */
  | { name: "discarded" }
  | { name: "error"; title: string; message: string; code: string };

const STATUS_STYLE: Record<CareDocument["status"], { tone: BadgeTone; icon: IconName }> = {
  processing: { tone: "outline", icon: "clock" },
  review: { tone: "outline", icon: "eye" },
  needs_manual_review: { tone: "outline", icon: "help-circle" },
  reviewed: { tone: "accent", icon: "check" },
  failed: { tone: "muted", icon: "x-circle" },
};

/** Local echo of a received upload until the next poll. */
const withUpload =
  (response: UploadDocumentResponse) =>
  (record: PatientRecord): PatientRecord => ({
    ...record,
    documents: [...record.documents.filter((d) => d.id !== response.document.id), response.document],
    candidates: [...record.candidates.filter((c) => !response.candidates.some((n) => n.id === c.id)), ...response.candidates],
  });

function formatMebibytes(bytes: number, lang: Language): string {
  return `${formatNumber(bytes / (1024 * 1024), lang, 1)} Mio`;
}

async function checkFile(file: File, t: Messages, lang: Language): Promise<string | null> {
  if (file.size === 0) return t.documents.errors.empty;
  if (file.size > DOCUMENT_LIMITS.maxBytes) return t.documents.errors.tooLarge(formatMebibytes(file.size, lang));
  const declaredPdf = file.type === DOCUMENT_LIMITS.mimeType || file.name.toLowerCase().endsWith(".pdf");
  if (!declaredPdf) return t.documents.errors.notPdf;
  try {
    const header = await file.slice(0, 5).text();
    return header === "%PDF-" ? null : t.documents.errors.notPdf;
  } catch {
    return t.documents.errors.notPdf;
  }
}

function UploadCard() {
  const { t, lang, scope, data, online } = usePatientRuntime();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, setState] = useState<UploadState>({ name: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    setState({ name: "idle" });
    setFile(null);
    setFileError(null);
    if (!picked) return;
    const problem = await checkFile(picked, t, lang);
    if (problem) setFileError(problem);
    else setFile(picked);
  };

  const upload = async () => {
    if (!scope) return;
    if (!file) {
      setFileError(t.documents.errors.required);
      return;
    }
    // Captured once: the answer is applied only to this actor+patient, through its fence-bound mutate.
    const action = captureAction(data);
    const patientId = scope.patientId;
    const picked = file;
    setState({ name: "uploading" });
    const result = await runAction(action, () => uploadDocument(patientId, picked), withUpload);
    if (result.status === "stale") {
      // Access changed while uploading: nothing from the answer is shown; the record is read again.
      if (!action.fence.denied()) void action.refresh();
      setState({ name: "discarded" });
      return;
    }
    if (result.status === "error") {
      const { error } = result;
      if (error.code === "ENDORECORD_PENDING" || error.isUnavailable) {
        setState({ name: "pending" });
        return;
      }
      setState({ name: "error", ...describeApiError(error, lang) });
      return;
    }
    setState({ name: "received", response: result.value });
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const uploading = state.name === "uploading";

  return (
    <Card title={t.documents.fileLabel} description={t.documents.limits}>
      <div className={styles.stack}>
        <div className={doc.pickerWrap}>
          <input
            ref={inputRef}
            id="doc-file"
            type="file"
            accept="application/pdf,.pdf"
            className={doc.fileInput}
            onChange={(event) => void onPick(event)}
            disabled={uploading}
            aria-describedby={fileError ? "doc-file-error" : undefined}
          />
          <label className={`${doc.picker} ${file ? doc.pickerReady : ""}`} htmlFor="doc-file">
            <Icon name={file ? "file-text" : "upload"} size={24} />
            <span className={doc.pickerText}>
              <span className={doc.pickerTitle}>{file ? <bdi>{file.name}</bdi> : t.documents.choose}</span>
              {file ? <span className={styles.metaLine}>{formatMebibytes(file.size, lang)}</span> : null}
            </span>
          </label>
        </div>
        {fileError ? (
          <p className={styles.slipError} id="doc-file-error" role="alert">
            {fileError}
          </p>
        ) : null}
        {!online ? (
          <Notice tone="neutral" icon="wifi-off">
            {t.documents.needsConnection}
          </Notice>
        ) : null}
        <Button variant="primary" size="lg" fullWidth iconStart="upload" loading={uploading} onClick={() => void upload()} disabled={!file}>
          {t.documents.send}
        </Button>
        {uploading ? (
          <p className={styles.metaLine} role="status">
            {t.documents.sending}
          </p>
        ) : null}
        {state.name === "pending" ? (
          <Notice tone="info" icon="clock" title={t.documents.pendingTitle} role="status">
            {t.documents.pendingBody}
          </Notice>
        ) : null}
        {state.name === "received" ? (
          <Notice tone="info" icon="check-circle" title={t.documents.receivedTitle} role="status">
            <p className={styles.noticeLine}>
              <bdi>{state.response.document.filename}</bdi> · {t.documents.status[state.response.document.status]}
            </p>
            {state.response.candidates.length > 0 ? (
              <p className={styles.noticeLine}>{t.documents.proposed(state.response.candidates.length)}</p>
            ) : null}
            <p className={styles.noticeLine}>{t.documents.receivedBody}</p>
          </Notice>
        ) : null}
        {state.name === "discarded" ? (
          <Notice tone="neutral" icon="refresh" role="status">
            {t.documents.discarded}
          </Notice>
        ) : null}
        {state.name === "error" ? (
          <Notice tone="neutral" icon="alert-triangle" title={state.title} role="alert">
            {state.message} <Ltr>({state.code})</Ltr>
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}

function DocumentList({ record, lang, t }: { record: PatientRecord; lang: Language; t: Messages }) {
  const documents = [...record.documents].sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
  const proposedCount = (documentId: string) =>
    record.candidates.filter((c) => c.documentId === documentId && c.status === "proposed").length;

  return (
    <section className={styles.stack} aria-labelledby="doc-list">
      <SectionTitle id="doc-list">{t.documents.listTitle}</SectionTitle>
      {documents.length === 0 ? (
        <EmptyState icon="file-text" title={t.documents.listEmpty} compact />
      ) : (
        <ul className={doc.list}>
          {documents.map((document) => {
            const style = STATUS_STYLE[document.status];
            const proposed = proposedCount(document.id);
            return (
              <li key={document.id} className={doc.item}>
                <Icon name="file-text" size={20} />
                <div className={doc.itemText}>
                  <p className={doc.itemName}>
                    <bdi>{document.filename}</bdi>
                  </p>
                  <When iso={document.uploadedAt} lang={lang} label={t.documents.uploadedAt} />
                  {proposed > 0 ? <p className={styles.metaLine}>{t.documents.proposed(proposed)}</p> : null}
                  {document.error ? <p className={styles.slipError}>{document.error}</p> : null}
                </div>
                <Badge tone={style.tone} icon={style.icon}>
                  {t.documents.status[document.status]}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConfirmedResults({ record, lang, t }: { record: PatientRecord; lang: Language; t: Messages }) {
  const observations = [...record.observations].sort((a, b) => Date.parse(b.examDate) - Date.parse(a.examDate));
  return (
    <section className={styles.stack} aria-labelledby="doc-results">
      <SectionTitle id="doc-results">{t.documents.resultsTitle}</SectionTitle>
      {observations.length === 0 ? (
        <p className={styles.emptyLine}>{t.documents.resultsEmpty}</p>
      ) : (
        <ul className={doc.list}>
          {observations.map((observation) => (
            <li key={observation.id} className={doc.item}>
              <Icon name="check-circle" size={20} />
              <div className={doc.itemText}>
                <p className={doc.itemName}>
                  <bdi>{observation.exam}</bdi>
                </p>
                <When iso={observation.examDate} lang={lang} format="date" label={t.documents.examDate} />
              </div>
              <span className={doc.value}>
                <NumberWithUnit value={observation.value} unit={observation.unit} lang={lang} digits={2} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DocumentsScreen() {
  const { t, lang, data } = usePatientRuntime();
  return (
    <div className={styles.page}>
      <PageHeader title={t.documents.title} description={t.documents.intro} />
      {/* Keyed by actor+patient: a switch drops the picked file and any upload outcome. */}
      <UploadCard key={data.fence.key ?? "no-patient"} />
      <RecordGate>
        {(record) => (
          <>
            <DocumentList record={record} lang={lang} t={t} />
            <ConfirmedResults record={record} lang={lang} t={t} />
          </>
        )}
      </RecordGate>
    </div>
  );
}
