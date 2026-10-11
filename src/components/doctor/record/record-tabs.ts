/**
 * Record sections: ids (deep-linkable via #hash, order unchanged), the scope
 * each one needs, their real counts, and how the section navigation presents
 * them (phone: one grouped native select; desktop: four frequent destinations
 * plus an "Autres sections" select). Pure: no React, no request. Labels come
 * from `record-nav-copy.ts` in the clinician shell's language.
 */
import type { PatientRecord } from "@/lib/client/api";
import type { SharingScope } from "@/contracts/patient-platform";
import { recordCounts, type RecordCountSource, type VisibleCount } from "./read-visibility";

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

/** A select value is DOM input: only the 13 known ids are accepted. */
export function parseTabId(value: string): TabId | null {
  return TAB_IDS.find((id) => id === value) ?? null;
}

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

type AccessSource = Pick<PatientRecord, "access">;

/** Same rule as `PatientAccessScope.hasScope` (owner views have all scopes), kept here so this module stays pure. */
function hasScope(record: AccessSource, scope: SharingScope): boolean {
  return record.access.owner || record.access.scopes.includes(scope);
}

export function tabAllowed(record: AccessSource, tab: TabId): boolean {
  const requirement = TAB_REQUIREMENT[tab];
  if (requirement === null) return true;
  if (requirement === "manage") return record.access.owner || record.access.canManageCare;
  return hasScope(record, requirement);
}

export type TabCountSource = RecordCountSource & AccessSource;

/** Real counts shown beside section names. `undefined` = no count shown (never an invented 0). */
export type TabCounts = Readonly<Partial<Record<TabId, number>>>;

/**
 * Badges from the record's current access: a count whose data is not shared
 * (null), or whose tab this account cannot open, is omitted — never shown as 0.
 * Documents counts pending proposed values (not PDFs); care and notes show no badge for 0.
 */
export function tabCounts(record: TabCountSource): TabCounts {
  const counts = recordCounts(record);
  const shown = (tab: TabId, count: VisibleCount): number | undefined =>
    count !== null && tabAllowed(record, tab) ? count : undefined;
  const shownIfAny = (tab: TabId, count: VisibleCount): number | undefined => (count === 0 ? undefined : shown(tab, count));
  return {
    alerts: shown("alerts", counts.openAlerts),
    care: shownIfAny("care", counts.reviewableProposals),
    measurements: shown("measurements", counts.measurements),
    documents: shown("documents", counts.pendingLabs),
    notes: shownIfAny("notes", counts.externalNotes),
    reminders: shown("reminders", counts.reminders),
  };
}

// --- Navigation structure -------------------------------------------------

/** Desktop row: the destinations a clinician opens most. Everything else is under "Autres sections". */
export const FREQUENT_TABS = ["care", "measurements", "documents", "messages"] as const satisfies readonly TabId[];
export type FrequentTabId = (typeof FREQUENT_TABS)[number];

export function isFrequentTab(tab: TabId): tab is FrequentTabId {
  return (FREQUENT_TABS as readonly TabId[]).includes(tab);
}

/** The nine destinations of the desktop "Autres sections" select, in hash order. */
export const SECONDARY_TABS: readonly TabId[] = TAB_IDS.filter((id) => !isFrequentTab(id));

export type TabGroupId = "communication" | "followUp" | "evidence" | "tools";

/** Option groups built from the existing sections only; each id appears exactly once. */
export const TAB_GROUPS: readonly { readonly id: TabGroupId; readonly tabs: readonly TabId[] }[] = [
  { id: "communication", tabs: ["messages", "alerts"] },
  { id: "followUp", tabs: ["care", "trends", "measurements", "reminders"] },
  { id: "evidence", tabs: ["documents", "report", "notes", "summary"] },
  { id: "tools", tabs: ["protocols", "search", "rules"] },
];

export interface NavLabels {
  sections: Readonly<Record<TabId, string>>;
  groups: Readonly<Record<TabGroupId, string>>;
}

export interface NavOption<T extends TabId = TabId> {
  id: T;
  label: string;
  /** Label plus the real count, for native <option> text. */
  text: string;
  count: number | undefined;
  current: boolean;
}

export interface NavGroup {
  id: TabGroupId;
  label: string;
  options: NavOption[];
}

export interface RecordNavView {
  active: TabId;
  activeLabel: string;
  /** Phone: all 13 destinations, grouped. */
  groups: NavGroup[];
  /** Desktop row, in FREQUENT_TABS order. */
  frequent: NavOption<FrequentTabId>[];
  /** Desktop "Autres sections": the other nine, grouped (empty groups dropped). */
  secondaryGroups: NavGroup[];
  /** "" while a frequent section is active; otherwise the active secondary id, shown selected. */
  secondaryValue: TabId | "";
  /** Visible name of the active secondary section; null when a frequent one is active. */
  secondaryLabel: string | null;
}

function navOption<T extends TabId>(id: T, active: TabId, counts: TabCounts, labels: NavLabels): NavOption<T> {
  const label = labels.sections[id];
  const count = counts[id];
  return { id, label, text: count === undefined ? label : `${label} (${count})`, count, current: id === active };
}

/** Everything the section navigation renders, from the active id, real counts and the shell's labels. */
export function recordNavView(active: TabId, counts: TabCounts, labels: NavLabels): RecordNavView {
  const groups = TAB_GROUPS.map((group) => ({
    id: group.id,
    label: labels.groups[group.id],
    options: group.tabs.map((id) => navOption(id, active, counts, labels)),
  }));
  const secondaryGroups = groups
    .map((group) => ({ ...group, options: group.options.filter((option) => !isFrequentTab(option.id)) }))
    .filter((group) => group.options.length > 0);
  const secondaryActive = !isFrequentTab(active);
  return {
    active,
    activeLabel: labels.sections[active],
    groups,
    frequent: FREQUENT_TABS.map((id) => navOption(id, active, counts, labels)),
    secondaryGroups,
    secondaryValue: secondaryActive ? active : "",
    secondaryLabel: secondaryActive ? labels.sections[active] : null,
  };
}
