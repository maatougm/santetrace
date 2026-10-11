"use client";

import { Button, Icon, Notice } from "@/components/ui";
import { useClinicianLanguage } from "@/components/layout/ClinicianLanguage";
import { describeApiError, type ApiError, type Language } from "@/lib/client/api";
import { directionFor } from "@/lib/client/document-language";
import { FRESHNESS_COPY, freshnessAge } from "../dashboard/dashboard-copy";
import { selectedLanguageRoot } from "./ApiErrorState";
import { useNow } from "./hooks";
import { TIME_ZONE } from "./time";
import styles from "./SyncStatus.module.css";

interface SyncStatusProps {
  lastSuccessAt: number | null;
  error: ApiError | null;
  isRefreshing: boolean;
  /** Defaults to the clinician shell language (French outside the shell). */
  lang?: Language;
}

const CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: TIME_ZONE,
};

/** Latin digits in both languages, as in the UI kit Timestamp. */
const clockFormatters: Readonly<Record<Language, Intl.DateTimeFormat>> = {
  fr: new Intl.DateTimeFormat("fr-FR", CLOCK_OPTIONS),
  ar: new Intl.DateTimeFormat("ar-TN-u-nu-latn", CLOCK_OPTIONS),
};

function clockFor(lang: Language): (ms: number) => string {
  return (ms) => clockFormatters[lang].format(ms);
}

/** Compact "mis à jour il y a X s" chip for page headers. Not a live region on purpose. */
export function SyncStatus({ lastSuccessAt, error, isRefreshing, lang }: SyncStatusProps) {
  const shell = useClinicianLanguage();
  const language = lang ?? shell.lang;
  const copy = FRESHNESS_COPY[language];
  const now = useNow(1_000);
  const stale = Boolean(error);
  return (
    // Declares its own language/direction, even inside a known-French island.
    <p className={stale ? `${styles.chip} ${styles.stale}` : styles.chip} lang={language} dir={directionFor(language)}>
      <span className={styles.dot} aria-hidden="true" data-refreshing={isRefreshing || undefined} />
      {lastSuccessAt === null ? (
        <span>{copy.syncing}</span>
      ) : (
        <span>
          {stale ? copy.lastUpdated : copy.updated}{" "}
          <span className={styles.age}>{freshnessAge(lastSuccessAt, now, language, clockFor(language))}</span>
        </span>
      )}
      {stale ? <Icon name="cloud-off" size={14} title={copy.interrupted} /> : null}
    </p>
  );
}

interface StaleNoticeProps {
  error: ApiError | null;
  lastSuccessAt: number | null;
  onRetry: () => void;
  isRefreshing: boolean;
  /** Defaults to the clinician shell language (French outside the shell). */
  lang?: Language;
}

/** Visible banner when polling fails while previous data stays on screen. */
export function StaleNotice({ error, lastSuccessAt, onRetry, isRefreshing, lang }: StaleNoticeProps) {
  const shell = useClinicianLanguage();
  if (!error || lastSuccessAt === null) return null;
  const language = lang ?? shell.lang;
  const copy = FRESHNESS_COPY[language];
  const description = describeApiError(error, language);
  return (
    // Notice takes no lang/dir: a box-less root declares them (no extra layout box or role).
    <div {...selectedLanguageRoot(language)}>
      <Notice
        tone="info"
        icon={error.isOffline ? "wifi-off" : "cloud-off"}
        role="status"
        title={copy.staleTitle(clockFor(language)(lastSuccessAt))}
        action={
          <Button size="sm" variant="secondary" iconStart="refresh" onClick={onRetry} loading={isRefreshing}>
            {copy.retry}
          </Button>
        }
      >
        {description.title}
        {copy.labelSeparator}
        {description.message} {copy.staleBody}
      </Notice>
    </div>
  );
}
