import assert from "node:assert/strict";
import test from "node:test";
import { displayableEvaluationTime, reasonText } from "../src/lib/client/copy/reasons";

test("known server reasons are shown in French and Arabic", () => {
  const reason = "No current condition evaluations are available.";
  assert.deepEqual(reasonText(reason, "fr"), { text: "Aucune évaluation de suivi n’est encore disponible.", translated: true });
  assert.equal(reasonText(reason, "ar").translated, true);
  assert.match(reasonText(reason, "ar").text, /[؀-ۿ]/);
});

test("threshold templates keep the exact values, unit and rule version", () => {
  const fr = reasonText("Systolic 182 mmHg >= 180 mmHg (red; demo rule demo-bp-1).", "fr");
  assert.equal(fr.translated, true);
  assert.equal(fr.text, "Systolique 182 mmHg ≥ seuil 180 mmHg (priorité haute ; règle de démonstration demo-bp-1).");
  const ar = reasonText("Glucose 7.4 mmol/L >= 7 mmol/L (orange; demo rule g-2).", "ar");
  assert.equal(ar.translated, true);
  assert.ok(ar.text.includes("7.4 mmol/L") && ar.text.includes("g-2"));
});

test("requirement gap reasons are translated with their requirement id", () => {
  const text = reasonText("Requirement demo_glucose:reading: the latest admitted evidence has expired.", "fr");
  assert.deepEqual(text, { text: "Exigence demo_glucose:reading : la dernière donnée admise est trop ancienne.", translated: true });
});

test("unknown reasons are returned verbatim and flagged untranslated, never guessed", () => {
  const reason = "Some future server reason.";
  assert.deepEqual(reasonText(reason, "fr"), { text: reason, translated: false });
  assert.deepEqual(reasonText("Requirement x: unknown gap detail.", "ar"), { text: "Requirement x: unknown gap detail.", translated: false });
  assert.deepEqual(reasonText("toString", "fr"), { text: "toString", translated: false });
});

test("the epoch 'never evaluated' sentinel is not displayed as a time (no '57 ans')", () => {
  assert.equal(displayableEvaluationTime("1970-01-01T00:00:00.000Z"), null);
  assert.equal(displayableEvaluationTime(new Date(0).toISOString()), null);
  assert.equal(displayableEvaluationTime(""), null);
  assert.equal(displayableEvaluationTime(null), null);
  assert.equal(displayableEvaluationTime("not a date"), null);
  assert.equal(displayableEvaluationTime("2026-10-11T08:00:00.000Z"), "2026-10-11T08:00:00.000Z");
});
