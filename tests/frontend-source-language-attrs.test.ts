import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { claimParameterRows } from "../src/components/doctor/care/report-claims";
import { directionFor } from "../src/lib/client/document-language";

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsxFiles(path) : name.endsWith(".tsx") ? [path] : [];
  });
}

// ---------------------------------------------------------------------------
// 1. Localized system copy declares its own language/direction at its root
// ---------------------------------------------------------------------------

test("localized error/status roots declare the selected language and direction themselves", () => {
  assert.equal(directionFor("ar"), "rtl");
  assert.equal(directionFor("fr"), "ltr");

  const error = read("src/components/doctor/shared/ApiErrorState.tsx");
  // Box-less root: no layout box, no role; independent of CSS chunk order.
  assert.match(error, /const BOX_LESS: CSSProperties = Object\.freeze\(\{ display: "contents" \}\);/);
  assert.match(error, /return \{ lang: language, dir: directionFor\(language\), style: BOX_LESS \};/);
  assert.match(error, /<div \{\.\.\.selectedLanguageRoot\(language\)\}>\s*<ErrorState/);
  const rootDeclaration = error.slice(error.indexOf("export function selectedLanguageRoot"), error.indexOf("interface ApiErrorStateProps"));
  assert.doesNotMatch(rootDeclaration, /\brole\s*[:=]/, "the wrapper attributes add no role");
  // Same selected-language source as before: the explicit override, else the clinician shell context.
  assert.match(error, /const language = lang \?\? shell\.lang;/);
  // A caller's override title is not falsely tagged with the selected language.
  assert.match(error, /title=\{title !== undefined \? <span \{\.\.\.UNKNOWN_LANGUAGE_TEXT\}>\{title\}<\/span> : description\.title\}/);

  const sync = read("src/components/doctor/shared/SyncStatus.tsx");
  assert.match(sync, /<p className=\{stale \? `\$\{styles\.chip\} \$\{styles\.stale\}` : styles\.chip\} lang=\{language\} dir=\{directionFor\(language\)\}>/);
  const stale = sync.slice(sync.indexOf("export function StaleNotice"));
  assert.match(stale, /<div \{\.\.\.selectedLanguageRoot\(language\)\}>\s*<Notice/);
  for (const source of [error, sync]) assert.match(source, /const language = lang \?\? shell\.lang;/);
  // No second language preference: only the existing clinician context is read.
  for (const source of [error, sync]) assert.doesNotMatch(source, /localStorage|useLanguagePreference|readStoredLanguage/);
});

test("the record panel is still a known-French island, so the self-declaring roots matter inside it", () => {
  const view = read("src/components/doctor/record/PatientRecordView.tsx");
  assert.match(view, /<div \{\.\.\.FRENCH_SOURCE\} className=\{styles\.panelBody\}>/);
});

// ---------------------------------------------------------------------------
// 2. Report rows: verbatim sent text is not guessed French
// ---------------------------------------------------------------------------

/** Same rule as ReportClaims.sentVerbatimText (checked statically below). */
const verbatim = (parameters: Record<string, string | number | boolean>) =>
  claimParameterRows(parameters).map((row) => {
    const raw = Object.hasOwn(parameters, row.key) ? parameters[row.key] : undefined;
    return [row.key, typeof raw === "string" && row.value === raw] as const;
  });

test("report rows: the external-note text and other unmapped text are sent verbatim (unknown language)", () => {
  assert.deepEqual(verbatim({ verification: "external_unverified", note: "متابعة الضغط · suivi tension" }), [
    ["verification", false],
    ["note", true],
  ]);
  // A typed label, an unmapped token, a literal (invalid) date: shown as sent, so not marked French.
  assert.deepEqual(verbatim({ label: "ضغط الدم", code: "hypertension", value: "Pénicilline", exam: "HbA1c", date: "10/01/2026" }), [
    ["label", true],
    ["code", false],
    ["value", true],
    ["exam", true],
    ["date", true],
  ]);
});

test("report rows: French vocabulary, formatted dates, numbers and Oui/Non stay in the report's French island", () => {
  assert.deepEqual(
    verbatim({
      polarity: "affirmed",
      kind: "blood_pressure",
      code: "hypertension",
      label: "hypertension",
      labelKey: "hypothesis.review_required",
      measuredAt: "2026-10-10T08:00:00.000Z",
      systolic: 142,
      flagged: true,
    }),
    [
      ["polarity", false],
      ["kind", false],
      ["code", false],
      ["label", false],
      ["labelKey", false],
      ["measuredAt", false],
      ["systolic", false],
      ["flagged", false],
    ],
  );
});

test("report rows: ReportClaims applies the unknown-language boundary only to verbatim values, never rewriting them", () => {
  const view = read("src/components/doctor/care/ReportClaims.tsx");
  assert.match(view, /const raw = Object\.hasOwn\(parameters, row\.key\) \? parameters\[row\.key\] : undefined;\s*return typeof raw === "string" && row\.value === raw;/);
  assert.match(view, /<dd \{\.\.\.\(sentVerbatimText\(row, claim\.parameters\) \? UNKNOWN_LANGUAGE_TEXT : \{\}\)\}>\{row\.value\}<\/dd>/);
  assert.match(view, /<dt>\{row\.label\}<\/dt>/, "French labels keep the island's language");
  assert.match(view, /<div className=\{styles\.stack\} lang="fr" dir="ltr">/, "the report itself stays a French island");
});

// ---------------------------------------------------------------------------
// 3. Every clinician free-text TextArea opts out of the French island
// ---------------------------------------------------------------------------

const FREE_TEXT_FILES = [
  "src/components/doctor/review/CandidateReviewForm.tsx",
  "src/components/doctor/review/ResultFields.tsx",
  "src/components/doctor/comms/ReasonDialog.tsx",
  "src/components/doctor/comms/MessageComposer.tsx",
  "src/components/doctor/care/ProtocolForm.tsx",
  "src/components/doctor/care/ProposalReviewDialog.tsx",
  "src/components/doctor/care/ProtocolStateDialog.tsx",
  "src/components/doctor/alerts/AlertActions.tsx",
];

test("every doctor TextArea carries the unknown-language attributes on the editable element itself", () => {
  const withTextArea = tsxFiles(join(process.cwd(), "src", "components", "doctor"))
    .filter((file) => readFileSync(file, "utf8").includes("<TextArea"))
    .map((file) => file.slice(process.cwd().length + 1))
    .sort();
  assert.deepEqual(withTextArea, [...FREE_TEXT_FILES].sort(), "no free-text TextArea is left out (new ones must opt in)");
  for (const file of FREE_TEXT_FILES) {
    const source = read(file);
    const areas = source.match(/<TextArea\b/g)?.length ?? 0;
    const tagged = source.match(/<TextArea\s+\{\.\.\.UNKNOWN_LANGUAGE_TEXT\}/g)?.length ?? 0;
    assert.ok(areas > 0, file);
    assert.equal(tagged, areas, `${file}: every TextArea is tagged`);
    // Only the editable element: the French label/hint around it is not re-tagged.
    assert.equal(source.match(/\{\.\.\.UNKNOWN_LANGUAGE_TEXT\}/g)?.length, areas, `${file}: nothing else is tagged`);
    assert.match(source, /import \{ UNKNOWN_LANGUAGE_TEXT \} from "@\/components\/layout\/source-language";/);
  }
  // French labels are preserved as written.
  assert.match(read("src/components/doctor/comms/ReasonDialog.tsx"), /<Field label="Motif" htmlFor=\{reasonId\}/);
  assert.match(read("src/components/doctor/alerts/AlertActions.tsx"), /<Field label="Note de suivi" htmlFor=\{noteId\}/);
});
