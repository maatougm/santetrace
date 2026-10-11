# Tasks: Continuous Patient Monitoring

Plan approved by the user on 2026-10-11: “Oui, lancer Codex + Claude”. Canonical requirements: [spec.md](spec.md), [contracts](contracts/api.md), [master plan](../../docs/superpowers/plans/2026-10-11-continuous-patient-monitoring.md) and its four subplans. Checkboxes mean implemented AND reviewed/verified, not merely dispatched. Each service task follows its subplan's failing-test, implementation and fresh-review cycle.

## Phase 1 — Setup

- [x] T001 Record current baseline, task ownership and preflight in `.superpowers/sdd/2026-10-11-continuous-patient-monitoring/progress.md`.

## Phase 2 — Foundation

- [x] T002 Freeze shared account/monitoring/guest types in `src/contracts/care.ts`, `src/contracts/patient-platform.ts`, `src/contracts/monitoring.ts`, `src/contracts/external-visit.ts`.
- [x] T003 Implement preserving schema v2 migration and synchronous transaction guard in `src/lib/care-store.ts`, `src/lib/care-migrations.ts`, `tests/patient-platform-migration.test.ts` (A1 foundation).

## Phase 3 — US1: Patient-owned record (P1)

Independent test: stable account returns to preserved dossier; chosen doctor accepts bounded rights; revocation removes doctor access while owner keeps record.

- [x] T004 [US1] Implement A1 accounts/current sessions/async throttle and one-use claim in `src/lib/patient-account-service.ts`, `src/lib/care-session.ts`, `src/lib/care-http.ts`, `scripts/claim-demo-patient.ts`; test `tests/patient-account.test.ts`.
- [x] T005 [US1] Implement A2 grants/projected resources and revoke guards in `src/lib/patient-access-service.ts`, `src/lib/care-service.ts`, `src/lib/endorecord-service.ts`, `src/lib/endorecord-http.ts`; preserve owner read after processing withdrawal; test `tests/patient-grants.test.ts`, `tests/patient-projections.test.ts`, `tests/patient-revocation.test.ts`.
- [ ] T006 [P] [US1] Claude builds A3 account/grants/journal and privacy fences in `src/lib/client/transport.ts`, `accounts-api.ts`, `grants-api.ts`, `access-fence.ts`, `use-polling.ts`, `src/components/patient/access/`, `src/app/patient/doctors/page.tsx`; test `tests/frontend-patient-access.test.ts`, `tests/frontend-polling-access.test.ts`, `tests/frontend-copy-parity.test.ts`.

## Phase 4 — US2: Sourced onboarding and approved plan (P1)

Independent test: unknown answer remains unknown; home measure approved independently of pending exam; changed context prevents stale approval.

- [x] T007 [P] [US2] Implement B2 grounded facts/questions/proposals/report with local fallback in `src/lib/medical-evidence.ts`, `local-model.ts`, `monitoring-content.ts`, `monitoring-ai-service.ts`; test `tests/monitoring-ai.test.ts`, `tests/medical-evidence.test.ts`.
- [x] T008 [US2] Implement B3 per-item decision and policy-versioned plan in `src/lib/care-plan-service.ts`, `tests/care-plan.test.ts`; patient pending DTO only id/revision/kind/state.
- [ ] T009 [P] [US2] Claude builds onboarding/facts/review/plan in `src/components/patient/OnboardingScreen.tsx`, `RecordHub.tsx`, `PlanScreen.tsx`, `src/components/doctor/record/CarePlanSection.tsx`; test `tests/frontend-monitoring.test.ts`.

## Phase 5 — US3: Condition coverage and priority (P1)

Independent test: fresh BP cannot conceal stale glucose/uncovered condition; unresolved red dominates.

- [x] T010 [P] [US3] Implement B1 condition evaluation and pulse unknown/bpm in `src/lib/monitoring-evaluation.ts`, `tests/monitoring-evaluation.test.ts`, `tests/monitoring-measurements.test.ts`; preserve old rule snapshots and visible low-direction gap.
- [ ] T011 [US3] Integrate condition projections/urgent episodes in `src/lib/care-service.ts` and Claude coverage/queue views in `src/components/patient/HomeScreen.tsx`, `src/components/doctor/dashboard/PatientTable.tsx`.

## Phase 6 — US4: Approved advice and conditional recurrence (P1)

Independent test: approval once creates no protocol; new admissible evidence can repeat authorized action; changed context/unknown exclusion blocks it.

- [x] T012 [US4] Implement C1 authorize/revise/apply with atomic frequency/count and fresh evidence in `src/lib/protocol-service.ts`, `tests/care-protocols.test.ts`.
- [x] T013 [US4] Implement C2 periodic work, leases and observable heartbeat in `src/lib/monitoring-worker.ts`, `scripts/monitoring-worker.ts`, `tests/monitoring-worker.test.ts`; demo tick15s/lease60s, no page dependency.
- [ ] T014 [P] [US4] Claude builds C3 assistant/protocol/action progress in `src/components/patient/AssistantScreen.tsx`, `ApprovedAdviceCard.tsx`, `src/components/doctor/record/ProtocolsSection.tsx`, `ProtocolForm.tsx`, `src/lib/client/assist-api.ts`; test `tests/frontend-protocols.test.ts`.

## Phase 7 — US5: Traceable intervention (P1)

Independent test: actual doctor message arrives in patient view; read, reviewed, action reported, contact requested and alert resolved remain separate.

- [x] T015 [P] [US5] Implement B4 message/review/contact histories in `src/lib/intervention-service.ts`, `tests/care-interventions.test.ts`.
- [ ] T016 [P] [US5] Claude builds reports/messages/contact UI in `src/components/doctor/record/ClinicalReportSection.tsx`, `MessageSection.tsx`, `src/components/patient/MessagesScreen.tsx`, `src/lib/client/care-api.ts`.

## Phase 8 — US6: Authorized semantic search (P2)

Independent test: allowed source excerpt retrieved; excluded/cross-patient source never ranked or released; no evidence and lexical fallback explicit.

- [x] T017 [US6] Implement D3 private source vectors/current rights in `src/lib/semantic-search.ts`, `research/monitoring-reference-manifest.json`, `tests/semantic-search.test.ts`; topK<=5, <=40 chunks/1000chars, <=20000 contextchars.
- [ ] T018 [P] [US6] Claude builds sourced search in `src/components/doctor/record/RecordSearchSection.tsx`, `src/lib/client/search-api.ts`.

## Phase 9 — US7: Device connector demonstration (P2)

Independent test: retransmission gives one source-labelled measurement; delayed measuredAt remains old; pulse unscored.

- [x] T019 [P] [US7] Implement D2 binding/simulator/shared ingestion in `src/lib/connector-service.ts`, `tests/care-connectors.test.ts`.
- [ ] T020 [P] [US7] Claude builds simulator/source badges in `src/components/patient/SimulatorPanel.tsx`, `src/app/patient/measure/devices/page.tsx`, `src/lib/client/devices-api.ts`.

## Phase 10 — US8: External read/append consultation (P2)

Independent test: preview consumes nothing; one redemption allows several selected reads and appended note; revoke blocks held output/commit and preserves committed notes.

- [x] T021 [P] [US8] Implement D1 guest grants/sessions/notes/source in `src/lib/external-visit-service.ts`, `src/lib/external-visit-session.ts`, `tests/external-visit.test.ts`, `tests/external-visit-revocation.test.ts`; redeem24h/session60min/idle15min, neutral404 and no clinician authority.
- [ ] T022 [P] [US8] Claude builds share/guest flow in `src/components/patient/ShareScreen.tsx`, `src/components/guest/`, `src/app/share/`, `src/lib/client/share-api.ts`; test `tests/frontend-extensions.test.ts`.

## Phase 11 — Integration and evidence

- [x] T023 Mount all agreed endpoints with bounded input/current session and private responses in `src/app/api/[...care]/route.ts`, `src/lib/monitoring-http.ts`; coordinator owns routes, `package.json`, `.env.example`.
- [ ] T024 Verify full tests/types/build and quickstart FR/AR/390px/privacy/offline/worker/model scenarios; record evidence in `docs/continuous-monitoring-status.md`.
- [ ] T025 Obtain four independent value/clinical/technical/business jury reports using Codex and Claude in `docs/judges/006/`; resolve findings and save five-minute rehearsal in `demos/continuous-monitoring.md`.

## Dependencies and parallel strategy

T001→T002→T003. T004/T010/pure T007 can work on disjoint files after contracts; patient-specific AI release requires T005. T005→T008→T012→T013. T015 follows access. T017/T019/T021 use verified access/evidence and may run independently. Claude shared lead completes transport/fences before delegating disjoint patient/doctor/guest views; no simultaneous writer of shared API/copy/provider files. T023 integrates each verified service incrementally; T024/T025 finish the complete feature, not only US1. No deployment or billing work is included.
