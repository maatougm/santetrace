# Independent access, evidence, AI and search recheck — feature 006

Date: 2026-10-11. Reviewer: Codex `/root/ai_access_recheck`.

**Scoped verdict: APPROVE. No open findings remain in the reviewed snapshot.** All five findings left open in `continuous-access-ai-review.md` are corrected. The additional authority, journaling and retrieval findings reproduced during this review are also corrected and independently rechecked.

## Scope and method

Reviewed the approved feature 006 specification, data model, API contract and A/B/D plans; the shared care/monitoring contracts; `patient-access-service`, `patient-account-service`, `monitoring-utils`, `care-error`, `care-service`, `endorecord-service`, `medical-evidence`, `monitoring-content`, `monitoring-ai-service`, `local-model`, `semantic-search`, `monitoring-http`, `care-http`, dedicated API routes and surrounding call sites/tests. The installed Next route-handler guide was checked for the dedicated route integration.

`git diff --staged` was empty. The tracked diff still contains only historical `GATES.md` changes; the application is mostly untracked. Existing files were compared with `.orchestration/monitoring-006/baseline`, and final working-tree implementations were read directly. Product files were not edited. Reproductions used temporary in-memory stores and fictional test data.

All eight approved stories remain delivery requirements. This review covers the access/core/evidence/AI/search implementation and the HTTP integration boundary. It is not acceptance of the entire feature, frontend journeys, the separate protocol/connector/guest service implementations, or clinical validity. In particular, project-authored search references are explicitly prototype policy, not medical practice guidelines.

## Verification

Final combined command:

```sh
node --import tsx --test tests/patient-account.test.ts tests/patient-authority-transition.test.ts tests/patient-grants.test.ts tests/patient-projections.test.ts tests/patient-revocation.test.ts tests/patient-http.test.ts tests/monitoring-ai.test.ts tests/medical-evidence.test.ts tests/semantic-search.test.ts tests/care-core.test.ts tests/endorecord.test.ts tests/care-persistence.test.ts tests/monitoring-measurements.test.ts tests/care-http.test.ts
```

Result: **139 passed, 0 failed, 0 skipped**. After the semantic worker's final held-adapter/numeric-query/budget cleanup, `tests/semantic-search.test.ts` was run again independently: **17 passed, 0 failed**. These counts overlap and must not be added. The existing PDF standard-font warning is nonfatal; the real worker timeout and concurrency tests pass.

## Previous open findings — verified corrected

1. **HIGH — optional onboarding blocked proposals.** `monitoring-ai-service.ts:122` derives blocking state from unanswered registry questions marked required. Deterministic proposal prerequisites likewise contain required question IDs only. Optional model-selected questions cannot block a complete required-only onboarding, and absent optional facts remain unknown. Regressions cover required-only answers, a model omitting required questions and a model selecting optional questions.
2. **HIGH — deterministic provenance misclassified suspect measurements.** The shared provenance/category mapping and strict grounded-output validator apply to deterministic fallback as well as model output. Accepted device, manual, simulated, suspect and external evidence retain their evidence level. Output is bounded by the shared ten-claim/ten-proposal schema. Disabled, timeout and malformed-output regressions preserve suspect measurements as candidates.
3. **HIGH — invalid provider configuration blocked fact capture.** Medical-fact capture and correction use a model-free service. Generation constructs the configured adapter separately and reports invalid configuration as explicit `provider_unavailable` fallback. The real HTTP regression accepts fact capture with non-loopback configuration, produces honest fallback metadata and preserves the loopback-only transport boundary.
4. **MEDIUM — generation ignored mutation keys.** HTTP generation validates and forwards a bounded `clientId`; `monitoring-ai-service.ts:197` reserves concurrent work and persists actor/patient/purpose-scoped replay records atomically. Sequential and concurrent retries share one model operation and one durable output. A changed fingerprint conflicts before work; release and replay both require current capability and the exact saved guard. Revoked/narrowed authority, changed evidence and another clinician/patient cannot recover stale private results. Raw prompts and credentials are not persisted in replay metadata.
5. **MEDIUM — sensitive resource operations lacked durable journals.** Service wrappers journal successful candidate/observation operations and preserve bounded denials after rollback. HTTP resource attribution resolves known resource IDs, including grants, to the server-owned patient. Unknown resources do not invent attribution. The new server-only `CareError.accessJournalRecorded` marker prevents the HTTP boundary from recording a second copy of a service denial.

## Additional findings — verified corrected

### Primary clinician disablement now suspends authority atomically

The original reproduction disabled the configured primary account, then performed an owner HTTP read. The principal became disabled while its plan remained active with the old clinician and unchanged authority revision.

`patient-account-service.ts:80` now moves the affected primary plan to `awaiting_clinician`, clears its clinician and increments the plan revision in the same transaction that disables the account. The patient authority bump suspends protocols, and unfinished due tasks are cancelled. Repeated initialization does not repeatedly bump authority. Restoring credentials enables account authentication but does not reactivate the plan or protocol. The persistent authority-transition regression passes alongside the account race/restoration tests.

### Denied alert and grant requests now produce exactly one journal entry

Two exact HTTP probes exposed duplicate alert denials and absent grant denials. With the final `monitoring-http.ts:39` resource map and server-only denial marker, the same accepted status-only secondary receives 403 for each mutation, the protected resource is unchanged, and each request adds exactly one durable denied entry. Candidate and observation service wrappers preserve equivalent attribution without storing clinical prose or secrets in the journal.

### Search no longer creates a perfect match from an empty semantic sentinel

Previously an unknown query such as `xyzzzz` and a PDF containing only unsupported clinical vocabulary were both transformed into the constant `clinical source`; identical embeddings therefore returned similarity 1. The final `semantic-search.ts:16` returns empty sanitized text when no admitted vocabulary remains. Unknown, fully redacted and numeric-only queries skip embedding; unsupported terms still search permitted sources lexically. Placeholder-only chunks are omitted from semantic adapter batches and hits. The independent seventeen-test run includes these exact controls.

### External notes and identified prototype references are indexed with preserved provenance

Authorized clinical external notes now produce bounded `external_note` chunks with a stable source hash, `external_unverified` verification and unknown polarity. Other-patient notes and hidden clinical sections remain excluded.

Project-authored references use a separate `reference:project:` namespace and explicit non-clinical labels. Local manifest/source paths, sizes, revision metadata and SHA-256 bytes are checked before inclusion; mismatched bytes produce no reference evidence. The identified policy source is `research/monitoring-prototype-policy.md`. The reference content is kept distinct from patient data and is not represented as external clinical guidance.

## Preserved boundaries and HTTP integration

- Effective access resolves the enabled current registry principal and current grant, rather than a legacy assignment or stale cookie snapshot. Summary/alert composites require all contributing scopes; losing any primary capability suspends its plan authority. Status-only projections contain no clinical facts, source sections, report text or rules. Owners retain historical read/control after processing withdrawal while new processing and capture are denied.
- PDF retrieval verifies current authority before and after asynchronous work, enforces source-byte hashes and bounded worker extraction, and returns original-page provenance. Changed bytes are excluded. Source HTTP responses use private/no-store headers, `nosniff`, sandboxed PDF content, validated byte ranges and correct HEAD behavior. Malformed path encoding is rejected.
- Model input uses opaque source aliases and bounded admitted data. Closed output schemas and template/source-version checks reject forged source IDs, invented values, polarity changes and unauthorized clinical hypotheses. Red pathways bypass generation. Patient proposal responses remain status-only. Fallback now generates separate home-measurement and clinician-examination drafts; approval affects one draft, unsupported conditions yield only an information draft, and complete pairs stay within the proposal budget.
- Search reserves category budgets totaling at most 39 chunks/18,000 source characters; PDF evidence cannot be crowded out by notes or references. Model batches contain at most 40 sanitized texts. Embeddings have a service deadline, validated finite dimensions and explicit lexical fallback. Private vector-cache keys bind source hash, extraction version, sanitized text and the actual embedding model; caches are bounded and written atomically with private file permissions.
- Search rechecks live authorization and the full evidence/authority guard before adapter work, after asynchronous work and inside the final journal transaction. Strengthened tests await actual embedding start before revocation/context changes; no held private result is released.
- The final HTTP boundary mounts plan/message/contact, protocol/assistant, connector, search and external-visit routes. Guest sessions use their separate cookie and do not inherit an account session. Mutation bodies are bounded and same-origin checks apply, with the explicit machine bearer-ingress exception. Public credential throttles reserve before SQLite, bound rotating invalid credentials as well as repeated credentials, and keep connector/redemption ceilings separate. Internal error text and the denial marker are not exposed to clients.

## Review Summary

Counts below describe current open findings; corrected historical findings are excluded.

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE — the reviewed access/core/HTTP/evidence/AI/search snapshot has no remaining actionable finding.** Full feature delivery and clinical validation require their separate acceptance evidence.
