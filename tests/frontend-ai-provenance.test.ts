import assert from "node:assert/strict";
import test from "node:test";
import type { AiMeta } from "../src/contracts/monitoring";
import { ASSIST_COPY } from "../src/lib/client/copy/assist";
import { CARE_COPY } from "../src/lib/client/copy/care";

const MODES: readonly AiMeta["mode"][] = ["local_model", "cloud_model", "deterministic"];
const LANGS = ["fr", "ar"] as const;

test("every AI mode the contract can send has a French and Arabic label", () => {
  for (const lang of LANGS) {
    for (const mode of MODES) {
      const label = CARE_COPY[lang].aiMode[mode];
      assert.equal(typeof label, "string", `${lang}.${mode}`);
      assert.ok(label.trim().length > 0, `${lang}.${mode} is empty`);
    }
  }
});

test("a cloud answer never claims local processing or clinical validation", () => {
  const fr = CARE_COPY.fr.aiMode.cloud_model;
  assert.doesNotMatch(fr, /local|appareil|validé|clinique/i);
  assert.match(fr, /distant|externe/i);
  const ar = CARE_COPY.ar.aiMode.cloud_model;
  assert.doesNotMatch(ar, /محلي|الجهاز|معتمد/);
  assert.match(ar, /خارجية|عن بُعد/);
  assert.notEqual(fr, CARE_COPY.fr.aiMode.local_model);
  assert.notEqual(ar, CARE_COPY.ar.aiMode.local_model);
});

test("provider-unavailable wording is neutral: it does not say which provider failed", () => {
  for (const lang of LANGS) {
    const failure = CARE_COPY[lang].aiFailure.provider_unavailable;
    const assistant = ASSIST_COPY[lang].assistant.unavailableBody;
    for (const text of [failure, assistant]) {
      assert.doesNotMatch(text, /local|distant|externe|محلي|خارجية|عن بُعد/i, `${lang}: ${text}`);
    }
  }
});
