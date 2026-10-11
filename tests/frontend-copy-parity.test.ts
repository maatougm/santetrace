import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_COPY } from "../src/lib/client/copy/access";
import { ASSIST_COPY } from "../src/lib/client/copy/assist";
import { CARE_COPY, claimCodeLabel, questionLabel, templateText } from "../src/lib/client/copy/care";
import { SHARE_COPY } from "../src/lib/client/copy/share";
import { getMessages } from "../src/lib/client/i18n";
import { SIGN_IN_COPY } from "../src/components/auth/sign-in-copy";
import { CLAIM_CODES, ONBOARDING_QUESTIONS } from "../src/lib/monitoring-content";

type Leaf = { path: string; kind: "string" | "function"; arity?: number; value?: string };

function leaves(value: unknown, path = ""): Leaf[] {
  if (typeof value === "string") return [{ path, kind: "string", value }];
  if (typeof value === "function") return [{ path, kind: "function", arity: value.length }];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) {
    return Object.keys(value)
      .sort()
      .flatMap((key) => leaves((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return [{ path, kind: "string", value: String(value) }];
}

const MODULES: [string, { fr: unknown; ar: unknown }][] = [
  ["care", CARE_COPY],
  ["access", ACCESS_COPY],
  ["assist", ASSIST_COPY],
  ["share", SHARE_COPY],
  ["patient i18n", { fr: getMessages("fr"), ar: getMessages("ar") }],
  ["sign-in", SIGN_IN_COPY],
];

for (const [name, copy] of MODULES) {
  test(`${name}: French and Arabic have the same keys, kinds and function arities`, () => {
    const fr = leaves(copy.fr).map(({ path, kind, arity }) => ({ path, kind, arity }));
    const ar = leaves(copy.ar).map(({ path, kind, arity }) => ({ path, kind, arity }));
    assert.deepEqual(ar, fr);
  });

  test(`${name}: no empty string, and Arabic strings are actually Arabic where French has letters`, () => {
    // Intentionally empty in French only: the note says "this server text is French", useless in French.
    const intentionallyEmpty = new Set(["fr.summary.serverLanguage"]);
    for (const lang of ["fr", "ar"] as const) {
      for (const leaf of leaves(copy[lang])) {
        if (leaf.kind !== "string" || intentionallyEmpty.has(`${lang}.${leaf.path}`)) continue;
        assert.ok(leaf.value && leaf.value.trim().length > 0, `${lang}.${leaf.path} is empty`);
      }
    }
    const arabicLetters = /[؀-ۿ]/;
    const untranslated = leaves(copy.ar).filter(
      (leaf) => leaf.kind === "string" && /[A-Za-zÀ-ÿ]{4,}/.test(leaf.value ?? "") && !arabicLetters.test(leaf.value ?? ""),
    );
    // Allowed Latin-only leaves: brand name, language switch labels and icon names.
    const allowed = untranslated.filter((leaf) => !/(appName|langToggle|language|switchLabel|\.icon$)/.test(leaf.path));
    assert.deepEqual(allowed.map((leaf) => leaf.path), []);
  });
}

test("every onboarding question in the server registry has a FR and AR label", () => {
  for (const question of ONBOARDING_QUESTIONS) {
    for (const lang of ["fr", "ar"] as const) {
      const label = questionLabel(question.labelKey, lang);
      assert.notEqual(label, CARE_COPY[lang].question.unknown, `${lang} label missing for ${question.labelKey}`);
    }
  }
});

test("every server claim code has a label; unknown codes and templates are labelled, never guessed", () => {
  for (const code of CLAIM_CODES) assert.notEqual(claimCodeLabel(code), CARE_COPY.fr.claimCode.unknown, code);
  assert.equal(claimCodeLabel("free_text_from_model"), CARE_COPY.fr.claimCode.unknown);
  assert.equal(templateText("dose.increase", "fr"), CARE_COPY.fr.template.unknown);
  assert.equal(templateText("toString", "ar"), CARE_COPY.ar.template.unknown, "prototype keys are not templates");
});

test("patient-facing copy never promises a call, a guaranteed reply or an automatic ambulance", () => {
  const patientText = JSON.stringify([CARE_COPY.fr.contact, CARE_COPY.fr.red, CARE_COPY.fr.plan]);
  assert.equal(/appel (établi|en cours|connecté)/i.test(patientText.replace("ce n’est pas un appel", "")), false);
  assert.match(CARE_COPY.fr.contactState.requested, /pas un appel/);
  assert.match(CARE_COPY.fr.contact.description, /Aucun délai de réponse n’est garanti/);
});
