# Independent code review: owner declaration history after reload

Verdict: **APPROVE**. No actionable findings or merge blockers in the one-condition projection fix or its new regressions. Browser verification of correction history after reload remains an integration check.

## Exact change reviewed

Read `docs/full-qa-fact-history-fix.md`, `src/lib/patient-access-service.ts` and `tests/full-qa-fact-history.test.ts`, plus relevant current-version consumers. These files are untracked in the main workspace, so staged/unstaged diffs do not establish their before-images. Independently verified the identities instead:

| Identity | SHA-256 |
|----------|---------|
| Current production file | `378fd4f45c8c140073f505426b2e14553a935da39c4406d0591711dc024c81d0` |
| Current new test | `249b9cdabc948227c8dc77b075f9012aa0a834cd4a60fcf40eaaf02c609babe2` |
| Production bytes after reversing the single predicate change in memory | `14dfd99d5ca598c3a07a97012854f4e88e1ba3c69b1acd396d4b98f2312f960d` |

The reconstruction matched the supplied before-image hash exactly. The sole production change is at `patient-access-service.ts:92`: patient facts are still gated by clinical scope and patient ID, while the authorized owner additionally receives superseded versions. Clinicians retain the existing current-only predicate.

## Boundaries and downstream semantics

- Ownership remains resolved from a matching enabled patient account, actor role and patient ID. The change does not trust a client-supplied owner flag. Clinical-scope, revoked-grant, processing-consent and disabled-account behavior is unchanged. Retaining owner record reads after processing withdrawal follows the pre-existing owner read policy.
- `currentFacts()` continues to exclude superseded versions. RecordHub renders that current list and separately passes `previousVersions()` the complete owner list for history. Saved onboarding summaries and the home `nextStep()` helper also use `currentFacts()`; historical declarations cannot count as current answers through these consumers.
- `activeConditions()` excludes superseded conditions before home/plan monitoring cards. `refreshMonitoring()` independently selects current facts before evaluation. The projected evaluations still require the current record guard; the new affirmed-to-negated regression verifies no historical affirmed condition is evaluated or rendered as active.
- `buildAuthorizedEvidence()` filters superseded and other-patient facts before forming AI evidence. MonitoringAiService capture uses this builder, including onboarding/proposal/report paths. Model redaction and grounded claim rendering therefore receive the current snapshot. Semantic search separately applies the same current-only fact selection. The projection change does not feed history into these evidence pipelines.
- `buildShareGroups()` offers only facts with `supersededBy === null`. External visits continue to freeze explicitly selected patient/version references; later facts or corrections do not enter an already issued snapshot. The backend's ability to freeze an explicitly chosen earlier version is existing snapshot behavior, not a change to current patient truth.
- The offline allowlist omits all medical facts and correction reasons. Expanding a device copy restores `medicalFacts: []`, rather than storing owner history. The new regression asserts exclusion of both version IDs, the declaration label and correction reason.
- Protocol predicates and bound requirement resolution already reject superseded facts. Doctor consumers continue to receive current-only medical facts from the unchanged clinician branch.

The scan remains linear. Owner response size now grows with the intended correction history; no additional database, model or external operation was introduced.

## Regression quality and independent validation

The new persistence regression exercises real `recordFact`, `correctFact` and `CareService.patient` calls around reopening a disposable SQLite repository. It first verifies the stored link and history traversal, then asserts that the projected owner record contains the previous unknown revision alongside the current negated revision. This checks the missing storage-to-projection-to-UI-helper boundary and would fail with the original unconditional current-only projection. Other-patient history and its private reason are explicitly checked for exclusion.

The authority regression covers primary and fully scoped secondary current-only views, scope narrowing, clinician revocation, processing withdrawal, owner retention and a disabled owner. Further regressions exercise historical affirmed declarations against evidence, current monitoring/cards/summaries, and the offline copy. Existing tests also cover longer/cyclic history traversal, so the new single-correction persistence test complements those helper tests.

Independently executed in the main workspace:

```sh
env -u APP_ORIGIN node --import tsx --test tests/full-qa-fact-history.test.ts tests/patient-projections.test.ts tests/patient-revocation.test.ts tests/monitoring-ai.test.ts tests/medical-evidence.test.ts tests/frontend-patient-record.test.ts tests/frontend-offline-record.test.ts
```

Result: **104 passed, 0 failed, 0 skipped**, duration **227.343791 ms**.

Also executed selected existing sharing, monitoring, home and frozen-visit tests from `frontend-extensions.test.ts`, `frontend-monitoring.test.ts`, `frontend-patient-home.test.ts` and `external-visit.test.ts`: **8 passed, 0 failed**, duration **190.345542 ms**.

The new test defaults to in-memory fixture stores; its reopen case creates and removes a dedicated temporary directory. No private environment file or live/demo database was read or modified. This reviewer changed only this report. The implementing report's 845-test suite and TypeScript success are reported evidence, not independently rerun here. Root owns the integrated suite, build and original browser correction → reload → history verification; a repository reopen is not that browser check or a separate-process restart test.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE** — the minimal owner-only history projection is supported by meaningful regressions and preserves current-version selection boundaries.
