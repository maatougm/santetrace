# Data model — continuous monitoring

Planning artifact, 2026-10-11; these types are not yet product code. Canonical implementation files: `src/contracts/patient-platform.ts`, `src/contracts/monitoring.ts`, `src/contracts/external-visit.ts`; extend `src/contracts/care.ts` without changing existing IDs/history.

## Persistence and revisions

Keep `care_state` as one SQLite JSON row. Schema v2 adds accounts, doctor profiles, grants/invitations, structured access journal, legacy relationships, medical facts, condition evaluations, care proposals/plans/actions, protocols/applications, messages/contact requests, due tasks/worker leases, connectors, guest grants/sessions/notes and sourced report records. Add empty collections only for the approved features. Initial migration preserves every old resource and private path, runs after a consistent `VACUUM INTO` backup, and is idempotent on reopen. Historical assignments create legacy history only, never active sharing.

Use `PatientRevision {patientId, contextRevision, evidenceRevision, authorityRevision}`. Context increments on conditions/symptoms/treatments/allergies, unassessed clinical messages, relevant uploads/external notes and clinical-setting changes. Evidence increments on measurements and reviewed/corrected results. Authority increments on consent/grant changes. Never use one revision to freeze a protocol's original measurement forever.

`RevisionGuard {contextRevision,evidenceRevision,authorityRevision,carePlanRevision,profileVersions:string[],proposalRevision?:number,protocolRevision?:number}` is constructed server-side. AI proposals/report approval refer to a snapshot; reusable authorization fixes approved context/authority/plan/profile versions but each application computes a fresh evidence guard. Async results and delivery require the current per-operation guard.

CarePlan.revision identifies approved policy/bindings, not action progress. A measurement, reminder read, completed action or protocol-created action does not bump that policy revision. CarePlan.actionIds identify original approved actions/templates; PlanResponse includes repeat instances attributed to that plan/protocol without rewriting its approved policy. An explicit plan/profile change does bump revision and suspend affected protocols. Count committed applications and last application time across the protocol ID's history; a new version cannot replay the same trigger or silently reset the maximum/cooldown.

## Entities

| Entity | Required fields and invariants |
| --- | --- |
| AccountPrincipal | id, role, patientId/null, normalized login, salted passwordHash, enabled, sessionVersion, createdAt. Internal hash never serialized. Public registration fixes role=patient. |
| CareGrant | id, patientId, clinicianId, relationship primary/generalist/specialist, scopes, pending/active/revoked, issued/accepted/revoked timestamps, revision. One pending/active pair, at most one pending/active primary. |
| DoctorInvitation | grantId, exact targetClinicianId, tokenHash, 24-hour expiry, acceptedAt/null. Token shown once, acceptance cannot broaden permissions. |
| AccessJournalEntry | patientId, actor category/id/displayName, action, resource type/id, grant/version, outcome, at. No clinical text, tokens or credentials. |
| MedicalFact | id, patientId, kind condition/symptom/treatment/allergy, code/null, label, value string/null, polarity affirmed/negated/uncertain/unknown, verification, source refs, revision, createdAt, supersededBy/null. Patient confirmation confirms a declaration, not a clinical diagnosis. |
| SourceRef | kind measurement/observation/patient_fact/candidate/external_note/reference, id, revision/contentHash, date, verification, polarity, optional documentId/page/quote. Patient evidence belongs to that patient; reference namespace is separate. |
| MonitoringProfile | id/version, demonstration=true, conditionCodes, scopeLabel, rulePack demo_blood_pressure/demo_glucose, copied Rules, required source kinds/freshness/context, admitted verification, known coverage limits. No pulse or universal diagnosis pack. |
| ConditionEvaluation | id, patientId, conditionFactId, profile id/version/null, evaluatedAt, priority, coverage[], sources/reasons, nextDueAt/null, guard. Coverage complete/missing/stale/contradictory/awaiting_verification/unsupported. |
| CareProposal | id, patientId, revision, kind information/home_measurement/lab_exam, state pending/needs_inputs/needs_review/approved/rejected/expired, action template, sources, guard, decision/null, immutable revision history. |
| CarePlan | id, patientId, revision, state awaiting_clinician/active/suspended/revoked, clinicianId/null, profileBindings, actionIds, reviewDeadline/null. Without an accepted primary no active clinical plan or fictional monitoring team. |
| CareAction | id, patientId, proposal/protocol origin and version, exact approved template/parameters, dueAt, pending/completed/not_completed/cancelled, patient report timestamps, clientId. Completion is self-report, not clinical resolution. |
| ReusableProtocol | id/revision, patientId, clinicianId, authorityRevision, requiredContextRevision, carePlanRevision/profileVersions, active/suspended/revoked/expired, exact action template, predicates/exclusions/stop criteria, validUntil, minIntervalSeconds, maxApplications. Explicit approval only; no cross-patient transfer. |
| ProtocolApplication | id, protocolId/version, triggerId, fresh guard, authorized/blocked/delivered/expired, eligibility reasons, actionId/null, delivery timestamps. Unique protocol+trigger, limits checked atomically. |
| CareMessage | id/revision, patientId, clinicianId/threadId, author category/id, bounded plain text, clinical/administrative/approved_action kind, source actionId/null, createdAt/readAt, review null or {clinicianId,at,reason,guard}. New patient medical free text marks context unassessed. Reading is separate from clinical review and never resolves an alert. |
| ContactRequest | id/revision, patientId, clinicianId, requested/acknowledged/contact_reported/cancelled, messageId/null, attributed history. Request ≠ connected call; contact_reported is a participant declaration, no audio/video transport. |
| DueTask | id, patientId, kind evaluate/remind/review_overdue/protocol_apply, phaseKey, dueAt, attempts, pending/claimed/completed/failed/cancelled, leaseOwner/leaseUntil, guard. Unique phaseKey and expired lease recovery; no async transaction. |
| Connector | id, patientId, deviceId, kind simulator/device, credentialHash, enabled, revision. Patient association and simulation label resolved from server binding, not packet claims. |
| ExternalVisitGrant | id, patientId, selection refs+versions and frozen selected projection, appendGuestNotes=true, pending/active/revoked/expired, tokenHash, redeemBy, createdAt, revision. Later facts/corrections are not added implicitly; PDF content hash is fixed. |
| ExternalVisitSession | id, grantId, sessionHash, declaredName/organization, verification=unverified, openedAt, expiresAt, lastSeenAt, invalidatedAt. Separate guest credential; absolute 60 min/idle 15 min. |
| ExternalNote | id, patientId, grantId, sessionId, declared author snapshot, verification=external_unverified, plain text, consultationDate/null, receivedAt, correctsNoteId/null. Append only; correction adds a new entry. |

CareAction also has a revision for competing self-reports. Legacy immutable measurements/documents start source revision 1; document contentHash identifies its exact bytes. Observation revision is 1 + corrections count; its preserved revision history resolves previous selected values. SourceRef verification is confirmed/patient_reported/simulated/candidate/external_unverified/reference; polarity is affirmed/negated/uncertain/unknown. A reference remains outside the patient-fact namespace. Private frozen guest projections are retained only as medical data in the store, never in browser persistence or logs.

## Measurement extension

Use a discriminated union on the existing shared ID/patient/time/client/source fields. BP/glucose keep existing numeric fields and units; add pulse `{kind:"pulse",value:number,unit:"bpm",status:"unknown"}`. Extend source with `device`; retain app/telegram/simulated. Optional connector provenance: connectorId, deviceId, externalEventId, simulated, quality accepted/suspect. Pulse is not converted to glucose by an `else` branch. Suspect/unscored readings retain provenance and do not invent priorities.

## Permission projection

Scopes are `status|measurements|clinical|documents|summary|alerts|messages`. Primary needs all seven and may manage plans/profiles/lab reviews/protocols. Secondary doctors read granted sections and their own authorized conversation; no care-management authority from a specialty label alone. Summary/alerts require status+measurements+clinical+documents; invalid composite selections are rejected. Status-only projections omit raw values, hidden source IDs, treatment names and rules.

Owner views retain record/control access after doctor revocation. Full processing-consent withdrawal prevents new medical capture and clinician/guest processing but does not trap the owner outside their record. Guest authority is never an Actor clinician role. All source, search, report, replay and worker outputs resolve current permission before release.
