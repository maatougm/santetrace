"use client";

import { Badge, Timestamp, type BadgeTone, type IconName } from "@/components/ui";
import type { SourceRef, Verification } from "@/contracts/monitoring";
import { documentSourceUrl } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import styles from "./Care.module.css";

const copy = CARE_COPY.fr;

/** Provenance is never colour alone: each level has its own icon and label. */
export const VERIFICATION_BADGE: Readonly<Record<Verification, { tone: BadgeTone; icon: IconName }>> = {
  confirmed: { tone: "accent", icon: "check" },
  patient_reported: { tone: "neutral", icon: "user" },
  simulated: { tone: "outline", icon: "activity" },
  candidate: { tone: "outline", icon: "help-circle" },
  external_unverified: { tone: "outline", icon: "help-circle" },
  reference: { tone: "muted", icon: "file-text" },
};

export function VerificationBadge({ verification }: { verification: Verification }) {
  const meta = VERIFICATION_BADGE[verification];
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {copy.verification[verification]}
    </Badge>
  );
}

interface SourceListProps {
  sources: readonly SourceRef[];
  /** Ids cited but absent from the server answer: listed as missing, never rebuilt. */
  missingIds?: readonly string[];
}

/** Sources with kind, verification, date, page, quote and a link to the PDF page. */
export function SourceList({ sources, missingIds = [] }: SourceListProps) {
  if (sources.length === 0 && missingIds.length === 0) {
    return <p className={styles.mutedBlock}>{copy.sources.none}</p>;
  }
  return (
    <ul className={styles.sourceList}>
      {sources.map((source) => (
        <li key={`${source.kind}:${source.id}:${source.revision}`} className={styles.source}>
          <span className={styles.row}>
            <span className={styles.strongText}>{copy.sourceKind[source.kind]}</span>
            <VerificationBadge verification={source.verification} />
            {source.polarity !== "affirmed" ? <Badge tone="outline">{copy.polarity[source.polarity]}</Badge> : null}
            <Timestamp iso={source.date} format="date" label="Daté du" className={styles.muted} />
            {source.page ? <span className={styles.muted}>page {source.page}</span> : null}
          </span>
          {source.quote ? <q className={styles.quote}>{source.quote}</q> : null}
          {source.documentId ? (
            <a className={styles.link} href={documentSourceUrl(source.documentId, source.page)} target="_blank" rel="noopener noreferrer">
              {source.page ? copy.sources.openPdf(source.page) : "Ouvrir le PDF"}
              <span className={styles.muted}> (nouvel onglet)</span>
            </a>
          ) : null}
        </li>
      ))}
      {missingIds.map((id) => (
        <li key={`missing:${id}`} className={styles.source}>
          <span className={styles.row}>
            <Badge tone="outline" icon="help-circle">
              Source citée absente du rapport
            </Badge>
            <bdi className={styles.mono}>{id}</bdi>
            <span className={styles.muted}>non affichée</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
