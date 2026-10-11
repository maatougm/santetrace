# Independent security review: owner fact history

**Decision: APPROVE** the minimal owner-history projection change at `src/lib/patient-access-service.ts:92`, for the exact identities below. No security defect introduced by this condition was found in the reviewed access and disclosure paths.

Review date: 2026-10-11. The reviewer independently read `AGENTS.md`, the installed Next.js data-security guide and authentication guidance, the security-review skill, and `docs/full-qa-fact-history-fix.md` before inspecting the implementation. Only this review report was added to the repository by the reviewer; no production or repository test source was edited.

## Reviewed identities

| File | SHA-256, verified before and after the review |
| --- | --- |
| `src/lib/patient-access-service.ts` | `378fd4f45c8c140073f505426b2e14553a935da39c4406d0591711dc024c81d0` |
| `tests/full-qa-fact-history.test.ts` | `249b9cdabc948227c8dc77b075f9012aa0a834cd4a60fcf40eaaf02c609babe2` |

## Boundary findings

| Boundary | Independent finding |
| --- | --- |
| Owner identity | `owner()` requires a patient actor whose account ID, role, patient ID, and enabled state match the requested patient. `access.owner` comes from `resolvePatientAccess`, not a caller-supplied access envelope. The record HTTP path resolves the session actor before calling `CareService.patient`. |
| Patient isolation | The predicate retains `f.patientId === id` for both current and historical versions. Other-patient facts and their correction reasons remain excluded. |
| Clinical scope | The new owner condition remains inside the existing `clinical ? ... : []` gate. Primary and fully scoped secondary clinicians remain current-only. A status-only grant yields no facts. |
| Revocation / withdrawal / disablement | An active grant and enabled clinician principal are still required; a revoked grant fails. Processing withdrawal still denies clinicians. The enabled patient owner retains read access under the existing policy, while the capability gate continues to deny processing/capture. A disabled owner receives no projection. |
| Current AI evidence | `buildAuthorizedEvidence` independently selects same-patient, non-superseded facts (`medical-evidence.ts:11`); it does not consume the expanded owner projection. Semantic fact search also excludes superseded facts (`semantic-search.ts:86`). |
| Monitoring and summaries | `refreshMonitoring` selects current facts (`care-service.ts:58`), and excludes negated conditions from evaluation. `currentFacts`, `savedFactsSummary`, `activeConditions`, and home onboarding decisions continue to select current versions. Bound requirements, care-plan prerequisites, and protocol fact predicates also reject superseded versions. |
| External sharing | `buildShareGroups` selects only `supersededBy === null` facts, so owner history is excluded from share select-all. `ExternalVisitService` builds a separate frozen selection using explicit same-patient ID/revision references; the owner projection does not expand guest disclosure. The existing contract permits an owner to explicitly share a historical snapshot, so this approval concerns automatic history disclosure, not a prohibition on authorized historical sharing. |
| Offline data | `toOfflineRecord` has an explicit allowlist that omits medical facts, and `fromOfflineRecord` reconstructs `medicalFacts: []`. Neither the original/history fact IDs nor historical labels/reasons are added to the device copy. |
| Rendering and input | Fact history labels and the displayed correction reason use React text interpolation. No HTML sink or new input/SQL/shell operation is introduced by the predicate. Existing fact correction validation and version guards remain unchanged. |

The intended effect is a larger owner record response containing that owner's stored predecessors. It does not make those predecessors current evidence or automatically share/cache them.

## Independent test evidence

All runs used an empty process environment (`env -i`) with only an explicit executable `PATH`. Fixtures used in-memory SQLite or their own disposable temporary SQLite file. No actual environment file, existing database, credential/key file, external model/provider, or live 3012 endpoint was accessed or mutated.

Focused run:

```sh
env -i PATH=/Users/bigmo/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/bigmo/.nvm/versions/node/v24.21.0/bin/node --import tsx --test tests/full-qa-fact-history.test.ts tests/patient-projections.test.ts tests/patient-revocation.test.ts tests/monitoring-ai.test.ts tests/medical-evidence.test.ts tests/frontend-patient-record.test.ts tests/frontend-offline-record.test.ts tests/external-visit.test.ts tests/external-visit-revocation.test.ts
```

Result: **119/119 passed**, 0 failed/cancelled/skipped, exit **0**, **270.277 ms**. Log: `/tmp/full-qa-fact-history-security-tests.log`.

An additional independent temporary probe passed **3/3 tests**, 0 failed/cancelled/skipped, exit **0**, **118.818 ms**:

1. Three successive fact versions reconstruct both predecessors for the owner, while clinician/AI facts and evaluations remain current-only and offline history remains absent.
2. Forged owner account IDs/roles, mismatched patient IDs, cross-patient reads, and disabled clinician accounts do not receive history.
3. Share select-all receives only the current version; a redeemed frozen guest selection contains only that selected fact, without intermediate historical labels or reasons.

Probe: `/tmp/full-qa-fact-history-security-probe.test.ts`, SHA-256 `30f290b4d061196c7da85f7976841ca67ae060d77066cfb4c57b0efefd41aef5`. Log: `/tmp/full-qa-fact-history-security-probe.log`. Run with the same empty environment and `node --import tsx --test /tmp/full-qa-fact-history-security-probe.test.ts`.

## Scope and limits

This approves the specified projection fix and its reviewed security boundaries. It is not a whole-repository security, dependency, deployment, or medical-accuracy certification. Browser reload verification and the production build remain coordinated by the root QA task; this reviewer did not inspect or mutate the running application.
