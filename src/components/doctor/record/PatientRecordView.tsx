"use client";

import { useRef, useState } from "react";
import { LinkButton, Notice, PageHeader, Skeleton, Tabs, tabPanelProps } from "@/components/ui";
import { hasScope, usePatientAccess, type DoctorSectionProps } from "../PatientAccessScope";
import { ApiErrorState } from "../shared/ApiErrorState";
import { useHashTab } from "../shared/hooks";
import { StaleNotice, SyncStatus } from "../shared/SyncStatus";
import { NotShared } from "./AccessScopeNotice";
import { RecordActions, type RecordShortcut } from "./RecordActions";
import { RecordPanel } from "./RecordPanel";
import { DEFAULT_TAB, TAB_IDS, buildTabs, openAlertCount, tabAllowed, type TabId } from "./record-tabs";
import { AiCaseScoreCard } from "./AiCaseScoreCard";
import { SituationCard } from "./SituationCard";
import styles from "./Record.module.css";

const TAB_PREFIX = "record";
const EYEBROW = "Dossier patient · fictif";
const BACK = { href: "/doctor", label: "Patients" };

/** Bring the tab bar into view and move focus to the panel it controls. */
function revealPanel(anchor: HTMLElement | null, panel: HTMLElement | null) {
  requestAnimationFrame(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    panel?.focus({ preventScroll: true });
  });
}

function RecordUnavailable({ denied, error, onRetry }: { denied: boolean; error: unknown; onRetry: () => void }) {
  return (
    <div className={styles.page}>
      <PageHeader eyebrow={EYEBROW} title={denied ? "Accès retiré ou indisponible" : "Dossier indisponible"} back={BACK} />
      {denied && (
        <Notice tone="neutral" icon="lock" title="Affichage effacé">
          Le serveur refuse désormais cet accès. Les données affichées ont été retirées de cet écran ; une réponse reçue
          plus tard ne les rétablit pas. Le patient conserve son dossier.
        </Notice>
      )}
      <ApiErrorState error={error} onRetry={onRetry} />
      <div>
        <LinkButton href="/doctor" variant="secondary" iconStart="arrow-left">
          Retour aux patients
        </LinkButton>
      </div>
    </div>
  );
}

/** Clinician patient record from the shared fenced poll: situation card, then sections in tabs (deep-linkable via #hash). */
export function PatientRecordView({ patientId }: { patientId: string }) {
  const { record: data, error, status, isRefreshing, lastSuccessAt, refresh, apply, fence, guard, denied } = usePatientAccess();
  const [tab, setTab] = useHashTab<TabId>(TAB_IDS, DEFAULT_TAB);
  const [rulesNotice, setRulesNotice] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const syncStatus = <SyncStatus lastSuccessAt={lastSuccessAt} error={error} isRefreshing={isRefreshing} />;
  const refreshSoon = () => void refresh();

  if (status === "loading" && !denied) {
    return (
      <div className={styles.page} aria-busy="true">
        <PageHeader eyebrow={EYEBROW} title="Chargement du dossier…" back={BACK} actions={syncStatus} />
        <Skeleton height={160} radius={8} />
        <Skeleton height={44} radius={4} />
        <Skeleton height={320} radius={8} />
      </div>
    );
  }

  if (!data) return <RecordUnavailable denied={denied} error={error} onRetry={refreshSoon} />;

  const section: DoctorSectionProps = { patientId, record: data, fence, refresh: refreshSoon };
  const tabs = buildTabs(data);
  const selectTab = (next: TabId) => {
    setTab(next);
    if (next !== "rules") setRulesNotice(null);
  };
  const openShortcut = (next: RecordShortcut) => {
    selectTab(next);
    revealPanel(tabsRef.current, panelRef.current);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={EYEBROW}
        title={data.patient.displayName}
        back={BACK}
        actions={
          <div className={styles.headerActions}>
            <RecordActions messagesShared={hasScope(data, "messages")} openAlerts={openAlertCount(data)} onOpen={openShortcut} />
            {syncStatus}
          </div>
        }
      />
      <StaleNotice error={error} lastSuccessAt={lastSuccessAt} onRetry={refreshSoon} isRefreshing={isRefreshing} />
      <SituationCard record={data} />
      <AiCaseScoreCard key={patientId} patientId={patientId} record={data} />

      <div ref={tabsRef} className={styles.tabsBar}>
        <Tabs<TabId> idPrefix={TAB_PREFIX} ariaLabel="Sections du dossier" tabs={tabs} active={tab} onChange={selectTab} />
      </div>
      <div ref={panelRef} {...tabPanelProps(TAB_PREFIX, tab)} className={styles.panel}>
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
          <NotShared what={tabs.find((t) => t.id === tab)?.label ?? "Section"} />
        )}
      </div>
    </div>
  );
}
