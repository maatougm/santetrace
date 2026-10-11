import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { DoctorQueueSummary } from "../src/contracts/patient-platform";
import type { Language, Status } from "../src/lib/client/api";
import { statusLabel } from "../src/lib/client/format";
import { CLINICIAN_SHELL_COPY, SHELL_COPY, clinicianNav } from "../src/components/layout/shell-copy";
import { isNavActive } from "../src/components/layout/nav";
import {
  DASHBOARD_COPY,
  FRESHNESS_COPY,
  filterButtonLabel,
  filterSummaryLabel,
  freshnessAge,
  newAlertsText,
  pendingWorkText,
  resultText,
  scoreUnavailableText,
  urgencyLabel,
  workerRunningText,
} from "../src/components/doctor/dashboard/dashboard-copy";
import { priorityDisplay, type QueueRow } from "../src/components/doctor/dashboard/queue";
import { QUEUE_FILTERS, type QueueFilterCounts } from "../src/components/doctor/dashboard/queue-filter";
import { pendingWorkSummary } from "../src/components/doctor/dashboard/row-indicators";
import { AI_SCORE_LABEL, queueScoreView } from "../src/components/doctor/record/ai-case-score-view";
import { FRENCH_SOURCE, UNKNOWN_LANGUAGE_TEXT, authoredTextAttrs } from "../src/components/layout/source-language";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");
const ARABIC = /[؀-ۿ]/;
const LANGS: readonly Language[] = ["fr", "ar"];

/** Every string leaf of a copy object; functions are called with representative arguments. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") return [[path, String((value as (...args: unknown[]) => unknown)(7, "10:00:00"))]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
  }
  return [];
}

function assertParity(name: string, fr: unknown, ar: unknown, latinInArabic: readonly string[] = []): void {
  const frLeaves = leaves(fr);
  const arLeaves = leaves(ar);
  assert.deepEqual(
    arLeaves.map(([path]) => path),
    frLeaves.map(([path]) => path),
    `${name}: same keys in fr and ar`,
  );
  for (const [path, text] of frLeaves) assert.ok(text.trim().length > 0, `${name}.fr.${path} is empty`);
  for (const [path, text] of arLeaves) {
    assert.ok(text.trim().length > 0, `${name}.ar.${path} is empty`);
    if (!latinInArabic.includes(path)) assert.match(text, ARABIC, `${name}.ar.${path} is not Arabic: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Copy parity
// ---------------------------------------------------------------------------

test("clinician shell copy has fr/ar parity, Arabic values and keeps the Santetrace brand", () => {
  assertParity("CLINICIAN_SHELL_COPY", CLINICIAN_SHELL_COPY.fr, CLINICIAN_SHELL_COPY.ar, ["languageSwitchLabel"]);
  assertParity("SHELL_COPY", SHELL_COPY.fr, SHELL_COPY.ar);
  // The toggle shows the other language's name, written in that language.
  assert.equal(CLINICIAN_SHELL_COPY.fr.languageSwitchLabel, "العربية");
  assert.equal(CLINICIAN_SHELL_COPY.ar.languageSwitchLabel, "Français");
  for (const lang of LANGS) {
    assert.match(CLINICIAN_SHELL_COPY[lang].brandHome, /^Santetrace — /, lang);
    for (const [path, text] of leaves(CLINICIAN_SHELL_COPY[lang])) assert.doesNotMatch(text, /Sentetrace/, `${lang}.${path}`);
  }
  // The French logout-stopped wording is unchanged by the move into the copy module.
  assert.equal(CLINICIAN_SHELL_COPY.fr.logoutStoppedTitle, "Déconnexion interrompue");
  assert.equal(CLINICIAN_SHELL_COPY.fr.logoutRetry, "Réessayer la déconnexion");
});

test("dashboard and freshness copy have fr/ar parity with Arabic-script values", () => {
  assertParity("DASHBOARD_COPY", DASHBOARD_COPY.fr, DASHBOARD_COPY.ar);
  // The separator is punctuation only (French spaced colon vs Arabic colon).
  assertParity("FRESHNESS_COPY", FRESHNESS_COPY.fr, FRESHNESS_COPY.ar, ["labelSeparator"]);
  for (const [path, text] of leaves(DASHBOARD_COPY.fr)) assert.doesNotMatch(text, ARABIC, `fr.${path} contains Arabic`);
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test("clinician nav localizes labels only: hrefs, icons and active matching are identical", () => {
  const fr = clinicianNav("fr");
  const ar = clinicianNav("ar");
  assert.deepEqual(
    fr.map((item) => item.label),
    ["Patients", "Invitations"],
    "French labels unchanged",
  );
  const shape = (items: typeof fr) => items.map(({ href, icon, exact, matches }) => ({ href, icon, exact, matches }));
  assert.deepEqual(shape(ar), shape(fr));
  for (const item of ar) assert.match(item.label, ARABIC, item.href);
  for (const path of ["/doctor", "/doctor/patients/p1", "/doctor/patients/p1/documents/d1", "/doctor/invitations", "/doctor/x", "/patient"]) {
    assert.deepEqual(
      ar.map((item) => isNavActive(path, item)),
      fr.map((item) => isNavActive(path, item)),
      path,
    );
  }
  assert.equal(isNavActive("/doctor/patients/p1", fr[0]), true, "record pages keep Patients active");
  assert.notEqual(clinicianNav("fr"), clinicianNav("fr"), "a new array per call (no shared mutable nav)");
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const COUNTS: QueueFilterCounts = { all: 12, red: 2, orange: 3, pending: 4, review: 5 };

test("filter labels keep the clinical group names and order (no renaming)", () => {
  assert.deepEqual(DASHBOARD_COPY.fr.filters, {
    all: "Tous",
    red: "Priorité haute",
    orange: "Suivi requis",
    pending: "En attente pour vous",
    review: "À vérifier",
  });
  assert.deepEqual(Object.keys(DASHBOARD_COPY.ar.filters), [...QUEUE_FILTERS]);
  assert.deepEqual(Object.keys(DASHBOARD_COPY.fr.filters), [...QUEUE_FILTERS]);
  // Priority groups reuse the status vocabulary in both languages.
  for (const lang of LANGS) {
    assert.equal(DASHBOARD_COPY[lang].filters.red, statusLabel("red", lang));
    assert.equal(DASHBOARD_COPY[lang].filters.orange, statusLabel("orange", lang));
  }
});

test("the filter summary names the active filter and its true count for every filter in fr and ar", () => {
  assert.equal(filterSummaryLabel("all", COUNTS, "fr"), "Filtres · Tous (12)");
  assert.equal(filterSummaryLabel("red", COUNTS, "fr"), "Filtres · Priorité haute (2)");
  assert.equal(filterSummaryLabel("all", COUNTS, "ar"), "التصفية · الكل (12)");
  for (const lang of LANGS) {
    for (const filter of QUEUE_FILTERS) {
      const summary = filterSummaryLabel(filter, COUNTS, lang);
      assert.ok(summary.startsWith(`${DASHBOARD_COPY[lang].filtersSummary} · `), summary);
      assert.ok(summary.includes(DASHBOARD_COPY[lang].filters[filter]), `${lang}/${filter}: ${summary}`);
      assert.ok(summary.endsWith(`(${COUNTS[filter]})`), `${lang}/${filter}: ${summary}`);
      assert.equal(filterButtonLabel(filter, COUNTS, lang), `${DASHBOARD_COPY[lang].filters[filter]} (${COUNTS[filter]})`);
    }
  }
  // A zero count is shown as 0 for a genuinely empty filter, never dropped.
  assert.equal(filterSummaryLabel("pending", { ...COUNTS, pending: 0 }, "fr"), "Filtres · En attente pour vous (0)");
});

// ---------------------------------------------------------------------------
// Rows: urgency label, estimate, indicators
// ---------------------------------------------------------------------------

function row(status: Status, shared: boolean): Pick<QueueRow, "patient" | "priority"> {
  return {
    priority: status,
    patient: { id: "p", displayName: "P", access: { owner: false, scopes: shared ? ["status"] : [] } } as never,
  };
}

test("urgency label: French is exactly priorityDisplay's label; status and colour are never changed", () => {
  for (const status of ["red", "orange", "unknown", "green"] as const) {
    for (const shared of [true, false]) {
      const display = priorityDisplay(row(status, shared));
      assert.equal(display.status, status);
      assert.equal(urgencyLabel(display, "fr"), display.label, `${status}/${shared}`);
      const ar = urgencyLabel(display, "ar");
      assert.match(ar, ARABIC);
      assert.equal(ar, shared ? statusLabel(status, "ar") : DASHBOARD_COPY.ar.statusNotShared);
    }
  }
});

test("estimate: the honest no-value reasons are localized, the label stays 'à revoir'", () => {
  const notEligible = queueScoreView(null, false);
  const notComputed = queueScoreView(null, true);
  assert.equal(notEligible.kind, "none");
  assert.equal(notComputed.kind, "none");
  if (notEligible.kind !== "none" || notComputed.kind !== "none") return;
  assert.deepEqual(scoreUnavailableText(notEligible.text, "fr"), { text: notEligible.text, lang: "fr" });
  assert.deepEqual(scoreUnavailableText(notEligible.text, "ar"), { text: DASHBOARD_COPY.ar.scoreNotEligible, lang: "ar" });
  assert.deepEqual(scoreUnavailableText(notComputed.text, "ar"), { text: DASHBOARD_COPY.ar.scoreNotComputed, lang: "ar" });
  // An unknown French reason is never machine-translated: it stays French, marked as such.
  assert.deepEqual(scoreUnavailableText("Raison serveur inconnue", "ar"), { text: "Raison serveur inconnue", lang: "fr" });
  assert.equal(DASHBOARD_COPY.fr.scoreLabel, AI_SCORE_LABEL);
  assert.equal(DASHBOARD_COPY.fr.scoreNote, "IA · à revoir");
  // A genuine value is passed through untouched (display only).
  assert.deepEqual(queueScoreView({ value: 62 } as never, true), { kind: "value", value: 62 });
});

const IDLE: DoctorQueueSummary = {
  clinicalMessages: { count: 0, oldestAt: null },
  contactRequests: { count: 0, oldestAt: null },
  proposals: { awaitingReview: 0, needsInputs: 0, oldestAt: null },
  planReview: { overdue: false, dueAt: null },
  blockedProtocols: { count: 0, oldestAt: null },
  oldestPendingAt: null,
};

test("pending-work text: French is pendingWorkSummary verbatim, Arabic lists the same counters", () => {
  const busy: DoctorQueueSummary = {
    ...IDLE,
    clinicalMessages: { count: 2, oldestAt: "2026-10-11T06:00:00.000Z" },
    proposals: { awaitingReview: 1, needsInputs: 3, oldestAt: null },
    planReview: { overdue: true, dueAt: null },
  };
  assert.equal(pendingWorkText(busy, "fr"), pendingWorkSummary(busy));
  const ar = pendingWorkText(busy, "ar");
  assert.ok(ar);
  assert.match(ar, ARABIC);
  assert.equal(ar.split("، ").length, (pendingWorkSummary(busy) ?? "").split(", ").length);
  assert.match(ar, /2/);
  for (const queue of [IDLE, null, { ...IDLE, proposals: { awaitingReview: 0, needsInputs: 2, oldestAt: null } }]) {
    assert.equal(pendingWorkText(queue, "fr"), null);
    assert.equal(pendingWorkText(queue, "ar"), null, "work waiting on the patient is not the doctor's");
  }
  const unshared: DoctorQueueSummary = { clinicalMessages: null, contactRequests: null, proposals: null, planReview: null, blockedProtocols: null, oldestPendingAt: null };
  assert.equal(pendingWorkText(unshared, "ar"), null, "unshared is never counted");
});

test("result line, new alerts, freshness and worker texts keep French wording and real numbers", () => {
  assert.equal(resultText(12, 12, "fr"), "12 patients");
  assert.equal(resultText(1, 1, "fr"), "1 patient");
  assert.equal(resultText(3, 12, "fr"), "3 sur 12 patients affichés");
  assert.equal(newAlertsText(1, "fr"), "1 nouvelle alerte");
  assert.equal(newAlertsText(2, "fr"), "2 nouvelles alertes");
  for (const text of [resultText(3, 12, "ar"), newAlertsText(2, "ar"), workerRunningText(4_000, "ar")]) assert.match(text, ARABIC);
  assert.match(resultText(3, 12, "ar"), /3[^0-9]+12/);

  const now = Date.UTC(2026, 9, 11, 10, 0, 0);
  const clock = () => "09:00:00";
  assert.equal(freshnessAge(now - 5_000, now, "fr", clock), "il y a 5 s");
  assert.equal(freshnessAge(now - 180_000, now, "fr", clock), "il y a 3 min");
  assert.equal(freshnessAge(now - 3_600_000, now, "fr", clock), "à 09:00:00");
  assert.equal(freshnessAge(now + 5_000, now, "fr", clock), "il y a 0 s", "a device clock ahead never shows a future age");
  assert.match(freshnessAge(now - 5_000, now, "ar", clock), /5/);
  assert.match(freshnessAge(now - 3_600_000, now, "ar", clock), /09:00:00/);
  assert.equal(workerRunningText(4_400, "fr"), "Surveillance automatique active · signal il y a 4 s");
});

// ---------------------------------------------------------------------------
// Static guarantees on the components
// ---------------------------------------------------------------------------

test("the clinician shell follows the selected language and wraps the language provider", () => {
  const shell = read("src/components/layout/ClinicianShell.tsx");
  assert.doesNotMatch(shell, /SHELL_COPY\.fr/);
  assert.doesNotMatch(shell, /lang="fr"/);
  assert.doesNotMatch(shell, /Sentetrace/);
  assert.match(shell, /<ClinicianLanguageProvider>/);
  assert.match(shell, /<RequireSession role="clinician" lang=\{lang\}>/);
  assert.match(shell, /<ConnectionBadge[^>]*lang=\{lang\}/);
  assert.match(shell, /<LanguageToggle \/>/);
  assert.match(shell, /setLanguage\(next\)/);
  // No French UI literal left in the shell markup (copy lives in shell-copy.ts).
  assert.doesNotMatch(shell, /Déconnexion|liste des patients|Réessayer/);
  assert.match(read("src/components/layout/ClinicianShell.module.css"), /\.langToggle \{[^}]*height: var\(--touch-min\)/);
});

test("the queue table renders the server estimate as-is and never sorts", () => {
  const table = read("src/components/doctor/dashboard/PatientTable.tsx");
  assert.match(table, /queueScoreView\(dashboardAiCaseScore\(row\.patient\), aiCaseScoreEligible\(row\.patient\.access\)\)/);
  assert.match(table, /rows\.map\(\(row\) =>/);
  assert.match(table, /const display = priorityDisplay\(row\);/);
  assert.match(table, /data-priority=\{display\.status\}/);
  assert.match(table, /<StatusBadge status=\{display\.status\}/);
  assert.match(table, /className=\{styles\.patientLink\}/);
  assert.match(table, /shouldOpenFromRow/);
  for (const file of ["PatientTable.tsx", "ScoreCell.tsx", "PatientQueue.tsx", "QueueToolbar.tsx"]) {
    const source = read("src/components/doctor/dashboard", file);
    assert.doesNotMatch(source, /\.sort\(|toSorted|\.reverse\(/, file);
  }
  assert.match(read("src/components/doctor/dashboard/PatientQueue.tsx"), /<PatientTable rows=\{shown\}/);
  assert.doesNotMatch(read("src/components/doctor/dashboard/ScoreCell.tsx"), /Math\./, "the estimate is never computed");
});

test("phone filters: one native disclosure over the five existing buttons, visible inline from 768px", () => {
  const toolbar = read("src/components/doctor/dashboard/QueueToolbar.tsx");
  // Phones and server render: open is undefined → native disclosure, collapsed by default.
  // From 768px it is held open (summary hidden), so the buttons stay focusable without ::details-content.
  assert.match(toolbar, /const wide = useMediaQuery\("\(min-width: 768px\)"\);/);
  assert.match(toolbar, /<details className=\{styles\.filterDisclosure\} open=\{wide \|\| undefined\}>/, "never open by default on phones");
  // Executable CSS only (comments stripped): no rule may depend on the ::details-content pseudo-element.
  const executableCss = read("src/components/doctor/dashboard/Dashboard.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(executableCss, /::details-content/);
  assert.match(toolbar, /<summary className=\{styles\.filterSummary\}>/);
  assert.match(toolbar, /filterSummaryLabel\(filter, counts, lang\)/);
  assert.equal(toolbar.match(/QUEUE_FILTERS\.map/g)?.length, 1, "one set of buttons");
  const css = read("src/components/doctor/dashboard/Dashboard.module.css");
  assert.match(css, /\.filterSummary \{[^}]*min-height: var\(--touch-min\);[^}]*font-size: var\(--text-base\);/);
  assert.match(css, /@media \(min-width: 768px\)[\s\S]*\.filterSummary \{\s*display: none;/);
});

test("touched styles use tokens only (no hex colours) and logical properties", () => {
  for (const file of [
    "src/components/doctor/dashboard/Dashboard.module.css",
    "src/components/layout/ClinicianShell.module.css",
    "src/components/doctor/shared/SyncStatus.module.css",
  ]) {
    const css = read(file);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, file);
    assert.doesNotMatch(css, /(margin|padding)-(left|right)|text-align: (left|right)|\b(left|right):/, file);
  }
});

test("freshness and error UI keep backward-compatible props with an optional language", () => {
  const sync = read("src/components/doctor/shared/SyncStatus.tsx");
  const error = read("src/components/doctor/shared/ApiErrorState.tsx");
  assert.match(sync, /lastSuccessAt: number \| null;\s*error: ApiError \| null;\s*isRefreshing: boolean;/);
  assert.match(sync, /lang\?: Language;/);
  assert.match(error, /lang\?: Language;/);
  assert.match(error, /export function errorText\(error: unknown, lang: Language = "fr"\)/);
});

// ---------------------------------------------------------------------------
// Source-language boundaries: French islands vs authored text of unknown language
// ---------------------------------------------------------------------------

test("source text: known French content is fr/ltr; authored text of unknown language is lang='' + dir=auto", () => {
  assert.deepEqual({ ...FRENCH_SOURCE }, { lang: "fr", dir: "ltr" });
  assert.deepEqual({ ...UNKNOWN_LANGUAGE_TEXT }, { lang: "", dir: "auto" });
  // Never guessed: no metadata, malformed or non-string values stay "unknown"; direction is always automatic.
  for (const value of [undefined, null, "", "arabic", "AR", "fr_FR", "123", 42 as unknown as string]) {
    assert.deepEqual(authoredTextAttrs(value), { lang: "", dir: "auto" }, String(value));
  }
  // A recorded, well-formed tag is kept as is; direction still follows the text itself.
  assert.deepEqual(authoredTextAttrs("ar"), { lang: "ar", dir: "auto" });
  assert.deepEqual(authoredTextAttrs("ar-TN"), { lang: "ar-TN", dir: "auto" });
  assert.deepEqual(authoredTextAttrs("fr"), { lang: "fr", dir: "auto" });
  assert.notEqual(authoredTextAttrs("ar"), authoredTextAttrs("ar"), "a new object each call");
});

test("source text: message text, review reason, external note text and the composer opt out of the French island", () => {
  const item = read("src/components/doctor/comms/MessageItem.tsx");
  assert.match(item, /<p className=\{styles\.messageText\} \{\.\.\.UNKNOWN_LANGUAGE_TEXT\}>\s*\{message\.text\}/);
  assert.match(item, /<span \{\.\.\.UNKNOWN_LANGUAGE_TEXT\}>\{review\.reason\}<\/span>/);
  const notes = read("src/components/doctor/record/ExternalNotesSection.tsx");
  assert.match(notes, /<p className=\{styles\.externalNoteText\} \{\.\.\.UNKNOWN_LANGUAGE_TEXT\}>\s*\{note\.text\}/);
  const composer = read("src/components/doctor/comms/MessageComposer.tsx");
  assert.match(composer, /<TextArea\s+\{\.\.\.UNKNOWN_LANGUAGE_TEXT\}/);
  // The text is rendered as-is: no translation or rewriting helpers around authored values.
  for (const source of [item, notes, composer]) assert.doesNotMatch(source, /translate|toLocaleUpperCase|normalize\(/);
});

test("source text: the record's localized error state is marked with the shell language, never a French override", () => {
  const view = read("src/components/doctor/record/PatientRecordView.tsx");
  const unavailable = view.slice(view.indexOf("function RecordUnavailable"), view.indexOf("export function PatientRecordView"));
  assert.ok(unavailable.length > 0);
  assert.doesNotMatch(unavailable, /FRENCH_SOURCE/, "the localized error copy is not inside a French island");
  assert.match(unavailable, /<div lang=\{lang\} dir=\{directionFor\(lang\)\}>\s*<ApiErrorState error=\{error\} onRetry=\{onRetry\} lang=\{lang\} \/>/);
  // Known French clinical islands are kept: situation/AI cards and the section panel body.
  const main = view.slice(view.indexOf("export function PatientRecordView"));
  assert.equal(main.match(/\{\.\.\.FRENCH_SOURCE\}/g)?.length, 2);
});
