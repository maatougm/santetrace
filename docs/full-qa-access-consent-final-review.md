# Independent final review: scoped access display and consent persistence

Verdict: **APPROVE**. No actionable findings in the bounded access/count and consent-display changes. The integration suite, production build and browser checks remain root-owned.

Reviewed the stable access and consent batch in `/Users/bigmo/Documents/ChatGPT/hakathon/.claude/worktrees/claude-frontend-006` against main workspace snapshots, using `.orchestration/full-qa/claude-access-layout-report.md` and `.orchestration/full-qa/claude-consent-report.md` for ownership. New helpers and tests were read in full. Navigation files contain earlier navigation-owner work too; this verdict covers their access/count callsites and compatibility, not a separate final design review. The active language follow-up in shared error/status components, ReportClaims and textareas is outside this verdict. No source or test edits, live runtime/database operation, private environment read or key access was performed; only this review document was written.

Consulted the installed Next.js guides `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `01-app/02-guides/server-and-client-boundary.md`. The pure helpers add no server dependency or browser-only render operation; interactive consumers retain their Client Component boundary.

## Access/count review

`readability()` mirrors the relevant server projection rules: labs require clinical plus documents, alerts require their full five-scope composite, and clinical sections/reminders require clinical read access. Neither `canManageCare` nor `canReviewLabs` grants a read. The owner override matches the existing frontend convention; actual enabled-owner server envelopes already contain all sharing scopes.

The `number | null` count model distinguishes inspected zero from unavailable data. `tabCounts()` additionally omits a badge when the workflow tab is unavailable; care and external-note zero badges retain the existing omission rule. Document badges still mean proposed lab values, not PDF count. Alert counts include new and acknowledged alerts only. Missing historical `externalNotes` stays unknown.

The helper uses the current envelope on every invocation. Tests deliberately retain nonempty old arrays under narrowed scopes, proving counts are suppressed and recomputed upon restoration. Documents cells render `Non partagé` for unknown lab counts; an unknown count never promotes the row action to `Revoir`. Clinical-plus-documents secondary access still shows real values and genuine zeroes with mutation controls disabled.

DocumentReviewView separately gates candidate rendering and its header summary while preserving the authorized PDF source. Direct URLs without documents access distinguish unshared documents from a genuinely missing resource. TrendsSection gates biological series and pending notices, preserving the measurement charts and avoiding an unsupported claim that there are no confirmed labs. PlanCard's null-plan branch now requires clinical readability before asserting `Aucun plan`; status-only access displays `Plan non partagé`.

The existing mutation gates, fenced upload/review application, plan submission/revision handling and server authorization remain unchanged. The access helper establishes display eligibility; it does not authorize backend access. PatientRecordView still mounts one active panel, with the care default, and the alert shortcut receives the nullable guarded count. No automatic AI operation or background message-thread mount was introduced.

## Consent, actor and logout review

`consentDisplay()` derives withdrawn status from a successful current-actor acknowledgement, `CONSENT_REVOKED`, or an explicit false consent record. A cached false remains valid under the existing one-way withdrawal API. An active state requires a live server true with no current poll error. Device true/loading, stale true plus network or other refusal, and missing consent are not presented as active or withdrawn.

The new acknowledgement is memory-only and bound to `OutboxScope` object identity. PatientRuntime memoizes that scope from actor ID and patient ID, so ordinary rerenders retain it and an actor/patient change creates a different scope. A late acknowledgement for the previous scope cannot mark the next actor withdrawn. Record/error fencing and denied-read clearing stay in the existing patient runtime.

Withdrawal still requires the explicit confirm action; its dialog retains the busy-close veto. Revoked status uses the existing `useLogout({ onBeforeLogout: beforeLogout })` action and blocked/retry notices. No new persistence write or sign-out shortcut bypasses the purge. Independently confirmed these supporting files are byte-identical to main: PatientRuntime, usePatientRecord, LogoutGuard, useLogout, session-cleanup and clinician section-access. The callback still stops polling after a successful actor purge, and the centralized logout path still refuses sign-out when preparation or purge fails.

## Independent verification and limits

Executed in the reviewed worktree:

```sh
npm exec tsx -- --test tests/frontend-scoped-visibility.test.ts tests/frontend-consent-display.test.ts tests/frontend-record-navigation.test.ts
```

Result: **36 passed, 0 failed, 0 skipped**, duration **100.921583 ms**: 11 visibility tests, 6 consent tests and 19 navigation/fixture compatibility tests. The visibility regressions use both populated denied arrays and authorized empty arrays, including each missing alert-composite dependency. Consent regressions exercise revoked server/device/error cases, loading, missing data, stale active records and immediate acknowledgement. The static consent wiring check supplements those pure semantic cases; it is not a browser actor-switch or logout-purge test.

All manifest hashes below were captured twice and remained unchanged during review. The native reports' broad suite/TypeScript results were read as reported evidence, not rerun here. Their unrelated dashboard test failure is not an access/consent approval claim; root's integrated run is authoritative. Browser checks should still compare the narrow generalist, read-only secondary and full primary, including PDF access and a scope downgrade, and verify consent after navigation/reload plus the existing blocked-purge retry flow. No browser or live account was operated by this reviewer.

## Reviewed snapshot: SHA-256 manifest

Paths are relative to the reviewed Claude worktree.

| File | SHA-256 |
|------|---------|
| `src/components/doctor/record/read-visibility.ts` | `ffeb4584a59114a99caefdb2f33103971e9e30ae788b4222c031817b49b4966b` |
| `src/components/doctor/record/record-tabs.ts` | `4925b5915185cbbcb41bce53e842672ffecabe3d8efdc71482484bf3c6a40352` |
| `src/components/doctor/record/RecordActions.tsx` | `cc9f4185592d630081c51e5c9e45d456f1a85e29f752fce984a6069d18d334cc` |
| `src/components/doctor/record/PatientRecordView.tsx` | `6f3b6895006e1e378b3ca0864c59de6432bb62e7bc54ef4fdc3249fda8474152` |
| `src/components/doctor/record/DocumentsSection.tsx` | `532608694720790597f8ca5a076cd9af8abe0f6983abfa60938014f83bf017d8` |
| `src/components/doctor/record/TrendsSection.tsx` | `d82e5978bf1c414f979c7b292cfd0428b0427c15a29d47d29a366f1056ff657f` |
| `src/components/doctor/review/DocumentReviewView.tsx` | `667707daee316e04f5e6ef2d5106dcb1c687c5adccbc896c98ca06e8f64d7ae9` |
| `src/components/doctor/care/PlanCard.tsx` | `fc990c2ab10e63f0348664e70fd3b589c83e428428f89036dee0f36aca869386` |
| `tests/frontend-scoped-visibility.test.ts` | `4d9b6fee1d185fd7fdf4be9a68d1f3768fd951ebe7238174b05a89077cc78ca6` |
| `src/components/patient/consent-display.ts` | `011d5a671bdb2f0431f4c08fa241151406f89f466a16b871734b7a3a19c69644` |
| `src/components/patient/SummaryScreen.tsx` | `093072b5eb1e4ab64489c8fed06039dd713c58a056646342c816d60b7662ba0a` |
| `tests/frontend-consent-display.test.ts` | `e6dedd21facfd9a04abe77d72641adf6c643d279af56e324e3c083c5730b8cd1` |
| `tests/frontend-record-navigation.test.ts` | `2203f7403cde2a432b22ab4e7efb32170db584ec4f1ca043423fdf4f74984b6d` |

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: **APPROVE** — no actionable findings in the bounded access/count and consent-display snapshot above.
