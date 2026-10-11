# Continuous monitoring — external consultation and connector security review

Review date: 2026-10-11. Independent readonly review of feature 006 D1/D2. App source was not modified by this reviewer. The only repository write is this report.

## Scope and current status

Service-layer and mounted HTTP review are complete. The previously reported HIGH public-route throttle issue is resolved and independently reverified. No confirmed open CRITICAL, HIGH, MEDIUM or LOW findings remain within D1/D2 and the reviewed routing/resource controls.

Reviewed the full `src/lib/external-visit-service.ts`, `external-visit-session.ts`, `connector-service.ts`, their three new test files, frozen feature-006 specification/data model/API contract, implementation return, and surrounding store, access, source-reader and shared measurement ingestion/evaluation behavior. The initial `monitoring-http.ts` snapshot did not yet mount D1/D2 paths; the final mounted snapshot and API catch-all export were then reviewed. The follow-up review also read the full `PublicCredentialThrottle`/shared registry in `care-http.ts`, current public route gates and both changed HTTP test files. Git staged/unstaged context was inspected again; feature modules are new untracked files and the only tracked diff was unrelated `GATES.md`, so a tracked diff would not cover these modules.

## Confirmed service controls

- Secret issuance uses 32 random bytes and persists only SHA-256 hashes. Public grants/connectors omit hashes and frozen medical projections. Issuance idempotency retains IDs only; retries return a null secret/URL. Session tokens are server-internal rather than account actors.
- Redemption is one synchronous SQLite transaction, guarded by pending state, a 24-hour deadline, enabled owner and current consent. Exactly one of twenty contenders obtains a session. Guest cookies are separate, HttpOnly, SameSite Strict, capped to one hour and Secure in production; duplicated credentials are rejected.
- Every guest operation checks active grant, current consent/enabled owner, 60-minute absolute and 15-minute idle expiry. Revoked, ended, expired and unavailable credentials/resources use `404 VISIT_UNAVAILABLE`. Successful accesses update idle activity without extending absolute expiry.
- Selected data is cloned at issuance, scoped to the same patient and explicit resource revision. Historical observation values exclude later corrections; newer facts and unselected PDFs are not silently added. Guest PDF reads use a trusted UUID filename, a selected fixed hash, a 5 MiB bound and PDF signature. Permissions/selection/hash are rechecked in a synchronous transaction after file I/O and before bytes are returned.
- Notes are bounded plain text with server-attributed, explicitly unverified guest identity. Corrections append new notes under the same grant, never overwrite clinical observations. Live authorization precedes idempotent replay; insertion increments context/evidence and suspends active reusable protocols. Guest authority cannot approve care or invoke clinician settings.
- Connector identity, patient association, device ID and simulated source are derived from the server binding. Incoming spoofing fields are rejected. Enabled binding/owner and consent are checked before event replay. Event IDs dedupe across bearer/browser ingress; changed payloads conflict. Numeric/unit/time validation is shared with manual capture. Suspect readings remain unknown without alerts; pulse remains bpm/unknown. Freshness is evaluated from measuredAt, while receivedAt and delay warning remain separate.
- Access journals retain allowed/denied guest events without raw credentials or note text. Current owner record/control access survives consent withdrawal, while new processing is denied.

## Findings

No confirmed open findings.

### Resolved HIGH — public redemption and bearer-ingress throttle

The prior mounted snapshot allowed arbitrary correctly shaped unknown credentials to enter SQLite transactions. Its independent probe produced 64 transactions for 64 invalid public requests.

The fix is now verified in `src/lib/care-http.ts:117` and `src/lib/monitoring-http.ts:76`. `PublicCredentialThrottle` synchronously reserves both per-credential and global attempt budgets before either service transaction, counts successful and failed calls, and retains only SHA-256 credential-hash keys. Guest redemption admits five attempts per credential/minute; bearer ingress admits 60. Each route has an independent ceiling of 256 attempts/minute and bounded bucket cardinality. Rotating credentials cannot reset either ceiling. Both reset after the configured window. Account-cookie resolution and account initialization occur after these public branches, so neither route promotes an account actor or adds unbounded account-state work before the public cap.

Guest throttle failures preserve the same `404 VISIT_UNAVAILABLE` body and omit rate-limit/state details. Connector throttle failures return 429 with a bounded Retry-After. No raw credential keys or credential logging were found in the changed paths.

Independent follow-up `/tmp/hackcure-public-throttle-recheck.ts` results:

| Probe | Requests | SQLite transactions | Result |
| --- | --- | --- | --- |
| Repeated unknown guest token | 100 | 5 | Remaining requests neutral 404 |
| Repeated unknown bearer credential, valid event body | 100 | 60 | Remaining requests 429 with Retry-After |
| Rotating unknown guest tokens | 300 | 256 | Ceiling retained; 256 hashed buckets |
| Rotating unknown bearer credentials | 300 | 256 | Ceiling retained; 256 hashed buckets |

The wrapper recorded **zero account-store reads** in all four public invalid-credential cases. Exhausting the guest ceiling did not exhaust the connector ceiling. A valid link blocked by the exhausted guest budget remained pending and activated once after window expiry; its replay stayed unavailable. A valid simulator bearer event remained server-bound, and 60 successful retransmissions exhausted the per-credential budget while retaining only one measurement. The next successful-shaped retransmission was rejected before ingestion. The guest cookie still could not authorize an ordinary patient-account API.

## Verification evidence

- `npx tsx --test tests/external-visit.test.ts tests/external-visit-revocation.test.ts tests/care-connectors.test.ts tests/monitoring-measurements.test.ts`: **24 passed; zero failed**.
- Initial scoped strict TypeScript command over the three modules and three new tests: **exit 0**.
- Fresh follow-up `npx tsx --test tests/care-http.test.ts tests/patient-http.test.ts tests/external-visit.test.ts tests/external-visit-revocation.test.ts tests/care-connectors.test.ts`: **41 passed; zero failed**. This overlaps the initial service test set and is not an additive full-suite count.
- Fresh scoped strict TypeScript check over `care-http.ts`, `monitoring-http.ts` and the two changed HTTP test files: **exit 0**.
- Independent temporary probe `/tmp/hackcure-external-review-probe.ts`: **passed**. Disabling the owner during held PDF I/O prevented release; the disabled owner also blocked record/note access and connector receipt replay. No late note or duplicate measurement was inserted. Empty, malformed and unknown link tokens all returned neutral 404.

## Mounted HTTP verification

- `/tmp/hackcure-external-http-review-probe.ts`: **passed before the throttle fix and passed again after it**. A valid account cookie alone could not authorize guest record access; the dedicated guest cookie could not authorize account APIs. Cross-origin redemption was rejected without consuming the link. Twenty HTTP POST activations produced one winner, with only `{visit}` in JSON and the secret in the distinct HttpOnly cookie.
- Authorized whole/HEAD/range PDF requests used trusted PDF content type/disposition, sandbox/nosniff headers, private/no-store caching and correct byte bounds. HEAD released no body. Invalid range returned 416 only after service authorization. Revocation made a subsequent range request return neutral 404, without a Content-Range length leak, and cleared the guest cookie.
- Bearer ingress was the sole same-origin exception, used its own credential rather than an account actor, and returned server-bound simulated provenance. Guest mutations retained same-origin checks. Owner external-note lists follow the owner-only service check.
- Scoped strict TypeScript check including `src/lib/monitoring-http.ts`: **exit 0**.
- No full-suite/build/browser or `/share` frontend-page completion is claimed by this review. The route layer never redeems on GET/HEAD; frontend preview/persistence behavior remains its separate acceptance check.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE — D1/D2 service and reviewed HTTP controls; the prior HIGH is resolved. No remaining material issues within this scope.**
