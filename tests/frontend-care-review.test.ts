import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AiMeta,
  CareAction,
  CarePlan,
  CareProposal,
  ClinicianReport,
  ConditionEvaluation,
  GroundedClaim,
  MedicalFact,
  MonitoringState,
  ProposalStatus,
  ProtocolApplication,
  RevisionGuard,
  SourceRef,
} from '../src/contracts/monitoring';
import { PARTIAL_COVERAGE_LABEL, displayPriority, globalMonitoringView, isPartialCoverage, uncoveredConditions } from '../src/components/doctor/care/coverage';
import {
  EDITABLE_TEMPLATE_IDS,
  buildDecisionInput,
  buildEditInput,
  groupProposals,
  proposalReviewGate,
} from '../src/components/doctor/care/proposal-review';
import { claimParameterRows, groupClaims, isReportStale, resolveClaimSources } from '../src/components/doctor/care/report-claims';
import { nextAttempt } from '../src/components/doctor/care/idempotency';
import { classifyConflict } from '../src/components/doctor/care/outcome';
import { ApiError } from '../src/lib/client/transport';
import { CARE_COPY } from '../src/lib/client/copy/care';
import { AI_MODE_BADGE, aiModeBadge } from '../src/components/doctor/care/ai-mode-badge';
import { bindToFence, createAccessFence, type AccessFence } from '../src/lib/client/access-fence';
import type { AccessEnvelope } from '../src/contracts/patient-platform';
import { applyWhenCurrent, documentPermissions, labReviewControls, LAB_REVIEW_RESERVED } from '../src/components/doctor/care/section-access';
import { buildDeadlineEdit, buildPlanUpdate } from '../src/components/doctor/care/plan-update';
import { factLabelById } from '../src/components/doctor/care/fact-labels';
import { APPROVAL_LABEL, actionApprovalView } from '../src/components/doctor/care/action-approval';
import { applicationLogView, deliveredCount } from '../src/components/doctor/care/protocol-log';
import { toDateTimeLocalValue } from '../src/lib/client/format';

const guard: RevisionGuard = {
  contextRevision: 7,
  evidenceRevision: 12,
  authorityRevision: 3,
  carePlanRevision: 2,
  profileVersions: ['demo-v1'],
  proposalRevision: 4,
};

const proposal = (overrides: Partial<CareProposal> = {}): CareProposal => ({
  id: 'prop-1',
  patientId: 'patient-1',
  revision: 4,
  kind: 'home_measurement',
  state: 'pending',
  action: { templateId: 'home.blood_pressure', templateVersion: 1, parameters: {} },
  sources: [source('fact-1')],
  guard,
  decision: null,
  history: [],
  ...overrides,
});

function source(id: string, overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    kind: 'patient_fact',
    id,
    revision: 1,
    contentHash: null,
    date: '2026-10-10T08:00:00.000Z',
    verification: 'patient_reported',
    polarity: 'affirmed',
    ...overrides,
  };
}

/** Current server guard (record.guard): the five fields the server compares. */
const current: RevisionGuard = { contextRevision: 7, evidenceRevision: 12, authorityRevision: 3, carePlanRevision: 2, profileVersions: ['demo-v1'] };
const manager = { canManageCare: true, conflicted: false, currentGuard: current };
const at = { currentGuard: current };

test('a decision carries the reviewed proposal revision and the current record guard', () => {
  const result = buildDecisionInput(proposal(), 'approve', '  vu en consultation ', 'client-1', at);
  assert.ok(result.ok);
  assert.deepEqual(result.input, {
    decision: 'approve',
    expectedRevision: 4,
    expectedGuard: current,
    reason: 'vu en consultation',
    clientId: 'client-1',
  });
});

test('every decision requires a reason (the server refuses an empty one), bounded in length', () => {
  assert.equal(buildDecisionInput(proposal(), 'approve', '', 'c', at).ok, false);
  assert.equal(buildDecisionInput(proposal(), 'approve', '  ', 'c', at).ok, false);
  assert.equal(buildDecisionInput(proposal(), 'reject', '', 'c', at).ok, false);
  assert.equal(buildDecisionInput(proposal(), 'reject', '   ', 'c', at).ok, false);
  assert.equal(buildDecisionInput(proposal(), 'reject', 'x'.repeat(501), 'c', at).ok, false);
  const ok = buildDecisionInput(proposal(), 'reject', 'Mesure déjà prévue', 'c', at);
  assert.ok(ok.ok);
  assert.equal(ok.input.decision, 'reject');
});

test('a proposal missing inputs or hit by a conflict cannot be approved; needs_review is the awaiting state', () => {
  const inputs = proposal({ state: 'needs_inputs' });
  assert.equal(proposalReviewGate(inputs, manager).canApprove, false);
  assert.equal(proposalReviewGate(inputs, manager).recheck, 'inputs');
  assert.equal(buildDecisionInput(inputs, 'approve', 'motif', 'c', at).ok, false);
  const conflicted = proposalReviewGate(proposal(), { ...manager, conflicted: true });
  assert.equal(conflicted.canApprove, false);
  assert.equal(conflicted.recheck, 'conflict');
  assert.equal(buildDecisionInput(proposal(), 'approve', 'motif', 'c', { ...at, conflicted: true }).ok, false);
  // The server creates and edits drafts as needs_review: it is the awaiting-decision state, approvable.
  const awaiting = proposal({ state: 'needs_review' });
  assert.equal(proposalReviewGate(awaiting, manager).canApprove, true);
  assert.equal(buildDecisionInput(awaiting, 'approve', 'motif', 'c', at).ok, true);
  const fresh = proposalReviewGate(proposal(), manager);
  assert.deepEqual(fresh, { canApprove: true, canReject: true, canEdit: true, mustRecheck: false, decided: false, recheck: null });
});

test('a draft whose guard differs from the current record guard is stale: no decision, re-examination by edit', () => {
  const stale = proposal({ guard: { ...current, evidenceRevision: 11, proposalRevision: 4 } });
  const gate = proposalReviewGate(stale, manager);
  assert.deepEqual(gate, { canApprove: false, canReject: false, canEdit: true, mustRecheck: true, decided: false, recheck: 'changed' });
  assert.equal(buildDecisionInput(stale, 'approve', 'motif', 'c', at).ok, false);
  assert.equal(buildDecisionInput(stale, 'reject', 'motif', 'c', at).ok, false);
  const rebind = buildEditInput(stale, 'home.blood_pressure', 'Réexamen sur le dossier actuel', 'c', at);
  assert.ok(rebind.ok, 'same action re-bound to the current record');
  assert.deepEqual(rebind.input.expectedGuard, current);

  const unknown = proposalReviewGate(proposal(), { ...manager, currentGuard: null });
  assert.deepEqual(unknown, { canApprove: false, canReject: false, canEdit: false, mustRecheck: true, decided: false, recheck: 'unknown' });
  assert.equal(buildDecisionInput(proposal(), 'approve', 'motif', 'c', { currentGuard: null }).ok, false);
  assert.equal(buildEditInput(proposal(), 'home.glucose', 'motif', 'c', { currentGuard: null }).ok, false);
});

test('decided proposals and non-managing clinicians get no review controls', () => {
  for (const state of ['approved', 'rejected', 'expired'] as const) {
    const gate = proposalReviewGate(proposal({ state }), manager);
    assert.equal(gate.canApprove || gate.canReject || gate.canEdit, false, state);
    assert.equal(gate.decided, true, state);
  }
  const secondary = proposalReviewGate(proposal(), { ...manager, canManageCare: false });
  assert.equal(secondary.canApprove || secondary.canReject || secondary.canEdit, false);
});

test('an edit picks a closed registry template, keeps the sources and still needs a separate decision', () => {
  assert.deepEqual([...EDITABLE_TEMPLATE_IDS].sort(), ['exam.clinician_review', 'home.blood_pressure', 'home.glucose', 'information.review']);
  assert.equal(buildEditInput(proposal(), 'unknown', 'motif', 'c', at).ok, false);
  assert.equal(buildEditInput(proposal(), 'home.insulin_dose', 'motif', 'c', at).ok, false);
  assert.equal(buildEditInput(proposal(), 'home.glucose', '  ', 'c', at).ok, false, 'reason required');
  assert.equal(buildEditInput(proposal(), 'home.blood_pressure', 'motif', 'c', at).ok, false, 'same template on a current draft is not an edit');
  const edit = buildEditInput(proposal(), 'home.glucose', 'Glycémie plutôt que tension', 'c', at);
  assert.ok(edit.ok);
  assert.deepEqual(edit.input, {
    action: { templateId: 'home.glucose', templateVersion: 1, parameters: {} },
    sources: proposal().sources,
    expectedRevision: 4,
    expectedGuard: current,
    reason: 'Glycémie plutôt que tension',
    clientId: 'c',
  });
  assert.equal('decision' in edit.input, false);
});

test('proposals are grouped by kind (home vs lab vs information), actionable first; status-only rows stay apart', () => {
  const list: (CareProposal | ProposalStatus)[] = [
    proposal({ id: 'home-approved', state: 'approved' }),
    proposal({ id: 'lab-pending', kind: 'lab_exam', action: { templateId: 'exam.clinician_review', templateVersion: 1, parameters: {} } }),
    proposal({ id: 'home-pending' }),
    proposal({ id: 'info', kind: 'information', action: { templateId: 'information.review', templateVersion: 1, parameters: {} } }),
    { id: 'status-only', revision: 1, kind: 'lab_exam', state: 'pending' },
  ];
  const groups = groupProposals(list);
  assert.deepEqual(groups.home_measurement.map((p) => p.id), ['home-pending', 'home-approved']);
  assert.deepEqual(groups.lab_exam.map((p) => p.id), ['lab-pending']);
  assert.deepEqual(groups.information.map((p) => p.id), ['info']);
  assert.deepEqual(groups.statusOnly.map((p) => p.id), ['status-only']);
});

const claim = (category: GroundedClaim['category'], sourceIds: string[] = [], code = 'fact_statement'): GroundedClaim => ({
  category,
  code,
  parameters: {},
  sourceIds,
});

test('hypotheses are kept in their own block, never mixed with facts', () => {
  const { groups, hypotheses } = groupClaims([
    claim('hypothesis', ['m1'], 'hypothesis_review'),
    claim('patient_statement', ['f1']),
    claim('missing'),
    claim('confirmed_fact', ['o1'], 'lab_value'),
    claim('hypothesis', [], 'hypothesis_review'),
  ]);
  assert.equal(hypotheses.length, 2);
  assert.deepEqual(groups.map((g) => g.category), ['confirmed_fact', 'patient_statement', 'missing']);
  assert.ok(groups.every((g) => g.claims.every((c) => c.category !== 'hypothesis')));
});

test('claim sources resolve only to ids present in the report; unknown ids are reported missing', () => {
  const sources = [source('f1'), source('m1', { kind: 'measurement', verification: 'simulated' })];
  const resolved = resolveClaimSources(claim('patient_statement', ['f1', 'ghost', 'm1', 'f1']), sources);
  assert.deepEqual(resolved.found.map((s) => s.id), ['f1', 'm1']);
  assert.deepEqual(resolved.missingIds, ['ghost']);
  assert.equal(resolved.found[1], sources[1], 'returned as given by the server, not rebuilt');
  assert.deepEqual(resolveClaimSources(claim('missing'), sources), { found: [], missingIds: [] });
});

test('claim parameters become plain text pairs; polarity uses the shared vocabulary', () => {
  const rows = claimParameterRows({ polarity: 'unknown', count: 2, flagged: true, note: '<b>x</b>' });
  assert.deepEqual(rows, [
    { key: 'polarity', value: 'Je ne sais pas' },
    { key: 'count', value: '2' },
    { key: 'flagged', value: 'Oui' },
    { key: 'note', value: '<b>x</b>' },
  ]);
});

test('a report is stale when the report or its meta says so', () => {
  const report = { stale: false } as ClinicianReport;
  const meta = { stale: false } as AiMeta;
  assert.equal(isReportStale(report, meta), false);
  assert.equal(isReportStale({ ...report, stale: true }, meta), true);
  assert.equal(isReportStale(report, { ...meta, stale: true }), true);
});

const evaluation = (overrides: Partial<ConditionEvaluation> = {}): ConditionEvaluation => ({
  id: 'eval-1',
  patientId: 'patient-1',
  conditionFactId: 'cond-bp',
  profileId: 'demo_blood_pressure',
  profileVersion: 'demo-v1',
  evaluatedAt: '2026-10-11T08:00:00.000Z',
  priority: 'green',
  coverage: ['complete'],
  sources: [],
  reasons: [],
  nextDueAt: null,
  guard,
  ...overrides,
});

const condition = (id: string, overrides: Partial<MedicalFact> = {}): MedicalFact => ({
  id,
  patientId: 'patient-1',
  kind: 'condition',
  code: 'hypertension',
  label: id,
  value: null,
  polarity: 'affirmed',
  verification: 'patient_reported',
  sources: [],
  revision: 1,
  createdAt: '2026-10-10T08:00:00.000Z',
  supersededBy: null,
  ...overrides,
});

const monitoring = (overrides: Partial<MonitoringState> = {}): MonitoringState => ({
  priority: 'green',
  coverage: ['complete'],
  reasons: [],
  evaluatedAt: '2026-10-11T08:00:00.000Z',
  ...overrides,
});

test('global green is shown only when every coverage is complete and every condition is evaluated', () => {
  const facts = [condition('cond-bp')];
  const evaluations = [evaluation()];
  assert.equal(globalMonitoringView(monitoring(), evaluations, facts).status, 'green');

  const staleGlucose = globalMonitoringView(monitoring({ coverage: ['complete', 'stale'] }), evaluations, facts);
  assert.equal(staleGlucose.status, 'unknown');
  assert.equal(staleGlucose.incomplete, true);

  const unevaluated = globalMonitoringView(monitoring(), evaluations, [...facts, condition('cond-asthma', { code: 'asthma' })]);
  assert.equal(unevaluated.status, 'unknown', 'a recorded condition without coverage blocks global green');
  assert.deepEqual(unevaluated.uncovered.map((f) => f.id), ['cond-asthma']);

  assert.equal(globalMonitoringView(monitoring({ coverage: [] }), evaluations, facts).status, 'unknown');
  assert.equal(globalMonitoringView(monitoring(), [evaluation({ coverage: ['complete', 'missing'] })], facts).status, 'unknown');
  assert.equal(globalMonitoringView(null, [], facts).status, 'unknown');
  assert.equal(globalMonitoringView(null, [], facts).evaluated, false);
});

test('orange and red stay visible despite incomplete coverage, flagged as incomplete', () => {
  const view = globalMonitoringView(monitoring({ priority: 'orange', coverage: ['complete', 'missing'] }), [evaluation()], [condition('cond-bp')]);
  assert.equal(view.status, 'orange');
  assert.equal(view.incomplete, true);
  assert.equal(displayPriority('red', ['stale']).status, 'red');
  assert.deepEqual(displayPriority('green', ['complete']), { status: 'green', incomplete: false });
  assert.deepEqual(displayPriority('green', ['complete', 'awaiting_verification']), { status: 'unknown', incomplete: true });
  assert.deepEqual(displayPriority('green', ['complete'], { profiled: false }), { status: 'unknown', incomplete: true }, 'no profile, no green');
});

test('a retry reuses the key only for the identical payload; a changed payload gets a new key', () => {
  let made = 0;
  const create = () => `key-${++made}`;
  const first = nextAttempt(null, { reason: 'a', clientId: '' }, create);
  assert.equal(first.clientId, 'key-1');
  assert.equal(nextAttempt(first, { reason: 'a', clientId: 'ignored' }, create).clientId, 'key-1', 'same payload: same key (safe replay)');
  const changed = nextAttempt(first, { reason: 'b', clientId: '' }, create);
  assert.equal(changed.clientId, 'key-2', 'edited payload: never replayed under the old key');
  assert.notEqual(changed.fingerprint, first.fingerprint);
});

test('conditions without a profile, negated or superseded facts are handled explicitly', () => {
  const facts = [
    condition('cond-bp'),
    condition('cond-unsupported', { code: 'asthma' }),
    condition('cond-negated', { polarity: 'negated' }),
    condition('cond-old', { supersededBy: 'cond-bp' }),
  ];
  const evaluations = [evaluation(), evaluation({ id: 'eval-2', conditionFactId: 'cond-unsupported', profileId: null, coverage: ['unsupported'] })];
  assert.deepEqual(uncoveredConditions(facts, evaluations).map((f) => f.id), ['cond-unsupported']);
});

test('a reused key with another body is not reported as a record change; stale context keeps the server reason', () => {
  const http = (code: string, message: string) => new ApiError({ status: 409, code, kind: 'http', message, serverMessage: message });
  const replay = classifyConflict(http('IDEMPOTENCY_CONFLICT', 'Identifiant déjà utilisé.'));
  assert.equal(replay.kind, 'replay');
  assert.doesNotMatch(replay.text, /dossier a changé/i);
  const stale = classifyConflict(http('STALE_CONTEXT', 'Le dossier a changé. Actualisez la revue.'));
  assert.equal(stale.kind, 'stale');
  assert.match(stale.text, /Le dossier a changé\. Actualisez la revue\./);
  assert.equal(classifyConflict(new ApiError({ status: 503, code: 'BUSY', kind: 'http', message: 'x' })).kind, 'other');
});

const envelope = (overrides: Partial<AccessEnvelope> = {}): AccessEnvelope => ({
  owner: false,
  relationship: 'primary',
  scopes: ['status', 'measurements', 'clinical', 'documents', 'summary', 'alerts', 'messages'],
  grantId: 'g1',
  grantRevision: 1,
  authorityRevision: 3,
  canManageCare: true,
  canReviewLabs: true,
  ...overrides,
});
const secondaryDocs = envelope({ relationship: 'specialist', scopes: ['clinical', 'documents'], canManageCare: false, canReviewLabs: false });

test('documents: a documents+clinical secondary reads but cannot upload or review labs', () => {
  assert.deepEqual(documentPermissions(envelope()), { canRead: true, canUpload: true, canReviewLabs: true });
  assert.deepEqual(documentPermissions(secondaryDocs), { canRead: true, canUpload: false, canReviewLabs: false });
  assert.equal(documentPermissions(envelope({ scopes: ['status'], canManageCare: false, canReviewLabs: false })).canRead, false);
});

test('lab review controls follow canReviewLabs; read-only reviewers get the reserved note', () => {
  const primary = documentPermissions(envelope());
  const secondary = documentPermissions(secondaryDocs);
  assert.deepEqual(labReviewControls('proposed', primary), { review: true, correct: false, note: null });
  assert.deepEqual(labReviewControls('confirmed', primary), { review: false, correct: true, note: null });
  assert.deepEqual(labReviewControls('rejected', primary), { review: false, correct: false, note: null });
  assert.deepEqual(labReviewControls('proposed', secondary), { review: false, correct: false, note: LAB_REVIEW_RESERVED });
  assert.deepEqual(labReviewControls('confirmed', secondary), { review: false, correct: false, note: LAB_REVIEW_RESERVED });
  assert.match(LAB_REVIEW_RESERVED, /réservée au médecin référent/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('an upload that returns after revocation or a patient switch is discarded, never applied', async () => {
  const applied: string[] = [];
  const revoked = createAccessFence('doc::patient-1');
  const late = deferred<string>();
  const pending = applyWhenCurrent(revoked, () => late.promise, (value) => applied.push(value));
  revoked.revoke();
  late.resolve('document-A');
  assert.deepEqual(await pending, { status: 'discarded' });

  // Patient switch: the bound apply of the departing fence is a no-op even if that fence was not revoked.
  const first = createAccessFence('doc::patient-1');
  let currentFence: AccessFence = first;
  const boundApply = bindToFence(first, () => currentFence, (value: string) => applied.push(value));
  const slow = deferred<string>();
  const switched = applyWhenCurrent(first, () => slow.promise, boundApply);
  currentFence = createAccessFence('doc::patient-2');
  slow.resolve('document-B');
  await switched;
  assert.equal(applied.length, 0, 'nothing from patient-1 reaches patient-2');

  const ok = createAccessFence('doc::patient-3');
  assert.deepEqual(await applyWhenCurrent(ok, async () => 'document-C', (value) => applied.push(value)), { status: 'applied', value: 'document-C' });
  assert.deepEqual(applied, ['document-C']);
});

test('plan review deadline: untouched omits the key, "Effacer" sends null, a date sends UTC ISO within 30 days', () => {
  const now = new Date(2026, 9, 11, 9, 0);
  const local = (days: number) => toDateTimeLocalValue(new Date(now.getTime() + days * 86_400_000));
  const base = { action: 'activate' as const, profileBindings: [], expectedRevision: 2, clientId: 'c' };

  const keep = buildPlanUpdate(base, { kind: 'keep' }, now);
  assert.ok(keep.ok);
  assert.equal('reviewDeadline' in keep.input, false, 'omitted = keep the current deadline');

  const clear = buildPlanUpdate(base, { kind: 'clear' }, now);
  assert.ok(clear.ok);
  assert.equal(clear.input.reviewDeadline, null);

  const set = buildPlanUpdate(base, { kind: 'set', local: local(7) }, now);
  assert.ok(set.ok);
  assert.equal(set.input.reviewDeadline, new Date(now.getTime() + 7 * 86_400_000).toISOString());
  assert.equal(new Date(set.input.reviewDeadline as string).toISOString(), set.input.reviewDeadline, 'exact UTC ISO, as the server checks');

  assert.ok(buildPlanUpdate(base, { kind: 'set', local: local(30) }, now).ok, '30 days accepted');
  assert.equal(buildPlanUpdate(base, { kind: 'set', local: local(31) }, now).ok, false, 'more than 30 days refused');
  assert.equal(buildPlanUpdate(base, { kind: 'set', local: local(-1) }, now).ok, false, 'past refused');
  assert.equal(buildPlanUpdate(base, { kind: 'set', local: '' }, now).ok, false, 'empty date refused');
});

test('doctor views show fact names, never raw registry codes; unknown codes are not guessed', () => {
  const facts = [
    condition('cond-bp', { code: 'hypertension', label: 'hypertension' }),
    condition('cond-dm', { code: 'diabetes', label: 'diabetes' }),
    condition('cond-asthma', { code: 'asthma', label: 'asthma' }),
    condition('sym-1', { kind: 'symptom', code: null, label: 'declared' }),
    condition('typed', { kind: 'symptom', code: null, label: 'Migraines fréquentes' }),
  ];
  assert.equal(factLabelById(facts, 'cond-bp'), 'Hypertension artérielle');
  assert.equal(factLabelById(facts, 'cond-dm'), 'Diabète');
  assert.equal(factLabelById(facts, 'sym-1'), 'Symptôme', '"declared" shows the fact kind');
  assert.equal(factLabelById(facts, 'typed'), 'Migraines fréquentes', 'typed labels stay as written');
  assert.equal(factLabelById(facts, 'cond-asthma'), 'asthma', 'unknown code shown as recorded, not guessed');
  assert.equal(factLabelById(facts, 'ghost'), null);
  assert.equal(facts[0].label, 'hypertension', 'stored value unchanged');
});

const careAction = (overrides: Partial<CareAction> = {}): CareAction => ({
  id: 'action-1',
  patientId: 'patient-1',
  planId: 'plan-1',
  revision: 1,
  proposalId: 'prop-1',
  protocolId: null,
  originVersion: 5,
  action: { templateId: 'home.glucose', templateVersion: 1, parameters: {} },
  dueAt: '2026-10-12T08:00:00.000Z',
  state: 'pending',
  reportedAt: null,
  clientId: 'c',
  createdAt: '2026-10-11T08:00:00.000Z',
  ...overrides,
});

test('an action whose approval is no longer current is "À reconfirmer", never shown as validated', () => {
  const checkedAt = '2026-10-11T09:00:00.000Z';
  const stale = actionApprovalView(careAction({ approval: { currentlyApproved: false, reasons: ['changed_approved_context', 'new_code'], checkedAt } }));
  assert.equal(stale.kind, 'reconfirm');
  assert.ok(stale.kind === 'reconfirm');
  assert.equal(stale.path, 'proposal');
  assert.equal(stale.checkedAt, checkedAt);
  assert.deepEqual(stale.reasons, [
    { text: 'Dossier, droits, plan ou profils modifiés depuis l’autorisation', translated: true },
    { text: 'new_code', translated: false },
  ]);
  assert.match(APPROVAL_LABEL.reconfirm, /À reconfirmer/);
  assert.doesNotMatch(APPROVAL_LABEL.reconfirm, /validé/i);

  const fromProtocol = actionApprovalView(careAction({ proposalId: null, protocolId: 'proto-1', approval: { currentlyApproved: false, reasons: ['protocol_inactive'], checkedAt } }));
  assert.ok(fromProtocol.kind === 'reconfirm' && fromProtocol.path === 'protocol');

  assert.deepEqual(actionApprovalView(careAction({ approval: { currentlyApproved: true, reasons: [], checkedAt } })), { kind: 'current', checkedAt });
  assert.deepEqual(actionApprovalView(careAction()), { kind: 'unknown' }, 'no metadata: no approval claim');
  const done = careAction({ state: 'completed', approval: { currentlyApproved: false, reasons: ['action_not_pending'], checkedAt } });
  assert.deepEqual(actionApprovalView(done), { kind: 'closed' }, 'a self-reported action needs no re-approval');
});

test('not_triggered applications are quiet: hidden by default with a counter, never counted as used or blocked', () => {
  const application = (id: string, state: ProtocolApplication['state'], minute: number): ProtocolApplication => ({
    id, patientId: 'patient-1', protocolId: 'proto-1', protocolVersion: 1, triggerId: `m-${id}`, guard: current, state,
    reasons: state === 'blocked' ? ['cooldown'] : [], sources: [], actionId: state === 'delivered' ? `a-${id}` : null,
    createdAt: new Date(Date.UTC(2026, 9, 11, 8, minute)).toISOString(), deliveredAt: null,
  });
  const log = [application('1', 'not_triggered', 1), application('2', 'delivered', 2), application('3', 'blocked', 3), application('4', 'not_triggered', 4)];
  const quiet = applicationLogView(log, false);
  assert.deepEqual(quiet.rows.map((a) => a.id), ['3', '2'], 'newest first, not_triggered hidden');
  assert.equal(quiet.hiddenNotTriggered, 2);
  assert.deepEqual(applicationLogView(log, true).rows.map((a) => a.id), ['4', '3', '2', '1']);
  assert.equal(deliveredCount(log, 'proto-1'), 1);
  assert.equal(log.filter((a) => a.state === 'blocked').length, 1, 'not_triggered is not a block');
});

test('editing the deadline of an active plan keeps state and bindings, always sends the key, never suspends', () => {
  const now = new Date(2026, 9, 11, 9, 0);
  const local = (days: number) => toDateTimeLocalValue(new Date(now.getTime() + days * 86_400_000));
  const bindings = [{ conditionFactId: 'cond-bp', profileId: 'demo_blood_pressure', profileVersion: 'demo-v1' }];
  const active: CarePlan = { id: 'plan-1', patientId: 'patient-1', revision: 6, state: 'active', clinicianId: 'doc-1', profileBindings: bindings, actionIds: [], reviewDeadline: '2026-10-01T08:00:00.000Z' };

  const set = buildDeadlineEdit(active, { kind: 'set', local: local(10) }, now);
  assert.ok(set.ok);
  assert.deepEqual(set.input, {
    action: 'activate',
    profileBindings: bindings,
    expectedRevision: 6,
    clientId: '',
    reviewDeadline: new Date(now.getTime() + 10 * 86_400_000).toISOString(),
  });
  assert.notEqual(set.input.profileBindings, bindings, 'a copy, the record is not mutated');

  const clear = buildDeadlineEdit(active, { kind: 'clear' }, now);
  assert.ok(clear.ok);
  assert.equal(clear.input.reviewDeadline, null);
  assert.equal(clear.input.action, 'activate');

  assert.equal(buildDeadlineEdit(active, { kind: 'keep' } as never, now).ok, false, 'no omitted key on this path');
  assert.equal(buildDeadlineEdit(active, { kind: 'set', local: local(31) }, now).ok, false);
  assert.equal(buildDeadlineEdit(active, { kind: 'set', local: local(-1) }, now).ok, false);
  for (const state of ['suspended', 'awaiting_clinician', 'revoked'] as const) {
    assert.equal(buildDeadlineEdit({ ...active, state }, { kind: 'clear' }, now).ok, false, `${state}: control is for active plans only`);
  }
  for (const result of [set, clear]) assert.ok(result.ok && result.input.action !== 'suspend');
});

test('a profiled condition with an unassessed limit is partial coverage, not "no profile"; orange stays visible', () => {
  // Real-shaped BP demo evaluation: the low direction is not assessed, so the server reports [unsupported, complete].
  const bp = evaluation({ conditionFactId: 'cond-bp', profileId: 'demo_blood_pressure', priority: 'orange', coverage: ['unsupported', 'complete'] });
  const facts = [condition('cond-bp'), condition('cond-unprofiled', { code: 'asthma' })];
  const unprofiled = evaluation({ id: 'eval-2', conditionFactId: 'cond-unprofiled', profileId: null, priority: 'unknown', coverage: ['unsupported'] });

  assert.deepEqual(uncoveredConditions([facts[0]], [bp]).map((f) => f.id), [], 'a profiled condition is never listed as uncovered');
  assert.deepEqual(uncoveredConditions(facts, [bp, unprofiled]).map((f) => f.id), ['cond-unprofiled']);
  assert.equal(isPartialCoverage(bp), true);
  assert.equal(isPartialCoverage(unprofiled), false, 'no profile is "unsupported", not partial');
  assert.match(PARTIAL_COVERAGE_LABEL, /Couverture partielle/);

  const view = globalMonitoringView(monitoring({ priority: 'orange', coverage: ['unsupported', 'complete'] }), [bp], [facts[0]]);
  assert.equal(view.status, 'orange', 'orange stays visible');
  assert.equal(view.incomplete, true);
  assert.deepEqual(view.uncovered, []);
  assert.deepEqual(displayPriority('orange', bp.coverage), { status: 'orange', incomplete: true });
  assert.deepEqual(displayPriority('green', bp.coverage), { status: 'unknown', incomplete: true }, 'green stays capped');
});

test('an epoch sentinel evaluation time is not an evaluation', () => {
  const sentinel = globalMonitoringView(monitoring({ evaluatedAt: '1970-01-01T00:00:00.000Z' }), [evaluation()], [condition('cond-bp')]);
  assert.equal(sentinel.evaluated, false);
  assert.equal(sentinel.status, 'unknown');
});

test('AI provenance badge: a cloud result never looks like fixed rules or a local model; every mode is covered', () => {
  const modes: AiMeta['mode'][] = ['local_model', 'cloud_model', 'deterministic'];
  assert.deepEqual(Object.keys(AI_MODE_BADGE).sort(), [...modes].sort(), 'one badge per contract mode');
  const look = (mode: AiMeta['mode']) => `${AI_MODE_BADGE[mode].tone}/${AI_MODE_BADGE[mode].icon}`;
  assert.notEqual(look('cloud_model'), look('deterministic'), 'cloud is not the rules look');
  assert.notEqual(look('cloud_model'), look('local_model'), 'cloud is not the local look');
  assert.deepEqual(AI_MODE_BADGE.cloud_model, { tone: 'outline', icon: 'wifi' });
  assert.deepEqual(AI_MODE_BADGE.deterministic, { tone: 'muted', icon: 'sliders' });
  assert.deepEqual(AI_MODE_BADGE.local_model, { tone: 'outline', icon: 'activity' });
  assert.equal(CARE_COPY.fr.aiMode.cloud_model, 'Modèle d’IA distant (service externe)');
  assert.doesNotMatch(CARE_COPY.fr.aiMode.cloud_model, /local|valid/i, 'no local or clinical-validation claim');
});

test('an AI mode outside the contract gets no badge (no crash, no guessed label, no rules look)', () => {
  for (const mode of ['local_model', 'cloud_model', 'deterministic'] as const) {
    assert.deepEqual(aiModeBadge(mode), { ...AI_MODE_BADGE[mode], label: CARE_COPY.fr.aiMode[mode] }, mode);
  }
  for (const unknown of ['quantum_model', '', 'toString', '__proto__', 'constructor']) {
    assert.equal(aiModeBadge(unknown), null, `"${unknown}" is not a contract mode`);
  }
});
