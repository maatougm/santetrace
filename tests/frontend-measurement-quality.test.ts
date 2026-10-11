import assert from "node:assert/strict";
import test from "node:test";
import { isSuspectMeasurement, measurementQualityLabel } from "../src/lib/client/format";
import { SHARE_COPY } from "../src/lib/client/copy/share";

const connector = (quality: "accepted" | "suspect") => ({
  connectorId: "c1",
  deviceId: "d1",
  externalEventId: "e1",
  simulated: true,
  quality,
});

test("a connector reading flagged suspect is recognised; accepted and manual readings are not", () => {
  assert.equal(isSuspectMeasurement({ connector: connector("suspect") }), true);
  assert.equal(isSuspectMeasurement({ connector: connector("accepted") }), false);
  assert.equal(isSuspectMeasurement({}), false);
});

test("the suspect label matches the simulator wording in FR and AR, and is null otherwise", () => {
  for (const lang of ["fr", "ar"] as const) {
    assert.equal(measurementQualityLabel({ connector: connector("suspect") }, lang), SHARE_COPY[lang].simulator.quality.suspect);
    assert.equal(measurementQualityLabel({ connector: connector("accepted") }, lang), null);
    assert.equal(measurementQualityLabel({}, lang), null);
  }
});
