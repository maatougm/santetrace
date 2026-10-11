# Frozen interface proposal — feature 006

Reviewable contract, not implemented endpoints. All ordinary responses are private/no-store. Mutations use same-origin checks and bounded JSON; connector bearer ingress has its own credential checks. Error envelope remains `{error:{code,message}}`; unauthenticated 401, inaccessible 403/404, stale/replay conflict 409, invalid input 400, busy/unavailable 503. Tokens/passwords never appear in logs.

## Common types

Types in [data-model.md](../data-model.md) are the canonical entity definitions. Export `AccessEnvelope {owner:boolean,relationship:null|Relationship,scopes:SharingScope[],grantId:string|null,grantRevision:number|null,authorityRevision:number,canManageCare:boolean,canReviewLabs:boolean}`. `authorityRevision` is the monotonically increasing per-patient authority revision, including downgrades. Move the existing seven-field PatientRecord shape into shared `CareRecord` in care.ts and reexport the client name for compatibility. Define `ProjectedRecord = Omit<CareRecord,"patient"> & {patient:Omit<Patient,"rules"> & {rules:Rules|null},access:AccessEnvelope,medicalFacts:MedicalFact[],plan:CarePlan|null,actions:CareAction[],evaluations:ConditionEvaluation[],monitoring:MonitoringState|null,proposals:(CareProposal|ProposalStatus)[]}`. Do not extend an interface while incompatibly overriding rules. Denied sections are empty/null, never raw data hidden by UI. Patient pending proposals are only `{id,revision,kind,state}`: no name, action, parameters, source explanation or hypothesis. Full drafts/reports require the applicable clinician capabilities.

The new record is not an offline-cache payload. Preserve existing owner measurement/reminder facilities; an explicit allowlist may display previously approved fixed plan actions with an offline timestamp. Never persist clinician/guest records, grants, credentials, pending exams or hypotheses in browser storage. New action reports/chat/protocol authorization require online service; existing reminder_ack outbox remains supported.

`MutationKey {clientId:string}`; revisioned mutation inputs also contain `expectedRevision:number`. `ProposalDecision` adds `decision:"approve"|"reject",expectedGuard:RevisionGuard,reason:string`; `ProposalEdit` adds a validated replacement ActionTemplate and sources. `ActionTemplate {templateId:string,templateVersion:number,parameters:Record<string,string|number|boolean>}` uses a closed server registry, no expression execution/free-form autonomous prescription. Secret issuance is the exception to exact replayed response bytes: durable idempotency stores metadata/hashes only, so a replay returns the existing grant/connector with invitationToken, credential or url=null. Lost secrets require explicit replacement/revocation; retries never create a second grant or persist a raw secret in a replay result.

`GenerationOptions {signal?:AbortSignal,timeoutMs?:number,clientId?:string}`; HTTP proposal/report generation requires a mutation clientId, with service replay checked against current authority and guard before release. `AiMeta {mode:"local_model"|"deterministic",model:string|null,schemaVersion:string,promptVersion:string,guard:RevisionGuard,generatedAt:string,stale:boolean,failureReason:AiFailure|null}`. AiFailure is disabled/provider_unavailable/timeout/aborted/busy/invalid_output/no_evidence/stale_context, never provider stack or prompt text. AI endpoints receive no client-built authorized snapshots. Grounded claims contain category, allowlisted claim/template code, validated parameters and SourceRef IDs. The server renders values and links; quotations, numbers, dates and polarity must match sources. Unsupported claims or properties cause fallback, not partial medical record mutation.

## Account, owner rights and existing integration

| Method/path | Input → response |
| --- | --- |
| POST /api/accounts | login/password/displayName/region/age 18..120/language fr or ar/consent=true/fictionalDemo=true/clientId, optional claimCode → `{actor,patientId}` plus account cookie |
| POST /api/session | login/password → existing `{actor,mode:"fictional_demo"}` and cookie; legacy role/password or one-time-code login retired |
| GET/DELETE /api/session | existing actor envelope / `{ok:true}`; actor resolved from enabled current registry |
| GET /api/doctors | → `{doctors:DoctorProfile[]}`; authenticated fictional directory |
| GET/POST /api/patients/:id/grants | list / targetClinicianId, relationship, scopes, clientId → `{grant,invitationToken:string|null}`; secret returned once, 24 h; null on replay |
| POST /api/doctor-invitations/accept | token, clientId → `{grant}`; authenticated exact target doctor |
| GET /api/doctor-invitations | → `{invitations:DoctorInvitationSummary[]}`; exact target doctor metadata only, no raw tokens |
| PATCH /api/grants/:id | scopes or revoke, expectedRevision, clientId → `{grant}`; owner only; no silent primary promotion |
| GET /api/patients/:id/access-journal | cursor/limit<=100 → `{entries,nextCursor}`; owner only |
| GET /api/patients/:id, /dashboard, /summary, /export | same endpoints, now projected from current grants and aggregate coverage |
| Existing PDF upload/source, candidate/observation review | same paths/limits; primary writes, current document capability checked before and after async work |

Old POST /api/patients and /patients/:id/invite return 410 with guidance to patient-owned enrollment. A local `scripts/claim-demo-patient.ts` issues one-use owner claim codes to preserve legacy IDs; no automatically active doctor relationship.

Server signatures: `PatientAccountService.initialize():Promise<void>`, `register(input:AccountRegistration):Promise<Actor>`, `login(input:AccountLogin):Promise<Actor>`; `resolveSessionActor(request:Request,store:CareStore):Actor|null`; `LoginThrottle.runAsync<T>(scope:string,action:()=>Promise<T>):Promise<T>`; `resolvePatientAccess(state:CareState,actor:Actor,patientId:string):AccessEnvelope`; `projectPatientRecord(state:CareState,actor:Actor,patientId:string):ProjectedRecord`. All typed account/grant DTOs live in `src/contracts/patient-platform.ts`, not separate frontend definitions.

`PatientAccessService.issue(actor:Actor,patientId:string,input:GrantIssue):GrantIssueResult`; `accept(actor:Actor,input:GrantAccept):CareGrant`; `update(actor:Actor,id:string,input:GrantUpdate):CareGrant`; `list(actor:Actor,patientId:string):CareGrant[]`; `journal(actor:Actor,patientId:string,cursor:string|null,limit:number):JournalResponse`. Directory/invitation lists are registry-filtered reads; accepting still requires the owner-issued secret, entered explicitly or read from its fragment.

## Supervised loop and interventions

| Method/path | Input → response |
| --- | --- |
| GET/POST /api/patients/:id/onboarding | current questions/facts / answers `{questionId,value,polarity}`, clientId, expectedContextRevision → `{facts,questions,meta}`; fields/questions are registry-backed |
| POST /api/patients/:id/medical-facts | FactInput → `{fact}`; owner declaration only, never model-confirmed |
| PATCH /api/medical-facts/:id | FactCorrection → `{fact}`; appends new version and retains old fact/source history |
| GET /api/patients/:id/proposals | → `{proposals}`; same capability projection as generation |
| POST /api/patients/:id/proposals/generate | clientId → `{proposals,meta}`; patient sees projected statuses, clinician sees full drafts |
| GET /api/patients/:id/care-plan | → `{plan,actions,evaluations,coverage}` |
| PATCH /api/patients/:id/care-plan | activate/suspend, profileBindings, expectedRevision, clientId → same envelope; active primary only |
| PATCH /api/proposals/:id | edit/approve/reject, expectedRevision, expectedGuard, reason, clientId → `{proposal,plan,action:null|CareAction}`; edit creates a revision before approval |
| POST /api/actions/:id/reports | completed/not_completed, expectedRevision, clientId → `{action}`; patient self-report |
| POST /api/patients/:id/report | clientId → `{report,meta}`; clinician with required scopes only; facts fallback when AI fails |
| GET/POST /api/patients/:id/messages | after cursor / text<=2000, kind clinical or administrative, clinicianId, clientId → `{messages,nextCursor}` / `{message}` |
| POST /api/messages/:id/read | clientId → `{message}`; current thread participant only |
| POST /api/messages/:id/review | expectedRevision, expectedGuard, reason, clientId → `{message}`; active primary marks clinical context reviewed; separate from read |
| POST /api/patients/:id/contact-requests | clinicianId, clientId → `{contactRequest}`; no connected-call claim |
| PATCH /api/contact-requests/:id | acknowledge/contact_reported/cancel, expectedRevision, reason, clientId → `{contactRequest}`; attributable participant report, no inferred connection |
| Existing PATCH /api/alerts/:id | acknowledge/resolve/reject with note and current authority; does not equate delivery/read/completion with resolution |

Server signatures: `evaluateCondition(input:ConditionEvaluationInput,now:string):ConditionEvaluation`; `aggregateMonitoring(evaluations:ConditionEvaluation[],unresolved:Alert[]):MonitoringState`; `CarePlanService.reviewProposal(actor:Actor,id:string,input:ProposalDecision):ProposalReviewResult`; `reviseProposal(actor:Actor,id:string,input:ProposalEdit):CareProposal`; `updatePlan(actor:Actor,patientId:string,input:PlanUpdate):PlanResponse`; `reportAction(actor:Actor,id:string,input:ActionReportInput):CareAction`; `InterventionService.sendMessage(actor:Actor,patientId:string,input:MessageInput):CareMessage`, `reviewMessage(actor:Actor,id:string,input:MessageReview):CareMessage`, `requestContact(actor:Actor,patientId:string,input:ContactInput):ContactRequest`, `updateContact(actor:Actor,id:string,input:ContactUpdate):ContactRequest`. Read/review/contact changes do not silently resolve an alert or reactivate a protocol.

`MonitoringAiService.recordFact(actor:Actor,patientId:string,input:FactInput):MedicalFact` and `correctFact(actor:Actor,id:string,input:FactCorrection):MedicalFact` use the same sourced fact store as onboarding; capture does not require model availability.

`MonitoringState {priority:Status,coverage:Coverage[],reasons:string[],evaluatedAt:string}`. `ConditionEvaluationInput {condition:MedicalFact,profile:MonitoringProfile|null,plan:CarePlan|null,evidence:EvidenceSnapshot,guard:RevisionGuard}` supplies sourced evidence; only the profile's admitted sources are evaluated. Existing high-only rules retain visible low-direction coverage limitation; no invented low thresholds. Orange/red evidence remains visible despite partial coverage; global green requires all required current coverage and no recorded uncovered condition.

`MonitoringAiService.onboarding(actor:Actor,patientId:string,input:OnboardingInput|null,options?:GenerationOptions):Promise<OnboardingResponse>`, `generateProposals(actor:Actor,patientId:string,options?:GenerationOptions):Promise<ProposalGenerationResponse>`, `report(actor:Actor,patientId:string,options?:GenerationOptions):Promise<ReportResponse>`. GET onboarding passes null and does not mutate facts. Names above match HTTP response envelopes. Prompt candidates are typed/allowlisted; missing/negated/uncertain assertions remain separate.

## Protocols, assistant and worker

| Method/path | Input → response |
| --- | --- |
| GET/POST /api/patients/:id/protocols | list / sourceProposalId, approved action, predicates/exclusions, expiry, minIntervalSeconds, maxApplications, expectedGuard, clientId → `{protocol}`; explicit primary authorization |
| PATCH /api/protocols/:id | suspend/revoke/revise, expectedRevision, clientId; revise also contains current expectedGuard and full bounded authorization → `{protocol}`; explicit primary review creates immutable new version |
| GET /api/patients/:id/protocol-applications | → `{applications}` with blocked reasons, versions and sources |
| POST /api/patients/:id/assistant | AssistantInput → AssistantResponse; no new medical instructions |

`ProtocolPredicate` is a closed union: `priority_equals(conditionFactId,"orange")`, `evidence_fresh(requirementId,maxAgeSeconds)`, `fact_equals(factId,polarity)`, `requirements_complete(requirementIds:string[])`. Required protocol inputs must be complete; do not demand universal whole-disease coverage for an explicitly bounded demo follow-up action. Unknown exclusion evaluation blocks reuse. Any unresolved red blocks orange reuse. First demo reusable action is home-measurement/follow-up only; no repeated autonomous lab order or medication change.

`ProtocolService.authorize(actor:Actor,patientId:string,input:ProtocolAuthorization):ReusableProtocol`; `revise(actor:Actor,id:string,input:ProtocolReviewInput):ReusableProtocol`; `setState(actor:Actor,id:string,input:ProtocolStateInput):ReusableProtocol`; `evaluateEligibility(input:EligibilityInput,now:string):EligibilityResult`; `apply(protocolId:string,triggerId:string,expectedGuard:RevisionGuard,now:string):ProtocolApplication`. Apply is worker-internal, never public patient authorization. `EligibilityResult {eligible:boolean,reasons:string[],guard:RevisionGuard}`. `EligibilityInput {protocol:ReusableProtocol,plan:CarePlan|null,guard:RevisionGuard,hasCurrentAuthority:boolean,hasUnassessedContext:boolean,consent:boolean,evidence:EvidenceSnapshot,evaluations:ConditionEvaluation[],applications:ProtocolApplication[],unresolved:Alert[]}` is built server-side. All history retains the exact original version; reviewing a clinical message does not create a new protocol revision.

`MonitoringWorker.tick(now:string,workerId:string):Promise<TickResult>` reserves due work in synchronous transactions, works outside them, then rechecks guards. Wake every 15 s as a demo cadence; leased tasks recover after 60 s. In-app insertion/idempotency is atomic. No browser, external notification or Next timer is required. New medical free text is unassessed context until reviewed, never inferred as a safe exclusion by the model.

## Search, connectors and external visits

| Method/path | Input → response |
| --- | --- |
| POST /api/patients/:id/search | query<=500, clientId → `{hits,noEvidence,mode}`; only current authorized source candidates; mode semantic or lexical |
| GET/POST /api/patients/:id/connectors | list / deviceId, kind simulator/device, clientId → `{connector,credential:string|null}`; credential shown once, null on replay |
| PATCH /api/connectors/:id | revoke, expectedRevision, clientId → `{connector}`; owner |
| POST /api/connectors/events | bearer credential; externalEventId, typed reading/unit, measuredAt → `{measurement,alert,monitoring}`; server resolves patient/simulation identity; current binding checked before replay |
| POST /api/patients/:id/connectors/:connectorId/simulate | authenticated owner, typed reading, measuredAt, externalEventId → same; source always simulated |
| GET/POST /api/patients/:id/external-visits | list / selected resource IDs+versions, clientId → `{grant,url:string|null}`; one-use secret in URL fragment, shown once, null on replay |
| PATCH /api/external-visits/:id | revoke, expectedRevision, clientId → `{grant}`; owner |
| POST /api/external-visits/redeem | token, declaredName<=100, organization<=100 → `{visit}` plus distinct guest session cookie; explicit interaction |
| GET /api/external-visit/record | → `{visit,selection,notes}`; ignores account actor authority |
| DELETE /api/external-visit/session | → `{ok:true}`; invalidates server session and clears guest cookie; neutral result even if already ended |
| GET /api/external-visit/documents/:id/source | PDF bytes; every whole/range read checks live guest selection/version/consent |
| POST /api/external-visit/notes | text<=4000, consultationDate/null, correctsNoteId/null, clientId → `{note}`; append-only, unverified |

GET/HEAD `/share` are generic public pages and reveal/consume nothing. The guest session cookie supports multiple reads; a redeemed URL cannot issue another session. Invalid, consumed, expired or revoked links and unavailable sessions return the same `404 VISIT_UNAVAILABLE`; owner grant status remains visible only to the owner. Failed response/cookie after redemption requires a replacement link. Session expiry/revocation prevents future release; clients clear data on their next revalidation/denial and discard held responses. No measured cross-tab timing is promised. Existing notes remain with owner. No guest AI generation or medical-setting rights.

`SemanticSearchService.search(actor:Actor,patientId:string,query:string,options?:GenerationOptions):Promise<SearchResponse>`; `ConnectorService.ingest(credential:string,input:ConnectorEvent):MeasurementReceipt`; `simulate(actor:Actor,patientId:string,connectorId:string,input:ConnectorEvent):MeasurementReceipt`; `ExternalVisitService.issue(actor:Actor,patientId:string,input:VisitSelectionInput):VisitIssueResult`; `redeem(input:VisitRedeemInput):VisitSessionResult`; `record(sessionToken:string):GuestRecord`; `appendNote(sessionToken:string,input:GuestNoteInput):ExternalNote`; `source(sessionToken:string,documentId:string):Promise<SourceFile>`; `endSession(sessionToken:string):void`. `SourceFile = Buffer` is server-only, matching the existing source reader; HTTP handlers construct trusted PDF headers, never model text.

## DTO field glossary

Export account/grant types from patient-platform.ts, loop/AI/protocol types from monitoring.ts, guest types from external-visit.ts. The tables above define HTTP envelopes. For every signature below, IDs/time/source/authority are server-resolved unless explicitly an input. No alias is an opaque unvalidated JSON object.

| Type | Fields |
| --- | --- |
| Relationship / SharingScope | primary/generalist/specialist; status/measurements/clinical/documents/summary/alerts/messages |
| AccountRegistration / AccountLogin | Registration fields from POST /accounts; login {login,password}. Extra role, patientId, clinicianId, enabled or verification fields are rejected. |
| GrantIssue / GrantIssueResult / GrantAccept | input {targetClinicianId,relationship,scopes:SharingScope[],clientId}; result {grant:CareGrant,invitationToken:string\|null}; accept {token,clientId} |
| GrantUpdate / DoctorInvitationSummary / JournalResponse | update is {action:revoke,expectedRevision,clientId} or {action:update,scopes:SharingScope[],expectedRevision,clientId}; summary {id,grantId,patientDisplayName,relationship,scopes,expiresAt,state} for the target only; journal {entries:AccessJournalEntry[],nextCursor:string\|null} |
| EvidenceSnapshot | patientId, guard, sources:SourceRef[], chunks:SourceChunk[], facts:MedicalFact[], coverage:Coverage[]; server-built/redacted view scoped to the operation |
| SourceChunk | id, source:SourceRef, text:string, extractionVersion:string; reference IDs occupy separate namespace |
| GroundedClaim / ValidatedOutput | claim {category:confirmed_fact\|patient_statement\|candidate\|change\|contradiction\|missing\|hypothesis,code:string,parameters:Record<string,string\|number\|boolean>,sourceIds:string[]}; validated {claims:GroundedClaim[],questionIds:string[],proposals:ProposalDraft[]} from closed registries. ProposalDraft {kind,action:ActionTemplate,sources:SourceRef[],missingQuestionIds:string[]} |
| GroundedPrompt | {purpose:onboarding\|proposals\|report,schemaVersion,promptVersion,snapshot:EvidenceSnapshot,allowedCodes:string[]}; native adapter receives only redacted fields and fixed system instructions, no tools or user-selected provider URL |
| OnboardingInput / OnboardingResponse | input {answers:{questionId,value:string\|number\|boolean\|null,polarity}[],expectedContextRevision,clientId}; response {facts:MedicalFact[],questions:OnboardingQuestion[],meta:AiMeta}; question {id,labelKey,answerKind,allowedValues:string[],required:boolean} |
| FactInput / FactCorrection | input {kind:condition\|symptom\|treatment\|allergy,code:string\|null,label:string,value:string\|null,polarity,expectedContextRevision,clientId}; correction also {expectedRevision,reason}. Label<=200/value<=2000; server derives provenance/time and patient_reported verification; code is nullable registry-backed, free labels cannot select a monitoring rule pack |
| ProposalGenerationResponse / ReportResponse | {proposals:(CareProposal\|ProposalStatus)[],meta:AiMeta}; {report:ClinicianReport,meta:AiMeta}. ProposalStatus {id,revision,kind,state}. ClinicianReport {id,revision,guard,claims:GroundedClaim[],sources:SourceRef[],createdAt,stale:boolean}; report rendered from validated claims, never arbitrary raw HTML |
| ProfileBinding / PlanResponse / PlanUpdate | binding {conditionFactId,profileId,profileVersion}; response {plan:CarePlan\|null,actions:CareAction[],evaluations:ConditionEvaluation[],coverage:Coverage[]}; update {action:activate\|suspend,profileBindings:ProfileBinding[],expectedRevision,clientId} |
| ProposalReviewResult / ActionReportInput | {proposal:CareProposal,plan:CarePlan\|null,action:CareAction\|null}; input {state:completed\|not_completed,expectedRevision,clientId} |
| MessageInput / MessageReview | {text,kind:clinical\|administrative,clinicianId,clientId}; review {expectedRevision,expectedGuard:RevisionGuard,reason,clientId}. All free medical patient text is unassessed; a claimed administrative flag cannot authorize reuse. |
| ContactInput / ContactUpdate | {clinicianId,clientId}; update {action:acknowledge\|contact_reported\|cancel,expectedRevision,reason,clientId}; patient or clinician report is attributed, not proof of call transport |
| ProtocolAuthorization | {sourceProposalId,actions:ActionTemplate[],predicates:ProtocolPredicate[],exclusions:ProtocolPredicate[],stopCriteria:ProtocolPredicate[],validUntil,minIntervalSeconds,maxApplications,expectedGuard,clientId}; approved proposal belongs to the same patient, home-follow-up only in first demo |
| ProtocolReviewInput / ProtocolStateInput | review is ProtocolAuthorization plus expectedRevision and reason; state {action:suspend\|revoke,expectedRevision,reason,clientId}. Authority/context/plan/profile bindings come from the current server guard, not editable client assignments |
| AssistantInput / AssistantResponse | input is {kind:record_query,topic:next_action\|last_measurement\|plan_status,clientId} or {kind:question\|health_update,question:string,clientId}; response {replyKind:record_answer\|approved_action\|needs_clinician\|unavailable,answer:string,approvedActions:CareAction[],sources:SourceRef[],messageId:string\|null,meta:AiMeta} |
| TickResult | {claimed:number,completed:number,failed:number,heartbeatAt:string} |
| SearchResponse / SearchHit | {hits:SearchHit[],noEvidence:boolean,mode:semantic\|lexical}; hit {id,source:SourceRef,excerpt:string,score:number\|null}; source links generated from permitted IDs, no model URL |
| ConnectorEvent / MeasurementReceipt | event {externalEventId,measuredAt,reading:ReadingInput,quality:accepted\|suspect}; reading union BP {kind:blood_pressure,systolic,diastolic,unit:mmHg}, glucose {kind:glucose,value,unit:mg/dL\|mmol/L}, pulse {kind:pulse,value,unit:bpm}; receipt {measurement:Measurement,alert:Alert\|null,monitoring:MonitoringState} |
| VisitSelectionInput / VisitIssueResult | input {selection:{kind:measurement\|observation\|patient_fact\|document\|approved_action,id,revision}[],clientId}; result {grant:ExternalVisitGrant,url:string\|null}; server freezes selected projection/versions, whole selected PDF is disclosed |
| VisitRedeemInput / VisitSessionResult | input {token,declaredName,organization}; result {visit:GuestVisit,sessionToken:string}; raw sessionToken is server-internal, HTTP JSON includes visit only and sets HttpOnly cookie |
| GuestVisit / GuestRecord | visit {id,grantId,declaredName,organization,verification:unverified,openedAt,expiresAt,idleExpiresAt}; record {visit,selection:GuestSelection,notes:ExternalNote[]}; GuestSelection {measurements:Measurement[],observations:Observation[],medicalFacts:MedicalFact[],documents:Document[],actions:CareAction[]} contains only frozen selected versions, no rules/grants or additional facts |
| GuestNoteInput | {text,consultationDate:string\|null,correctsNoteId:string\|null,clientId}; correction may refer only to an earlier note from this guest grant, server attributes declared author |

Assistant record queries use fixed topics. Free medical questions/updates create a clinical message only with an accepted authorized recipient; otherwise return needs_clinician with messageId=null and an honest pending state. Explanations may cite the record or approved plan, but cannot add medical instructions. Changed medical text blocks affected reuse until context review plus explicit protocol revision.

## Model and resource budgets

Only configured loopback Ollama, no URL from user/model. Generation default gemma4:12b, embeddings qwen3-embedding:4b; both already installed. Use schema object/stream=false/think=false for generation and truncate=false for embeddings; reject unexpected JSON before use. Sources: [generate API](https://docs.ollama.com/api/generate), [embed API](https://docs.ollama.com/api/embed).

Generation hard budget 30 s, embedding 15 s, client AI timeout 45 s; one active model operation and at most two waiting, otherwise busy/fallback. Bound to <=40 evidence chunks, <=1000 characters each, <=20,000 context characters, <=10 model claims/proposals, topK<=5. Cache local vectors by source hash/version/model only and filter authorized chunks before scoring; do not persist authorization in vectors. Similarity acceptance threshold is a versioned demo parameter, never clinical evidence. Lexical/no-evidence fallback remains explicit. Private derived data stays outside Git/device caches; identifiers redacted before model work, and nonfictional input disabled for this prototype.
