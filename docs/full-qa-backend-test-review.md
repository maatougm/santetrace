# Independent review of backend QA journeys — 2026-10-11

**Verdict: APPROVE.** No blocking or actionable correctness/security finding was identified in `tests/full-qa-backend-journeys.test.ts` or the coverage claims in `docs/full-backend-qa.md`.

## Scope and evidence

Reviewed the complete new test file and backend QA report, the fixture helper, and the relevant session, access, evidence, PDF, protocol, care-plan, HTTP, and worker implementation. Supporting existing deadline, protocol, worker, PDF, evidence, grant, and revocation tests were checked where the report relies on their coverage.

Independent reproduction:

```sh
env -u APP_ORIGIN node --import tsx --test tests/full-qa-backend-journeys.test.ts
```

Result: **4 passed, 0 failed, 0 skipped**, exit 0; reported runner duration **525.9 ms**. The existing `/tmp/full-backend-qa-final.log` also records **841 passed, 0 failed, 0 skipped**, consistent with the report. The full suite and TypeScript check were not repeated during this independent review; their earlier successful runs remain the originating agent's evidence.

## Findings

None meeting the review confidence threshold.

The persistence assertions compare the approved plan and pending deadline across SQLite reopen, preserve application IDs and successful application counts, enforce cooldown and total limits after reopen, retain corrected observation history and source bytes, and check a persisted protocol suspension. The HTTP journey uses the actual handler and current-principal signed cookies. Its anonymous, owner, secondary, narrowed-primary, and revoked-primary cases check both the denial response and unchanged alert state/history. The ordinary reading must leave the unresolved episode red until explicit primary closure.

Each persistent test uses a newly created OS temporary directory and removes it in `finally` after closing the repository. The HTTP test uses an in-memory fixture, installs a synthetic clinician password only in its process, and restores the prior value in `finally`. All service and session calls in these journeys receive the fixture store explicitly. No production repository, external provider, physical device, or browser runtime is needed by the reviewed tests.

## Evidence limits

- The new lab journey injects extracted text and supplies synthetic PDF-header bytes. It establishes provenance, correction persistence, source retention, and authorization; actual PDF parsing comes from the separate existing `endorecord.test.ts` parser test. It does not establish dedicated Next multipart-handler behavior.
- The new protocol journey seeds an approved plan/proposal/action before invoking real protocol authorization and application services. It establishes recurrence persistence and runtime guards; approval creation and HTTP wiring have separate existing tests.
- Fixture-signed cookies intentionally bypass credential login while exercising current-principal session resolution and endpoint authorization. Unsetting `APP_ORIGIN` establishes a local fixture request context; configured-origin protection is covered by the existing HTTP tests.
- SQLite close/reopen and direct worker ticks establish repository restart behavior. They do not establish deployed process supervision, long-running uptime, or production database behavior.
- These four journeys do not independently assert access-journal contents or every response's cache header. Existing journal/HTTP tests supply those report claims. The new HTTP journey explicitly checks the successful closure response's `no-store` header.

The backend QA report expressly distinguishes these service/software fixtures from providers, hardware, deployed databases, dedicated Next HTTP wiring, and browser execution. Its 841-test total is explicitly identified as the repository suite, including frontend contract tests, rather than a backend-only or clinical-validity count. No material coverage overclaim requires correction before accepting the additional tests.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE — no CRITICAL or HIGH issues.** Approval applies to the additional automated tests and the backend QA report's stated scope.
