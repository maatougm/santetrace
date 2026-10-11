# NVIDIA generation backend — independent code review

Reviewed on 2026-10-11 by `/root/nvidia_backend_code_review`.

## Scope and exact candidate

The seven files below are approved at these SHA-256 hashes. All hashes were checked again after review and verification and remained unchanged.

| File | SHA-256 |
| --- | --- |
| `src/lib/nvidia-model.ts` | `2f3551f77334a050b56eacc55730b7c15fb1e666769e73266d2a6d2645a87394` |
| `src/lib/local-model.ts` | `866592f1e53514459631451701fd4260ca0bb97fcbf541b061ca960a300ba602` |
| `src/lib/monitoring-ai-service.ts` | `a7ce95719e18f358a2c864b41946093dce41ad0988ce9513e1775e25e921a5a2` |
| `src/lib/monitoring-http.ts` | `362d1c83272149d8c71dbb7b935f99a1409acdb32ccd9dfef79fe3f833ac1f12` |
| `src/contracts/monitoring.ts` | `d26a6fba1a2243c84257234c5c1e3a1015f7210a2006b25998c3f85e3f3e760e` |
| `.env.example` | `c68986353ff9e201057fa6efd574fa333f5c15fc5cd09983e4ab308416904743` |
| `tests/nvidia-model.test.ts` | `ee1c14f4eee9abeffdc81e9c825d5a3043de715276a531a9e1146a872261edf3` |

Both scoped staged and unstaged Git diffs were empty because these files are currently untracked. I inspected their complete contents, recent Git history, the previous backend copies in the Claude worktree where available, and their actual source call sites. Surrounding evidence authorization, redaction, output validation, restoration, and rendering were also inspected in `medical-evidence.ts`.

## Findings

No reportable defects found in the scoped backend candidate.

The implementation preserves these important behaviors:

- Explicit NVIDIA selection uses only the fixed HTTPS completion endpoint, rejects redirects, and does not select local generation as a retry. A credential alone cannot select the provider.
- The separate embedding factory returns no local adapter whenever the provider is NVIDIA or invalid, even if the local-enable flag is true. The authorized search route consequently uses lexical retrieval.
- The timeout covers transport queue admission, request completion, and response body reading. Abort removes queued requests, releases the occupied slot, cancels readers, and cancels bodies from late responses. The existing gate bounds admission to one active operation and two waiting operations.
- HTTP 202 and other incomplete responses do not become successful model output. Error bodies and transport details are not returned to callers. MIME type, UTF-8 validity, body bytes, generated content length, finish reason, role, tools, refusals, and JSON parsing are checked.
- A cloud result receives `cloud_model` provenance only after opaque source aliases are restored and the existing closed application validator accepts the output. Invalid output retains deterministic provenance and a failure reason. Durable replay preserves the provider of the original result.
- Cloud generation retains the fictional-record restriction, structured redaction, source polarity and verification, revision guard checks, clinician authority checks after awaiting generation, and the existing urgent-red bypass. It neither authorizes treatment nor changes the deterministic patient assistant into an unrestricted model chat.
- The new adapter stores the credential in a JavaScript private field, and the example configuration contains only an empty credential placeholder. No new logging path exposes provider content or credentials.

## Independent verification

Command:

```sh
node --import tsx --test tests/nvidia-model.test.ts tests/monitoring-ai.test.ts tests/semantic-search.test.ts
```

Result: **68 tests passed; 0 failed, skipped, or cancelled**. This includes the new mocked NVIDIA transport tests and existing grounding, access revocation, revision, red-path, idempotency, queue, and retrieval tests.

Command:

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

Result: exit 2, with **only the two already assigned frontend integration diagnostics**:

- `src/components/doctor/care/AiMetaLine.tsx:16` — its label map lacks `cloud_model`.
- `src/components/patient/plan/AssistantReply.tsx:53` — its label map lacks `cloud_model`.

These diagnostics remain a whole-app build prerequisite for the frontend owner; they are not duplicated as new backend findings. This review does not assert that the full app currently compiles. No live NVIDIA API request, environment file read or edit, process restart, or application source edit was performed. Hosted provider compatibility and UI behavior still require the root's planned fictional-data smoke test after frontend integration.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE — the exact seven-file backend candidate above.** Whole-app release readiness remains pending the assigned frontend compilation fixes and runtime verification.
