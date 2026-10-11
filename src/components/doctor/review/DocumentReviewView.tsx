"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, Skeleton, Timestamp } from "@/components/ui";
import type { Candidate } from "@/lib/client/api";
import { withObservation, withReview } from "../record/record-updates";
import { ApiErrorState } from "../shared/ApiErrorState";
import { DOCUMENT_STATUS_LABEL } from "../shared/labels";
import { patientHref } from "../shared/routes";
import { StaleNotice, SyncStatus } from "../shared/SyncStatus";
import { LAB_REVIEW_RESERVED, documentPermissions } from "../care/section-access";
import { usePatientAccess } from "../PatientAccessScope";
import { CandidateCard } from "./CandidateCard";
import { SourceViewer } from "./SourceViewer";
import styles from "./Review.module.css";

interface DocumentReviewViewProps {
  patientId: string;
  documentId: string;
}

const CANDIDATE_HASH = "#candidate-";

/** Candidate id from a #candidate-<id> fragment; null when absent or malformed. */
function candidateIdFromHash(hash: string): string | null {
  if (!hash.startsWith(CANDIDATE_HASH)) return null;
  try {
    return decodeURIComponent(hash.slice(CANDIDATE_HASH.length));
  } catch {
    return null;
  }
}

/** Source-linked review: PDF on one side, proposed values on the other. */
export function DocumentReviewView({ patientId, documentId }: DocumentReviewViewProps) {
  // Shared fenced poll (doctor/patients/[id]/layout): a revocation clears the
  // record here too, which unmounts the PDF viewer.
  const { record: data, error, status, isRefreshing, lastSuccessAt, refresh, apply, fence } = usePatientAccess();
  const [page, setPage] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const focusedFromHash = useRef(false);

  const documentsHref = patientHref(patientId, "documents");
  const document = data?.documents.find((d) => d.id === documentId) ?? null;
  const candidates = (data?.candidates ?? [])
    .filter((c) => c.documentId === documentId)
    .sort((a, b) => a.page - b.page);

  const showCandidate = useCallback((candidate: Candidate) => {
    setSelectedId(candidate.id);
    setPage(candidate.page);
  }, []);

  // Deep link from a chart point: #candidate-<id> selects it and opens its page once.
  useEffect(() => {
    if (focusedFromHash.current || candidates.length === 0) return;
    focusedFromHash.current = true;
    const id = candidateIdFromHash(window.location.hash);
    if (!id) return;
    const target = candidates.find((c) => c.id === id);
    if (!target) return;
    showCandidate(target);
    requestAnimationFrame(() => window.document.getElementById(`candidate-${id}`)?.scrollIntoView({ block: "start" }));
  }, [candidates, showCandidate]);

  const back = { href: documentsHref, label: "Documents du patient" };
  const syncStatus = <SyncStatus lastSuccessAt={lastSuccessAt} error={error} isRefreshing={isRefreshing} />;

  if (status === "loading") {
    return (
      <div className={styles.page} aria-busy="true">
        <PageHeader eyebrow="Revue EndoRecord" title="Chargement du document…" back={back} actions={syncStatus} />
        <div className={styles.layout}>
          <Skeleton height={560} radius={12} />
          <Skeleton height={360} radius={12} />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Revue EndoRecord" title="Document indisponible" back={back} />
        <ApiErrorState error={error} onRetry={() => void refresh()} />
      </div>
    );
  }

  if (!document) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Revue EndoRecord" title="Document introuvable" back={back} actions={syncStatus} />
        <EmptyState
          icon="file-text"
          title="Ce document n’appartient pas à ce dossier ou n’existe plus"
          description="Aucune donnée n’est affichée à sa place."
          action={
            <LinkButton href={documentsHref} variant="secondary" iconStart="arrow-left">
              Retour aux documents
            </LinkButton>
          }
        />
      </div>
    );
  }

  const pending = candidates.filter((c) => c.status === "proposed").length;
  const observationFor = (candidate: Candidate) => data.observations.find((o) => o.candidateId === candidate.id) ?? null;
  // Reading stays open to any clinician with documents access; deciding needs lab-review authority.
  const { canReviewLabs } = documentPermissions(data.access);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`Revue EndoRecord · ${data.patient.displayName} (fictif)`}
        title={document.filename}
        description={
          <span className={styles.headerMeta}>
            <Badge tone="outline">{DOCUMENT_STATUS_LABEL[document.status]}</Badge>
            <Timestamp iso={document.uploadedAt} label="Déposé le" />
            <span>
              {pending} proposition{pending > 1 ? "s" : ""} à revoir · {candidates.length} au total
            </span>
          </span>
        }
        back={back}
        actions={syncStatus}
      />
      <StaleNotice error={error} lastSuccessAt={lastSuccessAt} onRetry={() => void refresh()} isRefreshing={isRefreshing} />
      {document.error ? (
        <Notice tone="info" icon="info" title={DOCUMENT_STATUS_LABEL[document.status]}>
          {document.error}
        </Notice>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.viewerColumn}>
          {/* A PDF denial asks the shared record for fresh scope instead of keeping stale authority. */}
          <SourceViewer documentId={document.id} filename={document.filename} page={page} onAccessDenied={() => void refresh()} />
        </div>

        <section className={styles.candidates} aria-label="Valeurs proposées">
          {canReviewLabs ? (
            <Notice tone="neutral" icon="shield">
              Aucune valeur proposée n’entre dans le dossier ni dans les courbes avant votre confirmation. Vérifiez chaque
              valeur, unité, date et identité sur le PDF.
            </Notice>
          ) : (
            <Notice tone="neutral" icon="lock" title="Consultation seule">
              {LAB_REVIEW_RESERVED} Les valeurs proposées restent hors du dossier et des courbes tant qu’il ne les a pas confirmées.
            </Notice>
          )}
          {candidates.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Aucune valeur proposée pour ce document"
              description={
                document.status === "processing"
                  ? "Extraction en cours : les propositions apparaîtront ici automatiquement."
                  : "Aucun résultat n’a pu être extrait automatiquement. Consultez le PDF ; aucune valeur n’est ajoutée au dossier."
              }
            />
          ) : (
            candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                observation={observationFor(candidate)}
                selected={candidate.id === selectedId}
                canReviewLabs={canReviewLabs}
                fence={fence}
                onShowPage={showCandidate}
                onReviewed={(result) => apply(withReview(result.candidate, result.observation))}
                onObservationUpdated={(observation) => apply(withObservation(observation))}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}
