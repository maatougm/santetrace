"use client";

/**
 * Latest reading received by the server, shown openly on home right after the
 * primary action: the number with its qualifying labels (unscored pulse,
 * simulated, suspect), its kind and own reading status, the measured time and
 * the receipt/source line. Nothing received renders an explicit empty line,
 * never a zero. The reading's own badge never stands in for whole-patient
 * status (that is the status card). The unscored pulse, when a scored reading
 * is newer, stays one disclosure away with its number and labels in the summary.
 */
import type { ReactNode } from "react";
import { Badge, Icon, type IconName } from "@/components/ui";
import type { Language, Measurement, PatientRecord } from "@/lib/client/api";
import { CARE_COPY } from "@/lib/client/copy/care";
import { measurementKindLabel, measurementQualityLabel, measurementSourceLabel } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import { CareStatusBadge, Reading, When } from "../bits";
import { latestOfKind, measurementBadge } from "../monitoring/monitoring-view";
import { Disclosure } from "./Disclosure";
import { readingProvenance } from "./reading-provenance";
import css from "../home.module.css";
import styles from "../patient.module.css";

const KIND_ICON: Record<Measurement["kind"], IconName> = {
  blood_pressure: "heart-pulse",
  glucose: "droplet",
  pulse: "activity",
};

export function latestMeasurement(measurements: readonly Measurement[]): Measurement | null {
  return measurements.reduce<Measurement | null>(
    (latest, m) => (!latest || Date.parse(m.measuredAt) > Date.parse(latest.measuredAt) ? m : latest),
    null,
  );
}

interface ReadingProps {
  measurement: Measurement;
  lang: Language;
}

/** Unscored pulse, simulated origin, suspect signal: the labels that qualify a number. */
function ProvenanceBadges({ measurement, lang }: ReadingProps) {
  const copy = CARE_COPY[lang];
  return (
    <>
      {readingProvenance(measurement).map((key) =>
        key === "simulated" ? (
          <Badge key={key} tone="muted">
            {copy.verification.simulated}
          </Badge>
        ) : (
          <Badge key={key} tone="outline" icon="help-circle">
            {key === "unscored" ? copy.monitoring.pulseUnscored : measurementQualityLabel(measurement, lang)}
          </Badge>
        ),
      )}
    </>
  );
}

/** The number never appears without its qualifying labels, open or collapsed. */
function SummaryReading({ measurement, lang, size = "sm" }: ReadingProps & { size?: "sm" | "md" }) {
  return (
    <span className={css.summaryReading}>
      <Reading value={measurement} lang={lang} size={size} />
      <ProvenanceBadges measurement={measurement} lang={lang} />
    </span>
  );
}

/** Kind of reading, then this reading's own status (absent for an unscored pulse). */
function ReadingKind({ measurement, lang }: ReadingProps) {
  const badge = measurementBadge(measurement);
  return (
    <div className={css.latestTop}>
      <span className={styles.kindLabel}>
        <Icon name={KIND_ICON[measurement.kind]} size={16} />
        {measurementKindLabel(measurement.kind, lang)}
      </span>
      {badge.kind === "status" ? <CareStatusBadge status={badge.status} lang={lang} size="sm" /> : null}
    </div>
  );
}

function ReadingDates({ measurement, lang, t }: ReadingProps & { t: Messages }) {
  return (
    <>
      <p className={styles.metaLine}>
        <When iso={measurement.measuredAt} lang={lang} label={t.common.measuredAt} />
      </p>
      <p className={styles.metaLine}>
        <When iso={measurement.receivedAt} lang={lang} label={t.common.receivedAt} /> · {measurementSourceLabel(measurement.source, lang)}
      </p>
    </>
  );
}

/** Unscored pulse kept beside the scored reading: number and labels in the summary, dates inside. */
function PulseDetails({ pulse, lang, t }: { pulse: Measurement; lang: Language; t: Messages }) {
  return (
    <Disclosure
      variant="inline"
      title={measurementKindLabel(pulse.kind, lang)}
      value={<SummaryReading measurement={pulse} lang={lang} />}
    >
      <ReadingDates measurement={pulse} lang={lang} t={t} />
    </Disclosure>
  );
}

interface LatestSectionProps {
  title: string;
  /** Headline number with its labels; null when the server has received nothing. */
  value: ReactNode;
  empty: string;
  children?: ReactNode;
}

function LatestSection({ title, value, empty, children }: LatestSectionProps) {
  return (
    <section className={css.latest} aria-labelledby="home-latest-title">
      <h2 id="home-latest-title" className={css.cardTitle}>
        {title}
      </h2>
      {value ?? <p className={styles.emptyLine}>{empty}</p>}
      {children}
    </section>
  );
}

export function LatestReading({ record, lang, t }: { record: PatientRecord; lang: Language; t: Messages }) {
  const latest = latestMeasurement(record.measurements);
  // Pulse is captured but unscored: keep the last one reachable next to the scored reading.
  const pulse = latest?.kind === "pulse" ? null : latestOfKind(record.measurements, "pulse");
  return (
    <LatestSection
      title={t.home.latestTitle}
      value={latest ? <SummaryReading measurement={latest} lang={lang} size="md" /> : null}
      empty={t.home.latestNone}
    >
      {latest ? (
        <>
          <ReadingKind measurement={latest} lang={lang} />
          <ReadingDates measurement={latest} lang={lang} t={t} />
        </>
      ) : null}
      {pulse ? <PulseDetails pulse={pulse} lang={lang} t={t} /> : null}
    </LatestSection>
  );
}
