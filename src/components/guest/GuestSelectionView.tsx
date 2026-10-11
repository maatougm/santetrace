"use client";

/**
 * The frozen selection the patient shared, read-only. Provenance stays next
 * to every value: simulated readings carry the simulated label, pulse is
 * unscored, facts show their verification. A PDF opens whole in the viewer
 * through the guest source route (checked live by the server on every read).
 */
import type { ReactNode } from "react";
import { Badge, Button, StatusBadge } from "@/components/ui";
import type { Document, Measurement, Observation } from "@/contracts/care";
import type { GuestSelection } from "@/contracts/external-visit";
import type { CareAction, MedicalFact } from "@/contracts/monitoring";
import { CARE_COPY, templateText } from "@/lib/client/copy/care";
import { SHARE_COPY } from "@/lib/client/copy/share";
import { formatDateTime, formatNumber, measurementKindLabel, measurementSourceLabel } from "@/lib/client/format";
import { getMessages } from "@/lib/client/i18n";
import { guestDocumentSourceUrl } from "@/lib/client/share-api";
import type { Language } from "@/lib/client/transport";
import { CareStatusBadge, colon, Ltr, Reading, When } from "@/components/patient/bits";
import { SourceViewer } from "@/components/doctor/review/SourceViewer";
import { factTitle } from "@/components/patient/share/share-selection";
import { measurementBadges } from "./guest-state";
import styles from "./guest.module.css";

const byNewest = <T,>(at: (item: T) => string) => (a: T, b: T) => Date.parse(at(b)) - Date.parse(at(a));

function Group({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupTitle}>
        {title} <Ltr>({count})</Ltr>
      </h3>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

function MeasurementItem({ m, lang }: { m: Measurement; lang: Language }) {
  const badges = measurementBadges(m);
  const share = SHARE_COPY[lang];
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <p className={styles.itemTitle}>{measurementKindLabel(m.kind, lang)}</p>
        {badges.unscored ? (
          <StatusBadge status="unknown" size="sm" label={CARE_COPY[lang].monitoring.pulseUnscored} />
        ) : (
          <CareStatusBadge status={m.status} lang={lang} size="sm" />
        )}
      </div>
      <Reading value={m} lang={lang} size="md" />
      <div className={styles.badges}>
        {badges.simulated ? (
          <Badge tone="outline" icon="activity">
            {share.guest.simulatedBadge}
          </Badge>
        ) : null}
        {m.connector?.quality === "suspect" ? (
          <Badge tone="outline" icon="help-circle">
            {share.simulator.quality.suspect}
          </Badge>
        ) : null}
      </div>
      <p className={styles.meta}>
        <When iso={m.measuredAt} lang={lang} label={getMessages(lang).common.measuredAt} /> · {measurementSourceLabel(m.source, lang)}
      </p>
    </li>
  );
}

function ObservationItem({ o, lang }: { o: Observation; lang: Language }) {
  const care = CARE_COPY[lang];
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <p className={styles.itemTitle}>
          <bdi>{o.exam}</bdi>
        </p>
        <Badge tone="accent" icon="check">
          {care.verification.confirmed}
        </Badge>
      </div>
      <Ltr>
        {formatNumber(o.value, lang, 2)} {o.unit}
      </Ltr>
      <p className={styles.meta}>
        <When iso={o.examDate} lang={lang} format="date" /> · {care.record.version(1 + o.revisions.length)}
      </p>
    </li>
  );
}

function FactItem({ f, lang }: { f: MedicalFact; lang: Language }) {
  const care = CARE_COPY[lang];
  const title = factTitle(f, lang);
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <p className={styles.itemTitle}>
          {title.kind}
          {title.label ? (
            <>
              {" · "}
              <bdi>{title.label}</bdi>
            </>
          ) : null}
        </p>
        <Badge tone="outline" icon="user">
          {care.verification[f.verification]}
        </Badge>
      </div>
      {f.value ? (
        <p className={styles.meta} dir="auto">
          {f.value}
        </p>
      ) : null}
      <p className={styles.meta}>
        {care.record.polarityLabel}
        {colon(lang)}
        {care.polarity[f.polarity]} · {care.record.version(f.revision)}
      </p>
    </li>
  );
}

interface DocumentItemProps {
  d: Document;
  lang: Language;
  open: boolean;
  onToggle: () => void;
  /** A refused PDF read means the visit is over: the whole session ends, not just this viewer. */
  onSourceDenied: () => void;
}

function DocumentItem({ d, lang, open, onToggle, onSourceDenied }: DocumentItemProps) {
  const copy = SHARE_COPY[lang].guest;
  return (
    <li className={styles.item}>
      <div className={styles.itemTop}>
        <p className={styles.itemTitle}>
          <bdi>{d.filename}</bdi>
        </p>
        <Button size="sm" variant="secondary" iconStart={open ? "x" : "file-text"} aria-expanded={open} onClick={onToggle}>
          {open ? copy.closeDocument : copy.openDocument}
        </Button>
      </div>
      <p className={styles.meta}>
        <When iso={d.uploadedAt} lang={lang} format="date" />
      </p>
      {open ? (
        <SourceViewer documentId={d.id} filename={d.filename} page={null} sourceUrl={guestDocumentSourceUrl} onAccessDenied={onSourceDenied} />
      ) : null}
    </li>
  );
}

function ActionItem({ a, lang }: { a: CareAction; lang: Language }) {
  const care = CARE_COPY[lang];
  return (
    <li className={styles.item}>
      <p className={styles.itemTitle}>{templateText(a.action.templateId, lang)}</p>
      <p className={styles.meta}>
        {care.plan.due(formatDateTime(a.dueAt, lang))} · {care.actionState[a.state]}
      </p>
    </li>
  );
}

interface GuestSelectionViewProps {
  selection: GuestSelection;
  lang: Language;
  openDocumentId: string | null;
  onOpenDocument: (documentId: string | null) => void;
  /** A refused PDF read ends the guest session (terminal reducer state). */
  onSourceDenied: () => void;
}

export function GuestSelectionView({ selection, lang, openDocumentId, onOpenDocument, onSourceDenied }: GuestSelectionViewProps) {
  const copy = SHARE_COPY[lang].guest;
  return (
    <div className={styles.stack}>
      <Group id="guest-measurements" title={copy.measurements} count={selection.measurements.length}>
        {[...selection.measurements].sort(byNewest((m) => m.measuredAt)).map((m) => (
          <MeasurementItem key={m.id} m={m} lang={lang} />
        ))}
      </Group>
      <Group id="guest-observations" title={copy.observations} count={selection.observations.length}>
        {[...selection.observations].sort(byNewest((o) => o.examDate)).map((o) => (
          <ObservationItem key={o.id} o={o} lang={lang} />
        ))}
      </Group>
      <Group id="guest-facts" title={copy.facts} count={selection.medicalFacts.length}>
        {selection.medicalFacts.map((f) => (
          <FactItem key={f.id} f={f} lang={lang} />
        ))}
      </Group>
      <Group id="guest-documents" title={copy.documents} count={selection.documents.length}>
        {selection.documents.map((d) => (
          <DocumentItem
            key={d.id}
            d={d}
            lang={lang}
            open={openDocumentId === d.id}
            onToggle={() => onOpenDocument(openDocumentId === d.id ? null : d.id)}
            onSourceDenied={onSourceDenied}
          />
        ))}
      </Group>
      <Group id="guest-actions" title={copy.actions} count={selection.actions.length}>
        {selection.actions.map((a) => (
          <ActionItem key={a.id} a={a} lang={lang} />
        ))}
      </Group>
    </div>
  );
}
