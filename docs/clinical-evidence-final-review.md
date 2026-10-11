# Clinical evidence final review

Verdict: **APPROVE — no CRITICAL or HIGH findings in the reviewed scope.** Independent read-only review of leaf 6.2 and root's two `refreshMonitoring` corrections in the main checkout. No application or test code was changed.

Scope: `monitoring-content.ts`, `medical-evidence.ts`, their AI/evidence tests, and only the device-source verification map plus negated-condition filter in `care-service.ts` and the final two integration regressions in `monitoring-evaluation.test.ts`. Caller/contract code was read to trace the behavior, without treating worker 6.1's concurrent changes as reviewed. Staged/unstaged diffs and recent commits were inspected; these source files are currently untracked, so the verdict concerns their actual current contents, not a historical Git diff.

## Verified behavior

- Explicit unknown/uncertain answers stop repeated onboarding questions while retaining their original polarity and patient-reported provenance. A superseded answer cannot satisfy the current prerequisite. A known affirmed condition can produce a draft for reasoned individual clinician review; unknown conditions cannot support a matching rule proposal or profile binding. Individual approval creates an action, preserves the unknown coverage and does not create a reusable protocol. An unknown exclusion still blocks automatic application.
- The authorized evidence builder labels manual and accepted, unvalidated device readings `patient_reported`; suspect readings remain `candidate`, simulations remain `simulated`, and clinician-confirmed laboratory observations remain `confirmed`. Validation, deterministic fallback and redacted model sources preserve that distinction. A model cannot change patient/device evidence into `confirmed_fact` or change an unknown/uncertain declaration into an affirmed statement.
- Root's evaluation-source map now also keeps non-simulated device readings `patient_reported`. The meaningful confirmed-only requirement regression leaves the reading unadmitted, with unknown priority, awaiting-verification coverage and no admitted source. Accepted connector quality does not imply clinician confirmation.
- Negated condition declarations remain in the dossier/evidence but are excluded from disease evaluations. Unknown/uncertain declarations remain evaluated as unknown gaps. Existing red-episode dominance and conservative aggregate coverage remain in place.

## Independent checks

| Check | Observed result |
| --- | --- |
| `./node_modules/.bin/tsx --test tests/monitoring-ai.test.ts tests/medical-evidence.test.ts tests/monitoring-evaluation.test.ts` | **66/66 pass**, 0 failures/skips |
| `./node_modules/.bin/tsc --noEmit --target ES2022 --lib dom,esnext --strict --skipLibCheck --module esnext --moduleResolution bundler --esModuleInterop src/lib/monitoring-content.ts src/lib/medical-evidence.ts src/lib/care-service.ts tests/monitoring-ai.test.ts tests/medical-evidence.test.ts tests/monitoring-evaluation.test.ts` | **Exit 0**, no diagnostics |
| Additional isolated fixture probe for both unknown and uncertain diabetes declarations | Answer counted as supplied; confirmed promotion, affirmation laundering and matching glucose-rule proposal all rejected; deterministic fallback creates no matching glucose proposal |

This does not approve all of `care-service.ts`, worker 6.1, the full application, browser flows or medical accuracy. No live-model result is claimed.

Snapshot at `2026-10-11T03:17:13.675Z`:

| File | SHA-256 |
| --- | --- |
| `src/lib/monitoring-content.ts` | `804bed1b7c620ad180101c5fd10cfed832bee39572ae143afb81486e60954f29` |
| `src/lib/medical-evidence.ts` | `fa9a4efc163508e7a96c19ba131288bb0fdd0c1dd27fb97e9301f0f5826e565b` |
| `tests/monitoring-ai.test.ts` | `d5ac19ac105ae886276360d7f60b13a0c49fc9e371d6eb08b2563933df747589` |
| `tests/medical-evidence.test.ts` | `9e9b96f6bbeb77dbf9cfb307d620d994967b7c656ac7d5dc3b960d7346843b62` |
| `src/lib/care-service.ts` (only stated expressions reviewed) | `831e91f82f539535141f5f01e8afeb214866465f9475af4b7bce12f15af068b5` |
| `tests/monitoring-evaluation.test.ts` (final two regressions reviewed) | `82960dabdc13b9e3337213db730db3ae64edabea4cddf9238775e2a39918890d` |

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE the scoped evidence/completeness corrections.**
