# NVIDIA backend security review

Reviewed at 2026-10-11T04:41:50Z in the main checkout. Result: **APPROVE for the explicitly enabled, fictional-data demonstration integration at the hashes below.** No actionable critical, high, medium, or low security findings were identified in this candidate. This is a focused source and synthetic-transport review, not approval for processing real patient records or proof of the deployed browser workflow.

## Scope and boundaries

Read-only review of the seven requested candidate files, plus the existing evidence validator, template registry, access checks and imports that determine the candidate's trust boundary. Only this report was created. No private environment file was opened; no real credential was read, printed or used; no live NVIDIA request was made; no source, dependency, server or runtime configuration was changed. The `security-review` skill was applied.

## Findings and safeguards

- **Outbound destination and credential:** `src/lib/nvidia-model.ts:6` fixes the HTTPS endpoint; line 73 rejects redirects. There is no user-configurable cloud URL or model. Lines 15 and 20 keep the credential in a JavaScript private field, sourced from a server environment variable; line 26 rejects malformed credentials including header controls. The credential appears only in the outbound authorization header, not the request body or returned metadata. Import inspection finds the production entry through the server API handler, without a client component importing the transport. `.env.example:14` explicitly documents a server-only credential; `.gitignore` ignores private environment files.
- **Explicit provider selection:** `src/lib/monitoring-http.ts:26` selects NVIDIA only for the explicit `nvidia` setting. The API key alone does not enable it. Unknown providers fail closed. Lines 39–41 disable local embeddings for NVIDIA, including when the local flag is accidentally true. Cloud failures do not retry through Ollama.
- **Authorized, bounded evidence:** `src/lib/monitoring-ai-service.ts:260` captures an authorized snapshot through the existing evidence builder. `src/lib/medical-evidence.ts:9` blocks records not marked fictional before generation. Its lines 106–115 remove patient identifiers, labels, free text, document prose and original source IDs; use opaque aliases; retain only structured evidence with at most 40 sources. Measurements and dates still go to the cloud as intended for the fictional demonstration: this is minimization, not a claim of full anonymization.
- **Source grounding and closed output:** `src/lib/monitoring-ai-service.ts:283` sends the redacted snapshot and, at line 285, restores aliases and validates against the original authorized snapshot before recording cloud provenance. `src/lib/medical-evidence.ts:39` rejects extra fields, unsupported claims, source substitutions, altered verification or polarity, and unregistered action parameters. Model prose is not rendered: the server reconstructs values from its trusted snapshot. The adapter rejects truncated completion, tools, refusal, multiple choices, malformed JSON and invalid UTF-8. An instruction-only provider schema does not replace application validation.
- **Authority and urgency:** `src/lib/monitoring-ai-service.ts:275` bypasses model generation for unresolved red pathways. Lines 237–238 and 253–254 check current access and revisions after asynchronous generation and before releasing or storing results. Persisted replay also rechecks current authority and guards, retaining the original provider provenance. Generation creates drafts, not approved care actions.
- **Resource and error bounds:** `src/lib/nvidia-model.ts:29` limits prompt length; line 43 caps request bytes; lines 83–99 cap the decoded response to 256,000 bytes with strict UTF-8; line 127 caps assistant content. Lines 64–65 cap the deadline at 30 seconds, including the transport queue, and the gate permits one active request plus two waiters. Abort and late-response cleanup cancel bodies and release the gate. HTTP 202 is unavailable, not a completed result; 429/503 are busy. Provider bodies and arbitrary transport error text are discarded; returned failure reasons are controlled enum values.

## Independent verification

1. `node --import tsx --test tests/nvidia-model.test.ts tests/monitoring-ai.test.ts tests/care-http.test.ts tests/patient-authority-transition.test.ts`: **67/67 passed**, no failures, skips or cancellations. These tests use fake credentials and injected transports. Coverage includes credential serialization, fixed destination, redirects configuration, size/timeout/abort handling, red bypass, identifier removal, revocation during generation, unknown output extensions, and replay provenance.
2. Additional in-memory synthetic probes: a non-fictional record was rejected with **zero outbound requests**. A reversed-polarity claim, unknown source alias, diagnosis extension and prototype-key extension each produced deterministic `invalid_output` fallback with no cloud model attribution. No prototype pollution occurred. These probes changed only an isolated fixture store, which was closed afterward.
3. `npm audit --audit-level=high --json`: exit 0, **zero vulnerabilities at every severity**, 150 dependency entries audited. No dependency updates or audit fixes were performed. `eslint-plugin-security` is not installed in this checkout; it was not fetched or added during the read-only review.
4. Reviewed hashes were rechecked after tests and probes and remained unchanged.

## Exact reviewed SHA-256 hashes

| Candidate | SHA-256 |
|---|---|
| `src/lib/nvidia-model.ts` | `2f3551f77334a050b56eacc55730b7c15fb1e666769e73266d2a6d2645a87394` |
| `src/lib/local-model.ts` | `866592f1e53514459631451701fd4260ca0bb97fcbf541b061ca960a300ba602` |
| `src/lib/monitoring-ai-service.ts` | `a7ce95719e18f358a2c864b41946093dce41ad0988ce9513e1775e25e921a5a2` |
| `src/lib/monitoring-http.ts` | `362d1c83272149d8c71dbb7b935f99a1409acdb32ccd9dfef79fe3f833ac1f12` |
| `src/contracts/monitoring.ts` | `d26a6fba1a2243c84257234c5c1e3a1015f7210a2006b25998c3f85e3f3e760e` |
| `.env.example` | `c68986353ff9e201057fa6efd574fa333f5c15fc5cd09983e4ab308416904743` |
| `tests/nvidia-model.test.ts` | `ee1c14f4eee9abeffdc81e9c825d5a3043de715276a531a9e1146a872261edf3` |

Supporting trust-boundary hashes:

| Supporting file | SHA-256 |
|---|---|
| `src/lib/medical-evidence.ts` | `fa9a4efc163508e7a96c19ba131288bb0fdd0c1dd27fb97e9301f0f5826e565b` |
| `src/lib/monitoring-content.ts` | `804bed1b7c620ad180101c5fd10cfed832bee39572ae143afb81486e60954f29` |
| `.gitignore` | `245606ac884438510a404701971b2ef99aebb291b253e14604779d5d8996c2d4` |

The live endpoint's behavior, runtime environment wiring, frontend cloud labels and final browser acceptance remain separate integration checks for the owner. This review does not assert that the cloud provider is already activated or clinically validated.
