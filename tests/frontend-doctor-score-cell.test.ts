import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Language } from "../src/lib/client/api";
import { directionFor } from "../src/lib/client/document-language";
import { DASHBOARD_COPY, scoreUnavailableText } from "../src/components/doctor/dashboard/dashboard-copy";
import { queueScoreView, type QueueScoreView } from "../src/components/doctor/record/ai-case-score-view";

/**
 * Barrier 2 (docs/full-platform-usability-final.md): on a phone an unavailable
 * AI estimate showed only "—"; its reason lived in a tooltip and in
 * screen-reader-only text. The queue cell now shows that same localized reason
 * visibly, announced once, without changing eligibility, value or order.
 */

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), "utf8");
const ARABIC = /[؀-ۿ]/;
const LANGS: readonly Language[] = ["fr", "ar"];

const SCORE_CELL = read("src/components/doctor/dashboard/ScoreCell.tsx");
const NONE_START = SCORE_CELL.indexOf('view.kind === "none"');
const VALUE_START = SCORE_CELL.indexOf("<span className={styles.scoreValue}");
const NONE_BRANCH = SCORE_CELL.slice(NONE_START, VALUE_START);
const VALUE_BRANCH = SCORE_CELL.slice(VALUE_START);
const EXECUTABLE_CSS = read("src/components/doctor/dashboard/Dashboard.module.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = EXECUTABLE_CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}

function noneText(view: QueueScoreView): string {
  assert.equal(view.kind, "none");
  return view.kind === "none" ? view.text : "";
}

// ---------------------------------------------------------------------------
// Semantics: the visible reason is exactly the helper's localized text
// ---------------------------------------------------------------------------

const UNAVAILABLE_VIEWS = [
  { name: "not computed", view: queueScoreView(null, true), copyKey: "scoreNotComputed" },
  { name: "not available for your access", view: queueScoreView(null, false), copyKey: "scoreNotEligible" },
] as const;

test("visible reason: not-computed and not-eligible views show the localized reason with its own lang/dir", () => {
  for (const { name, view, copyKey } of UNAVAILABLE_VIEWS) {
    for (const lang of LANGS) {
      const reason = scoreUnavailableText(noneText(view), lang);
      assert.equal(reason.text, DASHBOARD_COPY[lang][copyKey], `${name}/${lang}: the visible text is the existing copy`);
      assert.notEqual(reason.text.trim(), "", `${name}/${lang}: never an empty reason`);
      assert.notEqual(reason.text, "—", `${name}/${lang}: the reason is more than the dash`);
      assert.equal(reason.lang, lang, `${name}/${lang}: a known reason is written in the shell language`);
      assert.equal(directionFor(reason.lang), lang === "ar" ? "rtl" : "ltr", `${name}/${lang}`);
      if (lang === "ar") assert.match(reason.text, ARABIC, `${name}: Arabic copy`);
      else assert.doesNotMatch(reason.text, ARABIC, `${name}: French copy`);
    }
  }
  // The French reasons are the queue view's own text, unchanged.
  assert.equal(scoreUnavailableText(noneText(queueScoreView(null, true)), "fr").text, "Non calculé");
  assert.equal(scoreUnavailableText(noneText(queueScoreView(null, false)), "fr").text, "Non disponible pour votre accès");
});

test("visible reason: an unknown, untranslated reason keeps its source text and French/LTR marking (never guessed)", () => {
  const source = "Motif serveur non répertorié";
  for (const lang of LANGS) {
    const reason = scoreUnavailableText(source, lang);
    assert.deepEqual(reason, { text: source, lang: "fr" }, `${lang}: source text kept, marked French`);
    assert.equal(directionFor(reason.lang), "ltr", `${lang}: French island stays LTR under any shell`);
    assert.doesNotMatch(reason.text, ARABIC, `${lang}: never machine-translated`);
  }
  // Neither Arabic queue reason is substituted for a text it does not match.
  assert.notEqual(scoreUnavailableText(source, "ar").text, DASHBOARD_COPY.ar.scoreNotComputed);
  assert.notEqual(scoreUnavailableText(source, "ar").text, DASHBOARD_COPY.ar.scoreNotEligible);
});

// ---------------------------------------------------------------------------
// Static: the none branch renders the reason visibly, announced once
// ---------------------------------------------------------------------------

test("none branch: the reason is a visible element carrying the helper's lang and the matching dir", () => {
  assert.ok(NONE_START >= 0 && VALUE_START > NONE_START, "none branch precedes the value branch");
  assert.match(NONE_BRANCH, /const reason = scoreUnavailableText\(view\.text, lang\);/);
  assert.match(
    NONE_BRANCH,
    /<span className=\{styles\.scoreReason\} lang=\{reason\.lang\} dir=\{directionFor\(reason\.lang\)\}>\s*\{reason\.text\}\s*<\/span>/,
  );
  assert.match(SCORE_CELL, /import \{ directionFor \} from "@\/lib\/client\/document-language";/);
});

test("none branch: the dash stays aria-hidden and the reason is announced exactly once", () => {
  assert.match(NONE_BRANCH, /<span className=\{styles\.scoreDash\} aria-hidden="true">\s*—\s*<\/span>/);
  assert.equal(NONE_BRANCH.match(/\{reason\.text\}/g)?.length, 1, "one copy of the reason in the markup");
  assert.doesNotMatch(NONE_BRANCH, /visually-hidden|VisuallyHidden/, "no screen-reader-only duplicate");
  assert.doesNotMatch(NONE_BRANCH, /title=/, "no tooltip duplicate of the visible reason");
  // The reason element itself is never hidden from assistive technology.
  const reasonTag = NONE_BRANCH.match(/<span className=\{styles\.scoreReason\}[^>]*>/)?.[0] ?? "";
  assert.ok(reasonTag.length > 0);
  assert.doesNotMatch(reasonTag, /aria-hidden|hidden/);
});

test("none branch: nothing is invented (the only literal text is the dash, no value or unit)", () => {
  const literals = [...NONE_BRANCH.matchAll(/>([^<>{}]+)</g)].map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(literals, ["—"]);
  assert.doesNotMatch(NONE_BRANCH, /view\.value|\/100|scoreNote|scoreLabel/);
});

test("value branch is unchanged: genuine server value, /100 unit, 'IA · à revoir' note and label", () => {
  assert.match(VALUE_BRANCH, /<span className=\{styles\.scoreValue\} title=\{copy\.scoreLabel\}>/);
  assert.match(VALUE_BRANCH, /<span className=\{styles\.score\} dir="ltr">/);
  assert.match(VALUE_BRANCH, /<data value=\{view\.value\}>\{view\.value\}<\/data>/);
  assert.match(VALUE_BRANCH, /<span className=\{styles\.scoreMax\}>\/100<\/span>/);
  assert.match(VALUE_BRANCH, /<span className=\{styles\.scoreNote\} aria-hidden="true">\s*\{copy\.scoreNote\}\s*<\/span>/);
  assert.match(VALUE_BRANCH, /<VisuallyHidden>\{copy\.scoreLabel\}<\/VisuallyHidden>/);
  assert.doesNotMatch(VALUE_BRANCH, /scoreReason|scoreUnavailableText/);
});

// ---------------------------------------------------------------------------
// Static: the reason wraps inside the cell with existing tokens only
// ---------------------------------------------------------------------------

test("CSS: the score reason wraps inside the cell, is never hidden, and uses tokens only", () => {
  const reason = ruleBody(".scoreReason");
  assert.match(reason, /overflow-wrap: anywhere;/, "long words break instead of overflowing at 320px");
  assert.match(reason, /max-inline-size: /, "bounded so it never pushes the patient or urgency column");
  assert.doesNotMatch(reason, /white-space: nowrap/);
  assert.match(reason, /font-size: var\(--text-(2xs|xs|sm)\);/);
  assert.match(reason, /color: var\(--color-ink-[23]\);/);
  assert.match(reason, /text-align: match-parent;/, "aligned with the cell, also for a French island in Arabic");
  assert.doesNotMatch(reason, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d+px/, "no new palette or raw sizes");
  // No rule anywhere (any breakpoint) hides the reason.
  for (const match of EXECUTABLE_CSS.matchAll(/([^{}]*\.scoreReason[^{}]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(match[2], /display: none|visibility: hidden|clip-path|position: absolute/, match[1].trim());
  }

  const dash = ruleBody(".scoreDash");
  assert.match(dash, /font-size: var\(--text-lg\);/, "the dash keeps its former size");
  const none = ruleBody(".scoreNone");
  assert.match(none, /flex-direction: column;/, "dash then reason, like value then note");
  assert.match(none, /color: var\(--color-ink-3\);/);
  for (const body of [dash, none]) assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
});

test("CSS: the stacked phone row still names the column above the dash and reason", () => {
  const phoneStart = EXECUTABLE_CSS.indexOf("@media (max-width: 519.98px)");
  assert.ok(phoneStart >= 0, "the stacked phone breakpoint exists");
  const phone = EXECUTABLE_CSS.slice(phoneStart);
  assert.match(phone, /\.scoreCell\[data-score="none"\] \.cellLabel \{\s*display: block;/);
  assert.match(phone, /\.row > \.scoreCell \{[^}]*flex-direction: column;/);
});

test("touched score files keep the Santetrace brand and no console output", () => {
  for (const file of ["src/components/doctor/dashboard/ScoreCell.tsx", "src/components/doctor/dashboard/Dashboard.module.css"]) {
    const source = read(file);
    assert.doesNotMatch(source, /Sentetrace/, file);
    assert.doesNotMatch(source, /console\./, file);
  }
});
