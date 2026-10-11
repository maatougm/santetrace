"use client";

/**
 * Latest reading received by the server, behind a disclosure on home. Pulse
 * is never classified; simulated and suspect readings say so, including next
 * to the number in the collapsed summary (never an unqualified value).
 */
import Link from "next/link";
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

/** Unscored pulse, simulated origin, suspect signal: the labels that qualify a number. */
function ProvenanceBadges({ measurement, lang }: { measurement: Measurement; lang: Language }) {
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

function ReadingBadges({ measurement, lang }: { measurement: Measurement; lang: Language }) {
  const badge = measurementBadge(measurement);
  return (
    <span className={css.readingBadges}>
      {badge.kind === "status" ? <CareStatusBadge status={badge.status} lang={lang} size="sm" /> : null}
      <ProvenanceBadges measurement={measurement} lang={lang} />
    </span>
  );
}

/** Collapsed summary: the number never appears without its qualifying labels. */
function SummaryReading({ measurement, lang }: { measurement: Measurement; lang: Language }) {
  return (
    <span className={css.summaryReading}>
      <Reading value={measurement} lang={lang} size="sm" />
      <ProvenanceBadges measurement={measurement} lang={lang} />
    </span>
  );
}

function KindLabel({ kind, lang }: { kind: Measurement["kind"]; lang: Language }) {
  return (
    <span className={styles.kindLabel}>
      <Icon name={KIND_ICON[kind]} size={16} />
      {measurementKindLabel(kind, lang)}
    </span>
  );
}

function ReadingBlock({ measurement, lang, t, size }: { measurement: Measurement; lang: Language; t: Messages; size: "sm" | "lg" }) {
  return (
    <>
      <div className={css.latestTop}>
        <KindLabel kind={measurement.kind} lang={lang} />
        <ReadingBadges measurement={measurement} lang={lang} />
      </div>
      <Reading value={measurement} lang={lang} size={size} />
      <p className={styles.metaLine}>
        <When iso={measurement.measuredAt} lang={lang} label={t.common.measuredAt} />
      </p>
      <p className={styles.metaLine}>
        <When iso={measurement.receivedAt} lang={lang} label={t.common.receivedAt} /> · {measurementSourceLabel(measurement.source, lang)}
      </p>
    </>
  );
}

export function LatestReading({ record, lang, t }: { record: PatientRecord; lang: Language; t: Messages }) {
  const latest = latestMeasurement(record.measurements);
  // Pulse is captured but unscored: keep the last one visible next to the scored reading.
  const pulse = latest?.kind === "pulse" ? null : latestOfKind(record.measurements, "pulse");
  return (
    <Disclosure title={t.home.latestTitle} value={latest ? <SummaryReading measurement={latest} lang={lang} /> : null}>
      {latest ? (
        <>
          <ReadingBlock measurement={latest} lang={lang} t={t} size="lg" />
          {pulse ? (
            <div className={css.pulseRow}>
              <ReadingBlock measurement={pulse} lang={lang} t={t} size="sm" />
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.emptyLine}>{t.home.latestNone}</p>
      )}
      <Link href="/patient/history" className={css.textLink}>
        {t.home.historyCta}
        <Icon name="chevron-right" size={18} />
      </Link>
    </Disclosure>
  );
}
