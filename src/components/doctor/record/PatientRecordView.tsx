"use client";

import { useId, useRef, useState } from "react";
import { LinkButton, Notice, PageHeader, Skeleton } from "@/components/ui";
import { FRENCH_SOURCE, useClinicianLanguage } from "@/components/layout";
import { directionFor } from "@/lib/client/document-language";
import { hasScope, usePatientAccess, type DoctorSectionProps } from "../PatientAccessScope";
import { ApiErrorState } from "../shared/ApiErrorState";
import { useHashTab } from "../shared/hooks";
import { StaleNotice, SyncStatus } from "../shared/SyncStatus";
import { NotShared } from "./AccessScopeNotice";
import { RecordActions, type RecordShortcut } from "./RecordActions";
import { RecordPanel } from "./RecordPanel";
import { RecordSectionNav } from "./RecordSectionNav";
import { RECORD_NAV_COPY, type RecordNavCopy } from "./record-nav-copy";
import { DEFAULT_TAB, TAB_IDS, recordNavView, tabAllowed, tabCounts, type TabId } from "./record-tabs";
import { visibleOpenAlertCount } from "./read-visibility";
import { AiCaseScoreCard } from "./AiCaseScoreCard";
import { SituationCard } from "./SituationCard";
import styles from "./Record.module.css";

/** French labels for content rendered inside the French-source panel (e.g. "Notes externes : non partagé"). */
const SOURCE_SECTIONS = RECORD_NAV_COPY.fr.sections;

const backLink = (copy: RecordNavCopy) => ({ href: "/doctor", label: copy.back });

/**
 * Bring the section panel into view (instantly under reduced motion). Header
 * shortcuts and the phone "Aller à …" jump also move focus to it; the section
 * navigation keeps focus on its own control so a select is never yanked away
 * while it is being used.
 */
function revealPanel(panel: HTMLElement | null, moveFocus: boolean) {
  requestAnimationFrame(() => {
    if (!panel) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    if (moveFocus) panel.focus({ preventScroll: true });
  });
}

interface RecordUnavailableProps {
  copy: RecordNavCopy;
  denied: boolean;
  error: unknown;
  onRetry: () => void;
}

function RecordUnavailable({ copy, denied, error, onRetry }: RecordUnavailableProps) {
  const { lang } = useClinicianLanguage();
  return (
    <div className={styles.page}>
      <PageHeader eyebrow={copy.eyebrow} title={denied ? copy.deniedTitle : copy.unavailableTitle} back={backLink(copy)} />
      {denied && (
        <Notice tone="neutral" icon="lock" title={copy.deniedNoticeTitle}>
          {copy.deniedNoticeBody}
        </Notice>
      )}
      {/* Localized system error (shell language), not French source: marked with the selected language and direction. */}
      <div lang={lang} dir={directionFor(lang)}>
        <ApiErrorState error={error} onRetry={onRetry} lang={lang} />
      </div>
      <div>
        <LinkButton href="/doctor" variant="secondary" iconStart="arrow-left">
          {copy.backToPatients}
        </LinkButton>
      </div>
    </div>
  );
}

/**
 * Clinician patient record from the shared fenced poll: header and shortcuts,
 * the section navigation, the situation and AI estimate, then exactly one
 * active section panel (deep-linkable via #hash). Header and navigation follow
 * the clinician shell's language; clinical content keeps its French source.
 */
export function PatientRecordView({ patientId }: { patientId: string }) {
  const { record: data, error, status, isRefreshing, lastSuccessAt, refresh, apply, fence, guard, denied } = usePatientAccess();
  const { lang } = useClinicianLanguage();
  const copy = RECORD_NAV_COPY[lang];
  const [tab, setTab] = useHashTab<TabId>(TAB_IDS, DEFAULT_TAB);
  const [rulesNotice, setRulesNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const panelTitleId = useId();

  const syncStatus = <SyncStatus lastSuccessAt={lastSuccessAt} error={error} isRefreshing={isRefreshing} />;
  const refreshSoon = () => void refresh();

  if (status === "loading" && !denied) {
    return (
      <div className={styles.page} aria-busy="true">
        <PageHeader eyebrow={copy.eyebrow} title={copy.loadingTitle} back={backLink(copy)} actions={syncStatus} />
        <Skeleton height={44} radius={4} />
        <Skeleton height={160} radius={8} />
        <Skeleton height={320} radius={8} />
      </div>
    );
  }

  if (!data) return <RecordUnavailable copy={copy} denied={denied} error={error} onRetry={refreshSoon} />;

  const section: DoctorSectionProps = { patientId, record: data, fence, refresh: refreshSoon };
  const nav = recordNavView(tab, tabCounts(data), copy);
  const selectTab = (next: TabId) => {
    setTab(next);
    if (next !== "rules") setRulesNotice(null);
  };
  const openSection = (next: TabId) => {
    selectTab(next);
    revealPanel(panelRef.current, false);
  };
  const openShortcut = (next: RecordShortcut) => {
    selectTab(next);
    revealPanel(panelRef.current, true);
  };
  /** Phone "Aller à …": the section is already shown; only reveal and focus it. */
  const jumpToPanel = () => revealPanel(panelRef.current, true);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={<bdi>{data.patient.displayName}</bdi>}
        back={backLink(copy)}
        actions={
          <div className={styles.headerActions}>
            <RecordActions
              messagesShared={hasScope(data, "messages")}
              openAlerts={visibleOpenAlertCount(data)}
              onOpen={openShortcut}
              copy={copy}
            />
            {syncStatus}
          </div>
        }
      />
      <StaleNotice error={error} lastSuccessAt={lastSuccessAt} onRetry={refreshSoon} isRefreshing={isRefreshing} />
      <RecordSectionNav view={nav} copy={copy} panelId={panelId} onSelect={openSection} onJump={jumpToPanel} />

      <div {...FRENCH_SOURCE} className={styles.sectionStack}>
        <SituationCard record={data} />
        <AiCaseScoreCard key={patientId} patientId={patientId} record={data} />
      </div>

      <section ref={panelRef} id={panelId} aria-labelledby={panelTitleId} tabIndex={-1} className={styles.panel}>
        <h2 id={panelTitleId} className={styles.panelTitle}>
          {nav.activeLabel}
        </h2>
        <div {...FRENCH_SOURCE} className={styles.panelBody}>
          {tabAllowed(data, tab) ? (
            <RecordPanel
              tab={tab}
              section={section}
              apply={apply}
              guard={guard}
              rulesNotice={rulesNotice}
              onRulesNotice={setRulesNotice}
              onOpenDocuments={() => selectTab("documents")}
            />
          ) : (
            <NotShared what={SOURCE_SECTIONS[tab]} />
          )}
        </div>
      </section>
    </div>
  );
}
