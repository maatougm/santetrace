# Independent final review: clinical protocol trigger and current approval

Reviewed on 2026-10-11 in the main workspace. **Verdict: APPROVE — no verified CRITICAL or HIGH issue in the leaf-6.1 corrections.** The reviewer changed no production source or repository tests.

Scope: `src/contracts/monitoring.ts`; protocol, worker, assistant, care-plan and patient-access services; protocol/worker/current-action-approval regressions; the existing plan and assistant tests. The previous independent protocol review, leaf-6.1 gates, feature 006 protocol requirements and actual callers informed this review.

The staged diff was empty and the unstaged diff contained only unrelated `GATES.md` changes. The feature sources are untracked; their complete contents and callers were reviewed instead of inferring approval from an empty Git diff. Recent commits were also checked. Concurrent dashboard, frontend, model and media work is outside this verdict.

## H2: ordinary non-trigger readings

The new high-only non-trigger predicate determines only that the approved high trigger was not crossed. It requires the current exact profile/binding and evaluation guard, an affirmed admitted condition, valid copied high-only rules, complete requirement evidence, and the latest fresh admissible reading. It checks actual values and unit conversion against the same copied thresholds. It does not change the condition evaluation or establish medical green.

Only definite predicate mismatches, optionally accompanied by cooldown or exhausted count, admit the neutral path. Unknown predicates/exclusions/stops, changed context or authority, consent loss, unsupported or suspect evidence, freshness failure, expired protocol, overdue plan, and unresolved red remain blocking reasons. The worker skips protocol-application scheduling for a definite non-trigger. Necessary independent monitoring evaluation phases still run.

If `apply` is called directly, it records an idempotent `not_triggered` audit outcome with no action, delivery, clinical message or review task. A blocked application continues to request review. Trigger-source matching, atomic application uniqueness, cooldown/count limits, current commit-time guard checks, lease checks and existing delivered-replay safeguards remain intact.

Fresh regressions verify three ordinary readings produce no application/protocol/review task or message while their condition priority remains `unknown`; ordinary readings after application-count exhaustion remain neutral. Eligible orange recurrence still delivers, and unknown exclusions still create exactly one review message. Existing context, revocation, expiry, red, stale-source, held delivery, lease/restart and immutable-history tests pass.

## H4: live current approval

The additive optional `CareAction.approval` field contains `currentlyApproved`, `reasons` and `checkedAt`. Plan, record and assistant projections recompute it at their read boundary. This metadata is not written back to the stored action or original proposal decision, and progress state remains separate.

Checks retain enabled full-scope primary authority, patient consent, active plan, pending action, valid template, current plan deadline and assessed clinical context. One-time actions retain their original proposal decision/version and context/authority constraints. Protocol actions retain exact protocol version/context/authority/plan/profile constraints, expiry, action-template match and delivered application provenance. The new provenance check additionally binds the protocol and application to the same patient, clinician, protocol ID and original version.

`updatePlan` caches only its mutation result and recomputes the live plan response on an identical replay. The deadline regression verifies an initially valid approval becomes false on a retry at the review deadline without a second policy mutation. A reviewed new clinical message removes the unassessed-context reason but does not manufacture renewed validity for the old context or overwrite its original decision. Revoked authority, protocol suspension/expiry and completed progress are represented independently.

Frontend consumption of the optional metadata and browser presentation are coordinator-owned; this review does not assert those are integrated. Source approval and progress APIs retain their existing historical response semantics; they are not substituted for a live plan/record read.

## Fresh independent verification

`npx tsx --test tests/care-protocols.test.ts tests/monitoring-worker.test.ts tests/care-plan.test.ts tests/care-assistant.test.ts tests/care-action-approval.test.ts`

Result: **65 tests, 65 passed, 0 failed, 0 skipped**, exit 0. Counts: 27 protocol, 14 worker, 13 plan, 7 assistant and 4 current-approval tests. Full log: `/tmp/hackcure-clinical-protocol-final-review-tests.log`.

`npx tsc --noEmit --skipLibCheck --strict --target ES2022 --module esnext --moduleResolution bundler src/contracts/monitoring.ts src/lib/protocol-service.ts src/lib/monitoring-worker.ts src/lib/assistant-service.ts src/lib/care-plan-service.ts src/lib/patient-access-service.ts tests/care-protocols.test.ts tests/monitoring-worker.test.ts tests/care-action-approval.test.ts`

Result: **exit 0, no diagnostics**.

A separate reviewer-authored executable probe, `/tmp/hackcure-clinical-protocol-independent-probe.mts`, uses isolated synthetic in-memory stores and public authorization/application services. It confirms ordinary readings alone admit skipping; suspect, unscored, stale, future, unknown-exclusion, unresolved-red, changed-context, authority-loss, consent-loss and expired-protocol variants do not. It also confirms five independent mismatches in protocol/application patient, clinician, ID or version all deny current approval, and projected approval metadata is not persisted. Result: exit 0. The probe's initial module/timestamp fixture errors were corrected before these results; they were not product failures.

No full-suite, app build, HTTP/browser acceptance, deployment, medical accuracy or production readiness claim follows from this scoped review.

## Reviewed SHA-256 fingerprints

| File | SHA-256 |
| --- | --- |
| `src/contracts/monitoring.ts` | `6cfd161c2912b84012f35cb3b5a4994d521bf85ac838766d7b3d73d885bb90c5` |
| `src/lib/protocol-service.ts` | `8a81ca912b58c8f4133e9c976b618551daf27744db1e2bca7187207450e89630` |
| `src/lib/monitoring-worker.ts` | `524a56c776e709df7c2adca248cb02b63578e670584973eab3922ce191d01d3d` |
| `src/lib/assistant-service.ts` | `347eb634bcea25f15810c3c11904cfbaf2d83a07e6424461e6a7d17a98a39790` |
| `src/lib/care-plan-service.ts` | `3d7b9939a9994588a8513b8d52a859d3dfa97d0425c65749594e396bfa3fa38c` |
| `src/lib/patient-access-service.ts` | `14dfd99d5ca598c3a07a97012854f4e88e1ba3c69b1acd396d4b98f2312f960d` |
| `tests/care-protocols.test.ts` | `5fcefdbbad62b75a77be6a7099ec17d40a442bf0fcc511e00559adff0949d5a1` |
| `tests/monitoring-worker.test.ts` | `1a584e5a8130d9adb086ca2ce239d183771a553f01a8061a68fd0aaf1def3ab1` |
| `tests/care-action-approval.test.ts` | `46b28b28ce82d2f3ca5c09bdbd0f134b8e6fa9a6eff8e9a2ee34b9ed01f19dff` |
| `tests/care-plan.test.ts` | `5152201b76307df882e2609cc4f031febe1742b87c1e355f84296970529ea7b6` |
| `tests/care-assistant.test.ts` | `95e3ce64a71b0f6219961283413c3c6266b5868f84dbde759da1a774f2e8f90a` |

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE — no verified open CRITICAL or HIGH issue in the recorded leaf-6.1 source snapshot.**
