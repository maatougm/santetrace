"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  LinkButton,
  Notice,
  Timestamp,
  describedBy,
  type BadgeTone,
  type IconName,
  type TableColumn,
} from "@/components/ui";
import {
  DOCUMENT_LIMITS,
  toApiError,
  uploadDocument,
  type Candidate,
  type CareDocument,
  type Observation,
} from "@/lib/client/api";
import { DISCARDED_OUTCOME } from "../care/outcome";
import { applyWhenCurrent, documentPermissions, type DocumentPermissions } from "../care/section-access";
import { useEpochScoped } from "../care/use-fenced";
import { usePatientAccess } from "../PatientAccessScope";
import { reviewHref } from "../shared/routes";
import { errorText } from "../shared/ApiErrorState";
import { DOCUMENT_STATUS_LABEL } from "../shared/labels";
import { documentLabCounts, readability, type ReadAccess, type VisibleCount } from "./read-visibility";
import styles from "./Record.module.css";

const NO_PERMISSIONS: DocumentPermissions = { canRead: false, canUpload: false, canReviewLabs: false };

const FILE_ID = "document-upload";
const STATUS_TONE: Record<CareDocument["status"], { tone: BadgeTone; icon: IconName }> = {
  processing: { tone: "muted", icon: "clock" },
  review: { tone: "accent", icon: "eye" },
  needs_manual_review: { tone: "outline", icon: "eye" },
  reviewed: { tone: "muted", icon: "check" },
  failed: { tone: "outline", icon: "x-circle" },
};

/** Nothing readable while no record is in scope. */
const NO_READ_ACCESS: ReadAccess = { owner: false, scopes: [] };
const NOT_SHARED = "Non partagé";

interface DocumentRow {
  document: CareDocument;
  /** null = structured values not shared with this account (unknown, never 0). */
  pending: VisibleCount;
  confirmed: VisibleCount;
}

function CountCell({ count }: { count: VisibleCount }) {
  return count === null ? <span className={styles.muted}>{NOT_SHARED}</span> : <>{count}</>;
}

interface DocumentsSectionProps {
  patientId: string;
  documents: readonly CareDocument[];
  candidates: readonly Candidate[];
  observations: readonly Observation[];
  onUploaded: (document: CareDocument, candidates: Candidate[]) => void;
}

function validateFile(file: File | null): string | null {
  if (!file) return "Choisissez un fichier PDF.";
  const isPdf = file.type === DOCUMENT_LIMITS.mimeType || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "Seuls les fichiers PDF sont acceptés.";
  if (file.size === 0) return "Le fichier est vide.";
  if (file.size > DOCUMENT_LIMITS.maxBytes) return "Le fichier dépasse 5 Mio.";
  return null;
}

function uploadFailure(error: unknown): string {
  const apiError = toApiError(error);
  if (apiError.isUnavailable) {
    return "Extraction en cours d’intégration côté serveur : le dépôt de documents n’est pas encore disponible. Rien n’a été enregistré.";
  }
  return errorText(error);
}

/**
 * EndoRecord: upload a synthetic analysis PDF (care manager only), then review
 * proposals beside the source. The upload result passes the record's access
 * fence: one returning after a revocation or patient switch is discarded.
 */
export function DocumentsSection({ patientId, documents, candidates, observations, onUploaded }: DocumentsSectionProps) {
  const { fence, record } = usePatientAccess();
  const permissions = record ? documentPermissions(record.access) : NO_PERMISSIONS;
  // Read visibility from the current envelope: a PDF can be shared while its extracted values are not.
  const readAccess = record?.access ?? NO_READ_ACCESS;
  const labsShared = readability(readAccess).labs;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploaded, setUploaded] = useEpochScoped<{ document: CareDocument; count: number }>(fence);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateFile(file);
    setFileError(problem);
    if (problem || !file) {
      inputRef.current?.focus();
      return;
    }
    setUploading(true);
    setFailure(null);
    setUploaded(null);
    try {
      // `onUploaded` is the record apply bound to this clinician+patient fence.
      const result = await applyWhenCurrent(fence, () => uploadDocument(patientId, file), (value) => onUploaded(value.document, value.candidates));
      if (result.status === "discarded") {
        setFailure(DISCARDED_OUTCOME.text);
        return;
      }
      setUploaded({ document: result.value.document, count: result.value.candidates.length });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setFailure(uploadFailure(error));
    } finally {
      setUploading(false);
    }
  };

  const rows: DocumentRow[] = [...documents]
    .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt))
    .map((document) => {
      const { pending, confirmed } = documentLabCounts({ access: readAccess, candidates, observations }, document.id);
      return { document, pending, confirmed };
    });

  const columns: TableColumn<DocumentRow>[] = [
    {
      key: "file",
      header: "Document",
      render: ({ document }) => (
        <span className={styles.cellStack}>
          <span className={styles.strongText}>{document.filename}</span>
          <Timestamp iso={document.uploadedAt} label="Déposé le" />
        </span>
      ),
    },
    {
      key: "status",
      header: "État",
      render: ({ document }) => (
        <span className={styles.cellStack}>
          <Badge tone={STATUS_TONE[document.status].tone} icon={STATUS_TONE[document.status].icon}>
            {DOCUMENT_STATUS_LABEL[document.status]}
          </Badge>
          {document.error ? <span className={styles.muted}>{document.error}</span> : null}
        </span>
      ),
    },
    { key: "pending", header: "À revoir", numeric: true, render: ({ pending }) => <CountCell count={pending} /> },
    { key: "confirmed", header: "Confirmés", numeric: true, render: ({ confirmed }) => <CountCell count={confirmed} /> },
    {
      key: "open",
      header: <span className={styles.srOnly}>Action</span>,
      align: "end",
      render: ({ document, pending }) => {
        // An unknown (not shared) count never turns into "Revoir"; the PDF itself stays openable.
        const toReview = pending !== null && pending > 0 && permissions.canReviewLabs;
        return (
          <LinkButton href={reviewHref(patientId, document.id)} size="sm" variant={toReview ? "primary" : "secondary"} iconEnd="arrow-right">
            {toReview ? "Revoir" : "Ouvrir"}
          </LinkButton>
        );
      },
    },
  ];

  const hint = "PDF texte synthétique, 5 Mio et 20 pages au maximum. Les scans demandent une revue manuelle (pas d’OCR).";

  return (
    <div className={styles.sectionStack}>
      {!permissions.canUpload ? (
        <Notice tone="neutral" icon="lock" title="Consultation seule">
          Le dépôt de documents et la revue des analyses sont réservés au médecin référent.{" "}
          {labsShared
            ? "Vous pouvez consulter les documents partagés et leurs valeurs."
            : "Vous pouvez consulter les documents partagés ; leurs valeurs extraites ne sont pas partagées avec ce compte."}
        </Notice>
      ) : null}
      {permissions.canUpload ? (
        <Card title="Déposer une analyse (EndoRecord)" description="Aucune valeur n’entre dans le dossier sans confirmation clinicien à partir de la source.">
          <form className={styles.uploadForm} onSubmit={(event) => void submit(event)} noValidate>
            <Field label="Fichier PDF" htmlFor={FILE_ID} hint={hint} error={fileError} required>
              <input
                ref={inputRef}
                id={FILE_ID}
                type="file"
                accept="application/pdf,.pdf"
                className={styles.fileInput}
                aria-invalid={Boolean(fileError) || undefined}
                aria-describedby={describedBy(FILE_ID, { hint, error: fileError })}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setFileError(null);
                }}
              />
            </Field>
            <div className={styles.formSubmit}>
              <Button type="submit" variant="primary" iconStart="upload" loading={uploading}>
                Déposer et extraire
              </Button>
            </div>
          </form>
          {failure ? (
            <Notice tone="neutral" icon="x-circle" role="alert" title="Document non déposé">
              {failure}
            </Notice>
          ) : null}
          {uploaded ? (
            <Notice
              tone="success"
              title={`Document déposé : ${uploaded.document.filename}`}
              action={
                <LinkButton href={reviewHref(patientId, uploaded.document.id)} size="sm" iconEnd="arrow-right">
                  Ouvrir la revue
                </LinkButton>
              }
            >
              {uploaded.count > 0
                ? `${uploaded.count} valeur${uploaded.count > 1 ? "s" : ""} proposée${uploaded.count > 1 ? "s" : ""}, à confirmer ou rejeter à partir de la source.`
                : `${DOCUMENT_STATUS_LABEL[uploaded.document.status]}. ${uploaded.document.error ?? ""}`}
            </Notice>
          ) : null}
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState compact icon="file-text" title="Aucun document" description="Aucune analyse n’a été déposée pour ce patient." />
      ) : (
        <div className={styles.flushCard}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.document.id}
            caption={
              labsShared
                ? "Documents sources. « À revoir » = valeurs proposées non confirmées, exclues des courbes."
                : "Documents sources. Valeurs extraites non partagées avec ce compte : « À revoir » et « Confirmés » restent inconnus."
            }
            scrollLabel="Tableau des documents"
          />
        </div>
      )}
    </div>
  );
}
