"use client";

import { useId } from "react";
import { Badge, LinkButton, Timestamp, type BadgeTone, type IconName } from "@/components/ui";
import { CARE_COPY } from "@/lib/client/copy/care";
import { SHARE_COPY } from "@/lib/client/copy/share";
import type { SearchHit } from "@/lib/client/search-api";
import { formatScore, hitLabel, hitSourceLink, type HitLabel } from "./search-results";
import styles from "./Comms.module.css";

const care = CARE_COPY.fr;
const search = SHARE_COPY.fr.search;

const LABEL_BADGE: Record<HitLabel, { tone: BadgeTone; icon: IconName; text: string }> = {
  reference: { tone: "outline", icon: "info", text: search.referenceBadge },
  external_note: { tone: "outline", icon: "user", text: search.externalNoteBadge },
  patient: { tone: "neutral", icon: "file-text", text: search.patientSourceBadge },
};

function HitItem({ hit, patientId }: { hit: SearchHit; patientId: string }) {
  const label = hitLabel(hit);
  const link = label === "reference" ? null : hitSourceLink(patientId, hit);
  const score = formatScore(hit.score);
  const { source } = hit;
  const badge = LABEL_BADGE[label];
  return (
    <li className={styles.hit}>
      <div className={styles.badges}>
        <Badge tone={badge.tone} icon={badge.icon}>
          {badge.text}
        </Badge>
        <Badge tone="muted">{care.sourceKind[source.kind]}</Badge>
        <Badge tone="muted" icon={source.verification === "confirmed" ? "check" : "help-circle"}>
          {care.verification[source.verification]}
        </Badge>
        <Timestamp iso={source.date} format="date" />
        {typeof source.page === "number" ? <span className={styles.muted}>page {source.page}</span> : null}
      </div>
      <blockquote className={styles.excerpt}>{hit.excerpt}</blockquote>
      <div className={styles.hitFoot}>
        {score ? <span className={styles.muted}>{search.score(score)}</span> : <span />}
        {link ? (
          <LinkButton href={link.href} size="sm" variant="secondary" iconEnd="arrow-right">
            {link.page ? `Ouvrir la source (page ${link.page})` : "Ouvrir la source"}
          </LinkButton>
        ) : null}
      </div>
    </li>
  );
}

interface SearchHitListProps {
  patientId: string;
  patientHits: readonly SearchHit[];
  referenceHits: readonly SearchHit[];
}

/** Patient sources first; general references in a visually separate group, never mixed. */
export function SearchHitList({ patientId, patientHits, referenceHits }: SearchHitListProps) {
  const patientTitle = useId();
  const referenceTitle = useId();
  return (
    <>
      {patientHits.length > 0 ? (
        <section className={styles.group} aria-labelledby={patientTitle}>
          <h3 id={patientTitle} className={styles.subTitle}>
            Sources du dossier ({patientHits.length})
          </h3>
          <ol className={styles.hits}>
            {patientHits.map((hit) => (
              <HitItem key={hit.id} hit={hit} patientId={patientId} />
            ))}
          </ol>
        </section>
      ) : null}
      {referenceHits.length > 0 ? (
        <section className={styles.referenceGroup} aria-labelledby={referenceTitle}>
          <h3 id={referenceTitle} className={styles.subTitle}>
            Références internes du prototype ({referenceHits.length})
          </h3>
          <p className={styles.mutedBlock}>
            Politique interne du prototype, identifiée : ce n’est pas une recommandation médicale. Une référence n’est ni un
            fait du patient ni une consigne approuvée pour lui, et ne modifie aucune règle.
          </p>
          <ol className={styles.hits}>
            {referenceHits.map((hit) => (
              <HitItem key={hit.id} hit={hit} patientId={patientId} />
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
