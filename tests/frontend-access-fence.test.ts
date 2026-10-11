import assert from "node:assert/strict";
import test from "node:test";
import { bindToFence, createAccessFence, fencedFetcher, runFenced } from "../src/lib/client/access-fence";
import { ApiError, CLIENT_ERROR_CODES } from "../src/lib/client/transport";

/** A promise the test resolves by hand, to hold a response "in flight". */
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const signal = new AbortController().signal;

test("a one-shot result held across a revocation is discarded, even when it succeeds", async () => {
  const fence = createAccessFence("doctor-a::patient-1");
  const report = held<{ text: string }>();
  const pending = runFenced(fence, () => report.promise);
  fence.revoke();
  report.resolve({ text: "late report" });
  assert.deepEqual(await pending, { status: "stale" });
  assert.equal(fence.denied(), true);
});

test("work started after a denial is refused without calling the server", async () => {
  const fence = createAccessFence("k");
  fence.revoke();
  let called = false;
  const result = await runFenced(fence, async () => {
    called = true;
    return 1;
  });
  assert.deepEqual(result, { status: "stale" });
  assert.equal(called, false);
});

test("a higher authority revision invalidates one-shot work started before it (downgrade while generating)", async () => {
  const fence = createAccessFence("k");
  assert.equal(fence.admitRevision(4), true);
  const proposals = held<string[]>();
  const pending = runFenced(fence, () => proposals.promise);
  // The record poll observes the patient narrowing the grant.
  assert.equal(fence.admitRevision(5), true);
  proposals.resolve(["draft from the broader grant"]);
  assert.deepEqual(await pending, { status: "stale" });
});

test("a one-shot result carrying an older authority revision than the highest seen is discarded", async () => {
  const fence = createAccessFence("k");
  fence.admitRevision(7);
  const result = await runFenced(fence, async () => ({ authorityRevision: 6 }), (value) => value.authorityRevision);
  assert.deepEqual(result, { status: "stale" });
  const current = await runFenced(fence, async () => ({ authorityRevision: 7 }), (value) => value.authorityRevision);
  assert.equal(current.status, "current");
});

test("poll fetcher: an older, broader answer cannot overwrite a newer downgrade", async () => {
  const fence = createAccessFence("k");
  const answers = [{ access: { authorityRevision: 3 }, documents: ["d1"] }, { access: { authorityRevision: 2 }, documents: ["d1", "d2"] }];
  let call = 0;
  const fetch = fencedFetcher(fence, async () => answers[call++], (r) => r.access.authorityRevision);
  assert.deepEqual(await fetch(signal), answers[0]);
  await assert.rejects(fetch(signal), (error: unknown) => error instanceof ApiError && error.code === CLIENT_ERROR_CODES.aborted);
});

test("poll fetcher: a response in flight across the denial cannot lift it; a request started afterwards can", async () => {
  const fence = createAccessFence("k");
  const first = held<{ rev: number }>();
  const fetchHeld = fencedFetcher(fence, () => first.promise, (r) => r.rev);
  const inFlight = fetchHeld(signal);
  fence.revoke();
  first.resolve({ rev: 1 });
  await assert.rejects(inFlight, (error: unknown) => error instanceof ApiError && error.isAborted);
  assert.equal(fence.denied(), true, "the held answer must not restore access");

  const fresh = fencedFetcher(fence, async () => ({ rev: 2 }), (r) => r.rev);
  assert.deepEqual(await fresh(signal), { rev: 2 });
  assert.equal(fence.denied(), false, "a new successful server answer re-grants");
});

test("subscribers hear revocations and authority changes, not same-revision polls", () => {
  const fence = createAccessFence("k");
  let events = 0;
  const unsubscribe = fence.subscribe(() => {
    events += 1;
  });
  fence.admitRevision(1);
  fence.admitRevision(1);
  fence.admitRevision(2);
  fence.revoke();
  unsubscribe();
  fence.revoke();
  assert.equal(events, 2);
});

test("actor switch: a fact save held for patient A cannot land in patient B's record", async () => {
  // Patient runtime stays mounted across the switch: only the fence/key changes.
  const fenceA = createAccessFence("actor-a::patient-a");
  let onScreen = fenceA;
  const recordB: { facts: string[] } = { facts: [] };
  const recordA: { facts: string[] } = { facts: [] };
  const mutateFromA = bindToFence(fenceA, () => onScreen, (fact: string) => recordA.facts.push(fact));

  const save = held<{ fact: string }>();
  const pending = runFenced(fenceA, () => save.promise);

  // Sign out A, sign in B in the same tab: the departing fence is retired.
  fenceA.retire();
  const fenceB = createAccessFence("actor-b::patient-b");
  onScreen = fenceB;
  const mutateFromB = bindToFence(fenceB, () => onScreen, (fact: string) => recordB.facts.push(fact));

  save.resolve({ fact: "hypertension (A)" });
  const result = await pending;
  assert.deepEqual(result, { status: "stale" });
  // Even a component that ignores the fence result and calls its captured mutate cannot write.
  mutateFromA("hypertension (A)");
  assert.deepEqual(recordA.facts, []);
  assert.deepEqual(recordB.facts, []);

  mutateFromB("diabète (B)");
  assert.deepEqual(recordB.facts, ["diabète (B)"], "the new actor's own callbacks still work");
});

test("a retired fence refuses new work and is never lifted by a later server answer", async () => {
  const fence = createAccessFence("a::p");
  fence.retire();
  assert.equal(fence.denied(), true);
  fence.restore();
  assert.equal(fence.denied(), true, "restore() lifts a denial, not a retirement");
  let called = false;
  const result = await runFenced(fence, async () => {
    called = true;
    return 1;
  });
  assert.deepEqual(result, { status: "stale" });
  assert.equal(called, false);
});

test("a held upload result is discarded when the clinician's grant is revoked while it runs", async () => {
  const fence = createAccessFence("doctor::patient");
  let onScreen = fence;
  const documents: string[] = [];
  const apply = bindToFence(fence, () => onScreen, (id: string) => documents.push(id));
  const upload = held<{ documentId: string }>();
  const pending = runFenced(fence, () => upload.promise);
  fence.revoke();
  upload.resolve({ documentId: "doc-1" });
  assert.deepEqual(await pending, { status: "stale" });
  apply("doc-1");
  assert.deepEqual(documents, []);
  onScreen = createAccessFence("doctor::other-patient");
  apply("doc-2");
  assert.deepEqual(documents, []);
});

test("development double-mount (retire then activate, same key) keeps the fence usable for new work", async () => {
  const fence = createAccessFence("a::p");
  fence.retire();
  fence.activate();
  assert.equal(fence.denied(), false);
  assert.deepEqual(await runFenced(fence, async () => 2), { status: "current", value: 2 });
});

test("ApiError.isAccessDenied: 401/403 and enveloped 404 are denials; a bare missing route and offline are not", () => {
  const make = (status: number, code: string, kind: ApiError["kind"] = "http") =>
    new ApiError({ status, code, kind, message: "x" });
  assert.equal(make(401, "UNAUTHENTICATED").isAccessDenied, true);
  assert.equal(make(403, "CONSENT_REVOKED").isAccessDenied, true);
  assert.equal(make(404, "NOT_FOUND").isAccessDenied, true);
  assert.equal(make(404, CLIENT_ERROR_CODES.endpointUnavailable).isAccessDenied, false);
  assert.equal(make(0, CLIENT_ERROR_CODES.network, "network").isAccessDenied, false);
  assert.equal(make(409, "STALE_GUARD").isAccessDenied, false);
});
