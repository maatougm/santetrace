/**
 * Patient navigation map: the bottom tab bar (5 short labels that fit 320 px)
 * and the hub links that keep every patient route within two taps of home or
 * the tab bar. Pure data, so tests can check reachability.
 */
import type { IconName } from "@/components/ui";
import type { ShellNavItem } from "@/components/layout/nav";
import type { CareCopy } from "@/lib/client/copy/care";
import type { Messages } from "@/lib/client/i18n";
import type { Language } from "@/lib/client/transport";
import { HOME_COPY } from "./home/home-copy";

/** Sub-pages grouped under "Dossier" (highlight that tab, keep their own URL). */
export const RECORD_ROUTES: readonly string[] = [
  "/patient/onboarding",
  "/patient/documents",
  "/patient/history",
  "/patient/summary",
  "/patient/doctors",
  "/patient/share",
];

export function patientNavItems(t: Messages, lang: Language): ShellNavItem[] {
  return [
    { href: "/patient", label: t.nav.home, icon: "home", exact: true },
    // Prefix match keeps /patient/measure/devices under "Mesurer".
    { href: "/patient/measure", label: t.nav.measure, icon: "heart-pulse" },
    { href: "/patient/messages", label: HOME_COPY[lang].nav.messages, icon: "message" },
    // Prefix match covers /patient/plan/assistant; reminders belong to the plan.
    { href: "/patient/plan", label: t.nav.plan, icon: "clipboard", matches: ["/patient/reminders"] },
    { href: "/patient/record", label: t.nav.record, icon: "file-text", matches: RECORD_ROUTES },
  ];
}

export type QuickLinkKey = keyof (typeof HOME_COPY)["fr"]["links"];

export interface HubLink<K extends string> {
  href: string;
  key: K;
  icon: IconName;
}

/** Home secondary quick links (compact labelled list; never competes with "Ajouter une mesure"). */
export const HOME_QUICK_LINKS: readonly HubLink<QuickLinkKey>[] = [
  { href: "/patient/messages", key: "messages", icon: "message" },
  { href: "/patient/plan", key: "plan", icon: "clipboard" },
  { href: "/patient/documents", key: "documents", icon: "file-text" },
  { href: "/patient/history", key: "history", icon: "activity" },
];

export type RecordLinkKey = keyof Pick<CareCopy["record"], "onboarding" | "documents" | "history" | "summary" | "doctors" | "share">;

/** "Mon dossier" hub links (one per RECORD_ROUTES entry). */
export const RECORD_LINKS: readonly HubLink<RecordLinkKey>[] = [
  { href: "/patient/onboarding", key: "onboarding", icon: "edit" },
  { href: "/patient/documents", key: "documents", icon: "file-text" },
  { href: "/patient/history", key: "history", icon: "activity" },
  { href: "/patient/summary", key: "summary", icon: "clipboard" },
  { href: "/patient/doctors", key: "doctors", icon: "users" },
  { href: "/patient/share", key: "share", icon: "link" },
];

export type PlanLinkKey = keyof Pick<CareCopy["plan"], "reminders" | "assistant">;

/** Always shown on the plan screen (live or device copy). */
export const PLAN_LINKS: readonly HubLink<PlanLinkKey>[] = [
  // Neutral: reminders cover care actions (e.g. measuring blood pressure), not only medication.
  { href: "/patient/reminders", key: "reminders", icon: "bell" },
  { href: "/patient/plan/assistant", key: "assistant", icon: "message" },
];

/** Shown in the measure screen header and under the home primary action. */
export const DEVICES_HREF = "/patient/measure/devices";
