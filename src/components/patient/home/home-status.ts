/**
 * The ONE home status card, as data (moved from the former MonitoringOverview
 * and StatusPanel; behaviour unchanged).
 *
 * Live answer: `globalMonitoringDisplay` decides, so a global green needs a
 * green server priority, complete coverage, an evaluation and a working poll.
 * Device copy: the server status as last received; a green there is never
 * shown as reassurance ("unknown/unverified"); orange/red stay, dated.
 */
import type { Status } from "@/contracts/care";
import type { ProjectedRecord } from "@/contracts/patient-platform";
import { CARE_COPY } from "@/lib/client/copy/care";
import { formatDateTime } from "@/lib/client/format";
import type { Messages } from "@/lib/client/i18n";
import type { Language } from "@/lib/client/transport";
import type { CareTeamStatus } from "../useCareTeam";
import { statusExplainText } from "../monitoring/care-team-view";
import { conditionCards, globalMonitoringDisplay, openRedAlert, type CoverageDisplay, type GlobalDisplay } from "../monitoring/monitoring-view";

export interface HomeStatusInput {
  record: ProjectedRecord;
  /** Fetched from the server during this visit (not a device copy). */
  live: boolean;
  /** Device copy or failing poll: a green cannot be vouched for. */
  stale: boolean;
  /** ISO time of the server answer behind `record` when it is not live. */
  staleSince: string | null;
  team: CareTeamStatus;
  lang: Language;
  t: Messages;
}

export interface HomeStatusView {
  status: Status;
  /** Honest explanation lines, in reading order (may be empty for a live green). */
  lines: string[];
  /** Real evaluation time only (never the "never evaluated" sentinel). */
  evaluatedAt: string | null;
  /** Shown behind "Détails du suivi". */
  coverage: CoverageDisplay[];
  reasons: string[];
  /** "Statut calculé par le serveur" is only said of a working live answer. */
  serverOnly: boolean;
}

function staleDate(input: HomeStatusInput): string {
  return input.staleSince ? formatDateTime(input.staleSince, input.lang) : "—";
}

function liveLead(display: GlobalDisplay, input: HomeStatusInput): string | null {
  const copy = CARE_COPY[input.lang].monitoring;
  const serverGreen = input.record.monitoring?.priority === "green";
  if (input.stale && serverGreen) return input.t.status.staleUnverified(staleDate(input));
  if (input.stale) return input.t.status.staleAsOf(staleDate(input));
  if (!display.hasEvaluation) return copy.noEvaluation;
  if (display.notGreen) return copy.notGreenBecause;
  return null;
}

function liveStatus(input: HomeStatusInput): HomeStatusView {
  const { record } = input;
  const display = globalMonitoringDisplay({
    monitoring: record.monitoring,
    patientStatus: record.patient.status,
    cards: conditionCards(record.medicalFacts, record.evaluations),
    openRed: openRedAlert(record.alerts) !== null,
    stale: input.stale,
  });
  const lead = liveLead(display, input);
  return {
    status: display.status,
    lines: lead ? [lead] : [],
    evaluatedAt: display.evaluatedAt,
    coverage: display.coverage,
    reasons: display.reasons,
    serverOnly: !input.stale,
  };
}

function deviceText(serverStatus: Status, input: HomeStatusInput): string {
  const { record, stale, team, lang, t } = input;
  if (stale && serverStatus === "green") return t.status.staleUnverified(staleDate(input));
  if (serverStatus === "green") return t.status.explain.green;
  if (serverStatus === "unknown") {
    return record.patient.rules ? t.status.unknown(record.patient.rules.overdueHours) : CARE_COPY[lang].monitoring.notGreenBecause;
  }
  return statusExplainText(team, serverStatus, t);
}

function deviceStatus(input: HomeStatusInput): HomeStatusView {
  const serverStatus = input.record.patient.status;
  const status: Status = input.stale && serverStatus === "green" ? "unknown" : serverStatus;
  const lines = [deviceText(serverStatus, input)];
  if (input.stale && serverStatus !== "green") lines.push(input.t.status.staleAsOf(staleDate(input)));
  return { status, lines, evaluatedAt: null, coverage: [], reasons: [], serverOnly: !input.stale };
}

export function homeStatusView(input: HomeStatusInput): HomeStatusView {
  return input.live ? liveStatus(input) : deviceStatus(input);
}
