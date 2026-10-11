/**
 * Reminders created for an approved care action (feature 006).
 *
 * The monitoring worker adds one legacy Reminder row per due action, with
 * `origin.kind === "care_action"`. A self-report changes the CareAction, not
 * that row, so the row's own fields say nothing about the action. These
 * decisions read the action's current state instead:
 * - a finished action's reminder is never "upcoming" and goes to the past;
 * - a care-action reminder never gets medication "Pris / Pas pris" controls
 *   (the action is reported in the plan, which is where its report counts);
 * - an action that is not in this projection (not shared, device copy) is
 *   "unknown", never assumed pending or done.
 * Reminders without an origin (medication) keep their existing behaviour.
 */
import type { Reminder } from "@/contracts/care";
import type { CareAction } from "@/contracts/monitoring";
import { ASSIST_COPY } from "@/lib/client/copy/assist";
import { CARE_COPY } from "@/lib/client/copy/care";
import type { Language } from "@/lib/client/transport";

/** Reminders due up to 12 h ago still count as "next" while undeclared. */
export const RECENT_DUE_MS = 12 * 3600_000;

const PLAN_HREF = "/patient/plan";

type ClosedState = Exclude<CareAction["state"], "pending">;

export type CareActionReminderState =
  | { kind: "none" }
  | { kind: "pending"; actionId: string }
  | { kind: "closed"; actionId: string; state: ClosedState; reportedAt: string | null }
  | { kind: "unknown"; actionId: string };

export function careActionReminderState(reminder: Pick<Reminder, "origin">, actions: readonly CareAction[]): CareActionReminderState {
  const origin = reminder.origin;
  if (origin?.kind !== "care_action") return { kind: "none" };
  const action = actions.find((candidate) => candidate.id === origin.actionId);
  if (!action) return { kind: "unknown", actionId: origin.actionId };
  if (action.state === "pending") return { kind: "pending", actionId: action.id };
  return { kind: "closed", actionId: action.id, state: action.state, reportedAt: action.reportedAt };
}

const time = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
};

/** Home "next reminders": undeclared and recent; care-action reminders only while their action is pending. */
export function upcomingReminders(reminders: readonly Reminder[], actions: readonly CareAction[], now: number, limit: number): Reminder[] {
  return reminders
    .filter((reminder) => {
      const state = careActionReminderState(reminder, actions).kind;
      if (state === "closed" || state === "unknown") return false;
      return reminder.acknowledgedAt === null && time(reminder.dueAt) >= now - RECENT_DUE_MS;
    })
    .sort((a, b) => time(a.dueAt) - time(b.dueAt))
    .slice(0, limit);
}

export interface ReminderGroups {
  upcoming: Reminder[];
  past: Reminder[];
}

/** Reminders screen: a finished care action goes to the past group whatever its due time. */
export function reminderGroups(reminders: readonly Reminder[], actions: readonly CareAction[], now: number, recentMs: number): ReminderGroups {
  const isPast = (reminder: Reminder) =>
    careActionReminderState(reminder, actions).kind === "closed" || time(reminder.dueAt) < now - recentMs;
  return {
    upcoming: reminders.filter((r) => !isPast(r)).sort((a, b) => time(a.dueAt) - time(b.dueAt)),
    past: reminders.filter(isPast).sort((a, b) => time(b.dueAt) - time(a.dueAt)),
  };
}

export type ReminderDisplay =
  | { mode: "medication" }
  | { mode: "plan_link"; href: string; label: string }
  | { mode: "closed"; stateLabel: string; note: string };

/** How a reminder's report area renders; only medication reminders keep "Pris / Pas pris". */
export function reminderDisplay(reminder: Pick<Reminder, "origin">, actions: readonly CareAction[], lang: Language): ReminderDisplay {
  const state = careActionReminderState(reminder, actions);
  if (state.kind === "none") return { mode: "medication" };
  if (state.kind === "closed") {
    // The action's own declaration, plus: a declaration does not close an alert.
    return { mode: "closed", stateLabel: CARE_COPY[lang].actionState[state.state], note: CARE_COPY[lang].plan.reportNote };
  }
  return { mode: "plan_link", href: PLAN_HREF, label: ASSIST_COPY[lang].reminders.planLink };
}
