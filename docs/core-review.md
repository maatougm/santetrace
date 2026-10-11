# Core and EndoRecord code review

Date: 2026-10-10. Scope: fictional local demonstration.

Verdict: **APPROVE** for the reviewed backend, EndoRecord, HTTP rehearsal scripts,
environment example, dependencies, and worker tracing configuration. No remaining
confident CRITICAL or HIGH findings in this scope. Frontend, SQL, deployment and
clinical validation require separate evidence.

## Findings resolved

- Normal glucose readings no longer hide unresolved red blood-pressure alerts;
  acknowledgment retains unresolved priority.
- Login attempts are throttled by scope. The clinician bucket is reserved against
  invitation-key eviction; patient failures do not lock unrelated accounts.
- JSON and multipart bodies are bounded while streaming, before complete buffering.
- Measurement and reminder replay keys include authenticated actor scope.
- Repeated acknowledgment preserves its original timestamp, history and audit.
- Identical patient-owned PDF content reuses its source and candidates, including
  concurrent uploads. Surplus files are removed and confirmation remains unique.
- PDF parsing runs in terminable Node workers with a deadline, two active slots,
  resource limits, page limits and extracted-text limits.
- Laboratory confirmation and revision reject future examination dates.
- Identity matching requires an explicitly labeled, normalized full name. Conflicting
  labels, partial names and names appearing only in reference prose never establish
  a match; clinician identity confirmation remains mandatory for every result.
- Source access is reauthorized after asynchronous file reading and immediately
  before releasing bytes. Consent withdrawal during the read denies release and
  does not create a successful source-access audit entry.
- API visibility timing verifies each submitted measurement ID in the clinician
  detail response rather than checking an unrelated existing dashboard status.

## Evidence and limits

The final independent review read the complete EndoRecord service, its HTTP and
PDF-worker boundaries, both rehearsal scripts and the persistence tests. Reviewer
directly ran the final focused suite: **14/14 passed** (11 EndoRecord and three
persistence tests), then the full unit suite: **50/50 passed**. Evidence includes
real PDF extraction, conflicting/partial identity labels, concurrent duplicate
uploads, future-date rejection, consent withdrawal during source I/O, actual
timeout termination with released parser slots, disk close/reopen replay,
immutable earlier alert rule snapshots and confirmed-only sourced exports.
The earlier dependency audit reported zero known vulnerabilities at review time.

The orchestration lead reports successful HTTP rehearsals for core monitoring and
EndoRecord, including actual PDF bytes, duplicate handling, identity review,
correction history and consent/access denial. The reviewer inspected both scripts
but did not independently rerun those HTTP rehearsals. Their evidence establishes
API behavior, not browser rendering or offline service-worker behavior.

The port-3001 scripts and APP_ORIGIN example are consistent. Worker tracing includes
the runtime worker, PDFjs and native canvas dependencies; installed Next.js tracing
documentation supports the route-glob configuration. A production build and runtime
packaging check remain necessary. No full-project typecheck or frontend completion
claim is made by this review.

## Review Summary

| Severity | Count | Status |
|----------|-----------------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE** — no remaining CRITICAL or HIGH issues in the reviewed scope.
