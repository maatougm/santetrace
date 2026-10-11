/**
 * Record tabs: ids (deep-linkable via #hash), display order, and the scope
 * each one needs. Messages and alerts come first: they are what a clinician
 * opens a record from the queue to do.
 */
import type { TabItem } from "@/components/ui";
import type { PatientRecord } from "@/lib/client/api";
import type { SharingScope } from "@/contracts/patient-platform";
import { hasScope } from "../PatientAccessScope";
import { isOpenAlert } from "../shared/alerts";

export const TAB_IDS = [
  "messages",
  "alerts",
  "care",
  "trends",
  "measurements",
  "documents",
  "report",
  "protocols",
  "search",
  "notes",
  "reminders",
  "rules",
  "summary",
] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Opening tab: the care plan. Not Messages: displaying the thread sends read receipts. */
export const DEFAULT_TAB: TabId = "care";

/** Scope a tab needs; `manage` = primary care authority. Missing → "Non partagé", never "vide". */
const TAB_REQUIREMENT: Record<TabId, SharingScope | "manage" | null> = {
  messages: "messages",
  alerts: "alerts",
  care: "status",
  trends: "measurements",
  measurements: "measurements",
  documents: "documents",
  report: "summary",
  protocols: null,
  search: null,
  notes: "clinical",
  reminders: "manage",
  rules: "manage",
  summary: "summary",
};

export function tabAllowed(record: PatientRecord, tab: TabId): boolean {
  const requirement = TAB_REQUIREMENT[tab];
  if (requirement === null) return true;
  if (requirement === "manage") return record.access.owner || record.access.canManageCare;
  return hasScope(record, requirement);
}

export function openAlertCount(record: PatientRecord): number {
  return record.alerts.filter(isOpenAlert).length;
}

export function buildTabs(record: PatientRecord): TabItem<TabId>[] {
  const pending = record.candidates.filter((c) => c.status === "proposed").length;
  const reviewable = record.proposals.filter((p) => p.state === "pending" || p.state === "needs_review").length;
  return [
    { id: "messages", label: "Messages", icon: "message" },
    { id: "alerts", label: "Alertes", icon: "bell", count: openAlertCount(record) },
    { id: "care", label: "Suivi et plan", icon: "clipboard", count: reviewable || undefined },
    { id: "trends", label: "Tendances", icon: "activity" },
    { id: "measurements", label: "Mesures", icon: "heart-pulse", count: record.measurements.length },
    { id: "documents", label: "Documents", icon: "file-text", count: pending },
    { id: "report", label: "Rapport", icon: "stethoscope" },
    { id: "protocols", label: "Protocoles", icon: "shield" },
    { id: "search", label: "Recherche", icon: "search" },
    { id: "notes", label: "Notes externes", icon: "file-text", count: record.externalNotes?.length || undefined },
    { id: "reminders", label: "Rappels", icon: "pill", count: record.reminders.length },
    { id: "rules", label: "Règles", icon: "sliders" },
    { id: "summary", label: "Synthèse", icon: "file-text" },
  ];
}
