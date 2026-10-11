# Implementation Plan: Continuous Patient Monitoring

**Branch**: `codex/hackcure` | **Feature ID**: `006-continuous-patient-monitoring` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Corrected multi-condition specification, approved with “Oui, prépare le plan Codex + Claude”. Planning is complete; implementation awaits review of the concrete plan. The setup script's logical feature name is not a Git checkout change.

## Summary

Continue HackCure's record, measurements, private PDFs and clinician queue. Add durable patient accounts and chosen doctor access, adaptive sourced onboarding, independently reviewed measurement/exam proposals, an approved plan, condition-specific evaluation, actual messages and traceable actions. Reusable advice requires explicit same-patient authorization and current deterministic eligibility. Extend the completed loop with semantic search, an identified simulator and one-use external consultation permitting selected historical reads and unverified appended notes.

The executable breakdown is the [Codex + Claude master plan](../../docs/superpowers/plans/2026-10-11-continuous-patient-monitoring.md), with four independently reviewable subplans. Codex owns contracts, server, data, worker and integration; Claude Code owns frontend against those contracts. Do not dispatch obsolete feature 005.

## Technical Context

**Language/Version**: TypeScript 5.9, Node >=24, existing Next.js 16/React 19. Read locally installed Next guides before code.

**Primary Dependencies**: Existing PDF.js 6.4.299/Recharts and Node crypto/fetch/SQLite. Local Ollama generation and embedding adapters; no new dependency, ORM, vector database or agent framework. Existing optional Supabase/Telegram prototypes are not the authoritative runtime for this feature.

**Storage**: One private persistent CareStore SQLite state row, schema v2 preserving all resource IDs/history/replay keys; existing private source PDFs and a private derived vector cache. A consistent backup precedes disk migration; no reset or parallel database.

**Testing**: Existing tsx/Node test runner and frontend state tests; focused tests per task, then npm test/typecheck/build. Real browser FR/AR, keyboard and 390px viewport acceptance; concurrent revoke/held-output and worker restart checks. Synthetic fixtures only. No feature006 product checks have been run during planning.

**Target Platform**: Local Node web app at http://127.0.0.1:3001, patient browser/PWA and doctor/guest browsers. Separate Node worker shares CareStore; no open page required for due work.

**Project Type**: Existing single-repository web application and background CLI process.

**Performance Goals**: Observable 15-second demonstration worker tick and 60-second recoverable leases. Model transport generation budget 30 seconds, embedding 15 seconds, client AI deadline 45 seconds. Ordinary client deadline remains 15 seconds, upload 60 seconds. These are resource/demo budgets, not clinical response guarantees or measured throughput.

**Constraints**: Fictional data only; PDFs <=5 MiB/20 pages; French/Arabic fixed copy and French clinician AI drafts. No hardware, video transport, autonomous diagnosis/prescription or invented missing thresholds. Four concurrent Codex slots including coordinator; Claude separately delegates disjoint frontend files. No deployment/commit/push required by this request.

**Scale/Scope**: One synthetic patient demonstrates eight stories and FR-001..028, three configured fictional doctors and one external session. Small identified reference library and bounded evidence/model queues; no production capacity claim. Preserve existing measurement/reminder offline facilities with an explicit owner cache allowlist.

Server-only configuration planned in the coordinator-owned `.env.example`: retain SESSION_SECRET, APP_ORIGIN, HACKCURE_CARE_DATABASE_PATH and HACKCURE_DOCUMENT_DIRECTORY; primary fictional doctor uses existing DEMO_CLINICIAN_PASSWORD, add DEMO_GENERALIST_PASSWORD and DEMO_SPECIALIST_PASSWORD. Registry logins are medecin.ref, medecin.general and medecin.specialiste; preserve existing primary actor ID demo-clinician. Add HACKCURE_LOCAL_AI_ENABLED, HACKCURE_OLLAMA_BASE_URL (loopback only), HACKCURE_GENERATION_MODEL, HACKCURE_EMBEDDING_MODEL and HACKCURE_VECTOR_INDEX_PATH. Model defaults: gemma4:12b/qwen3-embedding:4b; cache under .data. No secrets in NEXT_PUBLIC variables or documented example passwords.

## Constitution Check

[Constitution v1.1.0](../../.specify/memory/constitution.md), evaluated before research and again against the design:

| Principle | Pre-design | Post-design evidence |
| --- | --- | --- |
| I — Clinician authority/deterministic priority | Pass | B1 versioned scoped rules; B3 per-item review; C1 explicit protocol; fixed red path bypasses model. No low-threshold invention. |
| II — Source-linked facts | Pass | B2 preserves polarity/provenance and candidate review; history/version guards; D3 authorized source chunks. Model outputs are drafts. |
| III — Privacy/role isolation | Pass | A1 registry; A2 capability projection; A3 client fences; D1 separate guest authority; every async output/replay rechecked. Local model redaction and synthetic-input guard. |
| IV — Resilience/honest delivery | Pass | Existing owner outbox retained; approved fixed plans available under allowlist; B4 real in-app messages; C2 durable worker; deterministic fallback and honest unavailability. |
| V — Evidence before completion | Pass | Focused failure tests and independent reviews per task; full integration/browser scenarios and four jury perspectives before completion claims. |

No design violation or unresolved technology clarification remains. Software tests do not establish clinical validation. Spec approval is recorded; concrete implementation-plan review remains pending. No `.specify/extensions.yml` exists, so before_plan/after_plan hooks are absent.

## Project Structure

### Documentation

```text
specs/006-continuous-patient-monitoring/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── checklists/requirements.md
docs/superpowers/plans/
├── 2026-10-11-continuous-patient-monitoring.md
├── 2026-10-11-monitoring-accounts.md
├── 2026-10-11-monitoring-loop.md
├── 2026-10-11-monitoring-protocols.md
└── 2026-10-11-monitoring-extensions.md
```

Phase 1 ends here. A Spec Kit tasks.md may be generated from the approved task breakdown during the execution handoff; it is not required or created by the plan command.

### Source Code

```text
src/contracts/                 # care.ts extensions + patient-platform/monitoring/external-visit types
src/lib/
  care-store.ts                # authoritative state, migration, synchronous transactions
  care-migrations.ts           # new preserving schema transition
  patient-*-service.ts         # new accounts/access services
  monitoring-*.ts              # new evaluation, AI/content and worker modules
  medical-evidence.ts          # new sourced/redacted snapshots and validation
  local-model.ts               # new bounded loopback adapter
  care-plan-service.ts         # new decisions/actions
  protocol-service.ts          # new explicit reusable authority
  intervention-service.ts     # new messages/contact reports
  semantic-search.ts           # new authorized retrieval
  connector-service.ts         # new shared-timeline ingress
  external-visit-*.ts           # new guest service and session
  client/                      # existing runtime, focused API/copy modules, request fences
src/app/api/                   # existing catchall + dedicated PDF/guest routes
src/app/patient/                # existing routes + record/onboarding/plan/messages/doctors/share
src/app/doctor/                 # existing queue/record + shared patient access layout
src/app/share/                  # new public landing and memory-only guest session
src/components/                # existing components plus focused patient/doctor/guest views
scripts/                       # new owner-claim and monitoring worker commands
tests/                         # focused contract/service/privacy/frontend tests
research/                      # identified demo reference manifest
```

**Structure Decision**: Keep one application/store, reuse native and existing libraries, and split only the growing frontend transport/copy modules and explicitly requested service responsibilities. Subplans identify edited files and interfaces. Do not add a parallel patient runtime, measurement table or permission cache.

## Complexity Tracking

No constitution violation needs justification. Independent worker and guest authority are necessary for the explicit periodic-follow-up and one-use read/append requirements; they do not introduce external infrastructure.
