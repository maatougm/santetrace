import assert from 'node:assert/strict';
import test from 'node:test';
import type { CarePlan, CareProposal, MedicalFact, ProposalStatus, ReusableProtocol, RevisionGuard } from '../src/contracts/monitoring';
import type { SharingScope } from '../src/contracts/patient-platform';
import { protocolsScopeGate } from '../src/components/doctor/care/section-access';
import { currentGuardOf, resolveCurrentGuard, resolveRequirementIds } from '../src/components/doctor/care/guard';
import {
  PREDICATE_LIMITS,
  buildProtocolAuthorization,
  buildProtocolRevision,
  buildProtocolStateInput,
  eligibleSourceProposals,
  emptyProtocolDraft,
  type ProtocolBuildContext,
  type ProtocolFormDraft,
  type ProtocolFormErrors,
} from '../src/components/doctor/care/protocol-authorization';
import { buildDecisionInput } from '../src/components/doctor/care/proposal-review';
import { describePredicate, formatSeconds, protocolReasonText } from '../src/components/doctor/care/protocol-text';
import { PROTOCOL_FORM_LIMITS } from '../src/lib/client/assist-api';
import { toDateTimeLocalValue } from '../src/lib/client/format';

const PATIENT = 'patient-1';
const NOW = new Date(2026, 9, 11, 9, 0);
const DAY_MS = 24 * 3_600_000;

/** Guard captured when the draft was generated (carries the proposal revision). */
const proposalGuard: RevisionGuard = {
  contextRevision: 4,
  evidenceRevision: 9,
  authorityRevision: 2,
  carePlanRevision: 1,
  profileVersions: ['demo_glucose:demo-v1'],
  proposalRevision: 2,
};

/** Current server guard: approval and activation moved the plan revision, a new reading moved evidence. */
const current: RevisionGuard = { contextRevision: 4, evidenceRevision: 11, authorityRevision: 2, carePlanRevision: 3, profileVersions: ['demo_glucose:demo-v1'] };

const proposal = (overrides: Partial<CareProposal> = {}): CareProposal => ({
  id: 'prop-glucose',
  patientId: PATIENT,
  revision: 2,
  kind: 'home_measurement',
  state: 'approved',
  action: { templateId: 'home.glucose', templateVersion: 1, parameters: {} },
  sources: [],
  guard: proposalGuard,
  decision: { clinicianId: 'doc-1', at: '2026-10-11T08:00:00.000Z', reason: 'vu' },
  history: [],
  ...overrides,
});

const fact = (id: string, kind: MedicalFact['kind'], overrides: Partial<MedicalFact> = {}): MedicalFact => ({
  id,
  patientId: PATIENT,
  kind,
  code: kind === 'condition' ? 'diabetes' : null,
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

const facts: MedicalFact[] = [
  fact('cond-diabetes', 'condition'),
  fact('cond-asthma', 'condition', { code: 'asthma' }),
  fact('symptom-chest', 'symptom'),
  fact('treatment-old', 'treatment', { supersededBy: 'treatment-new' }),
];

const plan = (overrides: Partial<CarePlan> = {}): CarePlan => ({
  id: 'plan-1',
  patientId: PATIENT,
  revision: 3,
  state: 'active',
  clinicianId: 'doc-1',
  profileBindings: [{ conditionFactId: 'cond-diabetes', profileId: 'demo_glucose', profileVersion: 'demo-v1' }],
  actionIds: ['action-1'],
  reviewDeadline: null,
  ...overrides,
});

const context = (overrides: Partial<ProtocolBuildContext> = {}): ProtocolBuildContext => ({
  patientId: PATIENT,
  proposal: proposal(),
  facts,
  plan: plan(),
  currentGuard: current,
  requirementIds: ['demo_glucose:reading'],
  now: NOW,
  clientId: 'protocol-client-1',
  ...overrides,
});

const inDays = (days: number) => toDateTimeLocalValue(new Date(NOW.getTime() + days * DAY_MS));

const completeDraft = (overrides: Partial<ProtocolFormDraft> = {}): ProtocolFormDraft => ({
  ...emptyProtocolDraft('prop-glucose'),
  templateId: 'home.glucose',
  predicates: [
    { kind: 'priority_equals', conditionFactId: 'cond-diabetes' },
    { kind: 'requirements_complete', requirementIds: 'demo_glucose:reading' },
    { kind: 'evidence_fresh', requirementId: 'demo_glucose:reading', maxAgeHours: '48' },
  ],
  exclusions: [{ kind: 'fact_equals', factId: 'symptom-chest', polarity: 'affirmed' }],
  stopCriteria: [],
  validUntil: inDays(20),
  minIntervalHours: '24',
  maxApplications: '3',
  ...overrides,
});

const errorsOf = (result: ReturnType<typeof buildProtocolAuthorization>): ProtocolFormErrors => {
  assert.equal(result.ok, false, 'expected the authorization to be refused');
  return result.ok ? {} : result.errors;
};

test('an approved home-measurement proposal builds a bounded authorization; hours become seconds', () => {
  const result = buildProtocolAuthorization(completeDraft(), context());
  assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
  const { input } = result;
  assert.deepEqual(Object.keys(input).sort(), [
    'actions', 'clientId', 'exclusions', 'expectedGuard', 'maxApplications', 'minIntervalSeconds',
    'predicates', 'sourceProposalId', 'stopCriteria', 'validUntil',
  ]);
  assert.equal(input.sourceProposalId, 'prop-glucose');
  assert.deepEqual(input.actions, [{ templateId: 'home.glucose', templateVersion: 1, parameters: {} }]);
  assert.deepEqual(input.expectedGuard, current, 'expectedGuard is the current record guard, without proposalRevision');
  assert.equal(input.minIntervalSeconds, 24 * 3600);
  assert.equal(input.maxApplications, 3);
  assert.equal(input.clientId, 'protocol-client-1');
  assert.equal(new Date(input.validUntil).getTime(), NOW.getTime() + 20 * DAY_MS);
  assert.deepEqual(input.predicates, [
    { kind: 'priority_equals', conditionFactId: 'cond-diabetes', value: 'orange' },
    { kind: 'requirements_complete', requirementIds: ['demo_glucose:reading'] },
    { kind: 'evidence_fresh', requirementId: 'demo_glucose:reading', maxAgeSeconds: 48 * 3600 },
  ]);
  assert.deepEqual(input.exclusions, [{ kind: 'fact_equals', factId: 'symptom-chest', polarity: 'affirmed' }]);
  assert.deepEqual(input.stopCriteria, []);
});

test('the current guard is the server record guard (five keys), never guessed; requirement ids are the bound ones', () => {
  assert.deepEqual(currentGuardOf({ guard: { ...current, proposalRevision: 9, protocolRevision: 2 } }), current);
  assert.equal(currentGuardOf({}), null, 'no record guard: unknown, not derived from evaluations');
  const planGuard = { ...current, evidenceRevision: 99 };
  assert.deepEqual(resolveCurrentGuard({ guard: current }, { guard: planGuard }), current, 'record guard first');
  assert.deepEqual(resolveCurrentGuard({}, { guard: planGuard }), planGuard, 'PlanResponse.guard as fallback');
  assert.equal(resolveCurrentGuard({}, null), null, 'neither: unknown context, authorization blocked');
  assert.deepEqual(resolveRequirementIds({ requirementIds: ['a'] }, { requirementIds: ['b'] }), ['a']);
  assert.deepEqual(resolveRequirementIds({}, { requirementIds: ['b'] }), ['b']);
  assert.equal(resolveRequirementIds({}, null), null);
  const missing = errorsOf(buildProtocolAuthorization(completeDraft(), context({ currentGuard: null })));
  assert.match(missing.source ?? '', /contexte actuel/i);

  const unknownRequirement = completeDraft({ predicates: [completeDraft().predicates[0], { kind: 'requirements_complete', requirementIds: 'demo_bp:reading' }] });
  assert.match(errorsOf(buildProtocolAuthorization(unknownRequirement, context())).predicates ?? '', /exigence/i, 'only ids bound in the active plan');
  const freshUnknown = completeDraft({ exclusions: [{ kind: 'evidence_fresh', requirementId: 'demo_bp:reading', maxAgeHours: '24' }] });
  assert.ok(errorsOf(buildProtocolAuthorization(freshUnknown, context())).exclusions);
  assert.equal(buildProtocolAuthorization(unknownRequirement, context({ requirementIds: null })).ok, true, 'no bound list sent: the server validates');
});

test('protocol history needs the composite summary scope; missing scopes are named', () => {
  const access = (scopes: SharingScope[], owner = false) => ({ owner, scopes });
  const secondary = protocolsScopeGate(access(['clinical', 'documents']));
  assert.equal(secondary.allowed, false);
  assert.deepEqual(secondary.missing, ['status', 'measurements', 'summary']);
  assert.deepEqual(protocolsScopeGate(access(['status', 'measurements', 'clinical', 'documents', 'summary'])), { allowed: true, missing: [] });
  assert.equal(protocolsScopeGate(access([], true)).allowed, true);
});

test('application reasons are shown in French; an unknown code stays visible as recorded', () => {
  assert.deepEqual(protocolReasonText('cooldown'), { text: 'Intervalle minimal entre deux applications non écoulé', translated: true });
  assert.equal(protocolReasonText('unknown_exclusion').translated, true);
  assert.deepEqual(protocolReasonText('new_server_code'), { text: 'new_server_code', translated: false });
});

test('a lab exam is never reusable, even approved', () => {
  const lab = proposal({ kind: 'lab_exam', action: { templateId: 'exam.clinician_review', templateVersion: 1, parameters: {} } });
  const errors = errorsOf(buildProtocolAuthorization(completeDraft({ templateId: 'exam.clinician_review' }), context({ proposal: lab })));
  assert.match(errors.source ?? '', /examen/i);
});

test('only an approved proposal can be reused: pending, needs_review and rejected are refused', () => {
  for (const state of ['pending', 'needs_review', 'needs_inputs', 'rejected', 'expired'] as const) {
    const errors = errorsOf(buildProtocolAuthorization(completeDraft(), context({ proposal: proposal({ state }) })));
    assert.ok(errors.source, `state ${state} must be refused`);
  }
});

test("another patient's proposal, a missing proposal or a status-only projection is refused", () => {
  const other = errorsOf(buildProtocolAuthorization(completeDraft(), context({ proposal: proposal({ patientId: 'patient-2' }) })));
  assert.match(other.source ?? '', /autre patient/i);
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft(), context({ proposal: undefined }))).source);
  const statusOnly: ProposalStatus = { id: 'prop-glucose', revision: 2, kind: 'home_measurement', state: 'approved' };
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft(), context({ proposal: statusOnly }))).source);
});

test('reuse needs an active plan, and an approval made before a context or authority change needs a new review', () => {
  assert.match(errorsOf(buildProtocolAuthorization(completeDraft(), context({ plan: plan({ state: 'suspended' }) }))).source ?? '', /plan actif/i);
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft(), context({ plan: null }))).source);
  const newTreatment = { ...current, contextRevision: 5 };
  assert.match(errorsOf(buildProtocolAuthorization(completeDraft(), context({ currentGuard: newTreatment }))).source ?? '', /nouvelle revue/i);
  const newAuthority = { ...current, authorityRevision: 3 };
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft(), context({ currentGuard: newAuthority }))).source);
});

test('the reused action must be the approved proposal action, not another template', () => {
  const errors = errorsOf(buildProtocolAuthorization(completeDraft({ templateId: 'home.blood_pressure' }), context()));
  assert.ok(errors.template);
});

test('nothing is pre-filled: an empty draft requires explicit validity, interval and count', () => {
  const draft = emptyProtocolDraft('prop-glucose');
  assert.equal(draft.validUntil, '');
  assert.equal(draft.minIntervalHours, '');
  assert.equal(draft.maxApplications, '');
  assert.deepEqual(draft.predicates, []);
  const errors = errorsOf(buildProtocolAuthorization({ ...draft, templateId: 'home.glucose' }, context()));
  assert.ok(errors.validUntil);
  assert.ok(errors.minInterval);
  assert.ok(errors.maxApplications);
  assert.ok(errors.predicates);
});

test('validity, interval and count must stay within the form limits', () => {
  const tooLong = PROTOCOL_FORM_LIMITS.validityDaysMax + 1;
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ validUntil: inDays(-1) }), context())).validUntil);
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ validUntil: inDays(tooLong) }), context())).validUntil);
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ validUntil: 'demain' }), context())).validUntil);
  for (const hours of ['0', String(PROTOCOL_FORM_LIMITS.minIntervalHoursMax + 1), '2.5', 'abc', '-3']) {
    assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ minIntervalHours: hours }), context())).minInterval, hours);
  }
  for (const count of ['0', String(PROTOCOL_FORM_LIMITS.maxApplicationsMax + 1), '1.5', '']) {
    assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ maxApplications: count }), context())).maxApplications, count);
  }
  const edge = buildProtocolAuthorization(
    completeDraft({
      validUntil: inDays(PROTOCOL_FORM_LIMITS.validityDaysMax),
      minIntervalHours: String(PROTOCOL_FORM_LIMITS.minIntervalHoursMin),
      maxApplications: String(PROTOCOL_FORM_LIMITS.maxApplicationsMax),
    }),
    context(),
  );
  assert.ok(edge.ok, 'limits themselves are accepted');
});

test('form bounds stay inside server validation: interval 60..604800 s, validity <= 30 days, freshness <= 7 days', () => {
  const SERVER = { minIntervalSecondsMin: 60, minIntervalSecondsMax: 604_800, validityDaysMax: 30, maxAgeSecondsMax: 604_800, maxApplicationsMax: 100 };
  assert.ok(PROTOCOL_FORM_LIMITS.validityDaysMax <= SERVER.validityDaysMax);
  assert.ok(PROTOCOL_FORM_LIMITS.maxApplicationsMax <= SERVER.maxApplicationsMax);
  assert.ok(PREDICATE_LIMITS.maxAgeHoursMax * 3600 <= SERVER.maxAgeSecondsMax);
  for (const hours of [PROTOCOL_FORM_LIMITS.minIntervalHoursMin, PROTOCOL_FORM_LIMITS.minIntervalHoursMax]) {
    const built = buildProtocolAuthorization(completeDraft({ minIntervalHours: String(hours) }), context());
    assert.ok(built.ok, `${hours} h is accepted`);
    assert.equal(built.input.minIntervalSeconds, hours * 3600);
    assert.ok(built.input.minIntervalSeconds >= SERVER.minIntervalSecondsMin && built.input.minIntervalSeconds <= SERVER.minIntervalSecondsMax);
  }
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ minIntervalHours: '169' }), context())).minInterval, '169 h exceeds 604800 s');
  assert.ok(buildProtocolAuthorization(completeDraft({ validUntil: inDays(30) }), context()).ok, '30 days accepted');
  assert.ok(errorsOf(buildProtocolAuthorization(completeDraft({ validUntil: inDays(31) }), context())).validUntil, '31 days refused');
  const freshness = (hours: string) =>
    completeDraft({ predicates: [...completeDraft().predicates.slice(0, 2), { kind: 'evidence_fresh', requirementId: 'demo_glucose:reading', maxAgeHours: hours }] });
  assert.ok(buildProtocolAuthorization(freshness('168'), context()).ok, '168 h = 604800 s accepted');
  assert.ok(errorsOf(buildProtocolAuthorization(freshness('169'), context())).predicates, '169 h refused');
});

test("predicates stay in the closed union and point at this patient's current, plan-bound facts", () => {
  const base = completeDraft().predicates;
  const unknownKind = completeDraft({ predicates: [...base, { kind: 'similar_to', text: 'comme la dernière fois' } as never] });
  assert.ok(errorsOf(buildProtocolAuthorization(unknownKind, context())).predicates);

  const priorityOnSymptom = completeDraft({ predicates: [{ kind: 'priority_equals', conditionFactId: 'symptom-chest' }, base[1]] });
  assert.ok(errorsOf(buildProtocolAuthorization(priorityOnSymptom, context())).predicates, 'priority needs a condition fact');

  const unboundCondition = completeDraft({ predicates: [{ kind: 'priority_equals', conditionFactId: 'cond-asthma' }, base[1]] });
  assert.match(errorsOf(buildProtocolAuthorization(unboundCondition, context())).predicates ?? '', /plan/i, 'condition must be bound in the active plan');

  const unknownFact = completeDraft({ exclusions: [{ kind: 'fact_equals', factId: 'fact-of-someone-else', polarity: 'affirmed' }] });
  assert.ok(errorsOf(buildProtocolAuthorization(unknownFact, context())).exclusions);

  const supersededFact = completeDraft({ exclusions: [{ kind: 'fact_equals', factId: 'treatment-old', polarity: 'affirmed' }] });
  assert.ok(errorsOf(buildProtocolAuthorization(supersededFact, context())).exclusions, 'superseded facts cannot be referenced');

  for (const polarity of ['', 'uncertain', 'unknown'] as const) {
    const noAnswer = completeDraft({ exclusions: [{ kind: 'fact_equals', factId: 'symptom-chest', polarity }] });
    assert.ok(errorsOf(buildProtocolAuthorization(noAnswer, context())).exclusions, `polarity "${polarity}" is not a checkable answer`);
  }

  const emptyRequirements = completeDraft({ stopCriteria: [{ kind: 'requirements_complete', requirementIds: ' , ' }] });
  assert.ok(errorsOf(buildProtocolAuthorization(emptyRequirements, context())).stopCriteria);

  const tooOld = completeDraft({ predicates: [...base.slice(0, 2), { kind: 'evidence_fresh', requirementId: 'demo_glucose:reading', maxAgeHours: String(PREDICATE_LIMITS.maxAgeHoursMax + 1) }] });
  assert.ok(errorsOf(buildProtocolAuthorization(tooOld, context())).predicates);

  const noPriority = completeDraft({ predicates: [base[1]] });
  assert.match(errorsOf(buildProtocolAuthorization(noPriority, context())).predicates ?? '', /priorité orange/i);
  const noRequirements = completeDraft({ predicates: [base[0], base[2]] });
  assert.match(errorsOf(buildProtocolAuthorization(noRequirements, context())).predicates ?? '', /exigences/i);
});

test('approving once never produces a protocol', () => {
  const pending = proposal({ state: 'needs_review', decision: null, guard: current });
  const decision = buildDecisionInput(pending, 'approve', 'Mesure à domicile adaptée', 'decision-client-1', { currentGuard: current });
  assert.ok(decision.ok);
  assert.deepEqual(Object.keys(decision.input).sort(), ['clientId', 'decision', 'expectedGuard', 'expectedRevision', 'reason']);
  for (const key of ['validUntil', 'minIntervalSeconds', 'maxApplications', 'predicates', 'actions']) {
    assert.equal(key in decision.input, false, `${key} must not appear in a one-time decision`);
  }
  // A proposal being approved once does not give the reuse form any value.
  const errors = errorsOf(buildProtocolAuthorization({ ...emptyProtocolDraft('prop-glucose'), templateId: 'home.glucose' }, context()));
  assert.ok(errors.validUntil && errors.minInterval && errors.maxApplications && errors.predicates);
});

test('only approved home-measurement drafts of this patient are offered as reuse sources', () => {
  const list: (CareProposal | ProposalStatus)[] = [
    proposal({ id: 'ok' }),
    proposal({ id: 'pending', state: 'pending' }),
    proposal({ id: 'lab', kind: 'lab_exam' }),
    proposal({ id: 'info', kind: 'information' }),
    proposal({ id: 'other', patientId: 'patient-2' }),
    { id: 'status-only', revision: 1, kind: 'home_measurement', state: 'approved' },
  ];
  assert.deepEqual(eligibleSourceProposals(list, PATIENT).map((p) => p.id), ['ok']);
});

const protocol = (overrides: Partial<ReusableProtocol> = {}): ReusableProtocol => ({
  id: 'proto-1',
  patientId: PATIENT,
  revision: 3,
  state: 'active',
  clinicianId: 'doc-1',
  sourceProposalId: 'prop-glucose',
  authorityRevision: 2,
  requiredContextRevision: 4,
  carePlanRevision: 1,
  profileVersions: ['demo_glucose:demo-v1'],
  actions: [{ templateId: 'home.glucose', templateVersion: 1, parameters: {} }],
  predicates: [],
  exclusions: [],
  stopCriteria: [],
  validUntil: '2026-11-01T00:00:00.000Z',
  minIntervalSeconds: 86_400,
  maxApplications: 3,
  createdAt: '2026-10-11T08:00:00.000Z',
  history: [],
  ...overrides,
});

test('a revision is a full bounded authorization plus the expected revision and a required reason', () => {
  assert.ok(errorsOf(buildProtocolRevision(protocol(), completeDraft(), context(), '   ')).reason);
  const newTreatment = { ...current, contextRevision: 5 };
  const result = buildProtocolRevision(protocol(), completeDraft(), context({ currentGuard: newTreatment }), ' Nouveau traitement revu ');
  assert.ok(result.ok, 'an explicit revision re-binds the protocol to the changed context');
  assert.equal(result.input.expectedRevision, 3);
  assert.equal(result.input.reason, 'Nouveau traitement revu');
  assert.equal(result.input.minIntervalSeconds, 86_400);
  assert.deepEqual(result.input.expectedGuard, newTreatment);
  assert.ok(errorsOf(buildProtocolRevision(protocol({ state: 'revoked' }), completeDraft(), context(), 'motif')).source, 'revoked is final');
  assert.ok(buildProtocolRevision(protocol({ state: 'expired' }), completeDraft(), context(), 'Renouvellement revu').ok, 'an expired protocol can be renewed by an explicit new version');
  const otherSource = buildProtocolRevision(protocol({ sourceProposalId: 'prop-other' }), completeDraft(), context(), 'motif');
  assert.match(errorsOf(otherSource).source ?? '', /même proposition/i);
});

test('predicates read as French sentences; an unknown fact id is named as absent, never guessed', () => {
  assert.equal(describePredicate({ kind: 'priority_equals', conditionFactId: 'cond-diabetes', value: 'orange' }, facts), 'Priorité « Suivi requis » (orange) pour : cond-diabetes');
  assert.equal(describePredicate({ kind: 'evidence_fresh', requirementId: 'demo_glucose:reading', maxAgeSeconds: 172_800 }, facts), 'Donnée « demo_glucose:reading » datant de moins de 2 j (48 h)');
  assert.equal(describePredicate({ kind: 'fact_equals', factId: 'symptom-chest', polarity: 'negated' }, facts), '« symptom-chest » : Non');
  assert.equal(describePredicate({ kind: 'fact_equals', factId: 'ghost', polarity: 'affirmed' }, facts), '« information ghost (absente du dossier visible) » : Oui');
  assert.equal(describePredicate({ kind: 'requirements_complete', requirementIds: ['a:reading', 'b:reading'] }, facts), 'Exigences de suivi complètes : a:reading, b:reading');
  const coded = [fact('cond-bp', 'condition', { code: 'hypertension', label: 'hypertension' }), fact('sym-1', 'symptom', { label: 'declared' })];
  assert.equal(describePredicate({ kind: 'priority_equals', conditionFactId: 'cond-bp', value: 'orange' }, coded), 'Priorité « Suivi requis » (orange) pour : Hypertension artérielle');
  assert.equal(describePredicate({ kind: 'fact_equals', factId: 'sym-1', polarity: 'affirmed' }, coded), '« Symptôme » : Oui');
  assert.equal(formatSeconds(3_600), '1 h');
  assert.equal(formatSeconds(3 * 86_400), '3 j (72 h)');
  assert.equal(formatSeconds(90 * 60), '90 min');
});

test('suspend and revoke carry the protocol revision and a required reason; ended protocols cannot change', () => {
  assert.equal(buildProtocolStateInput(protocol(), 'suspend', '', 'c1').ok, false);
  const suspend = buildProtocolStateInput(protocol(), 'suspend', 'Nouveau symptôme à revoir', 'c1');
  assert.deepEqual(suspend.ok && suspend.input, { action: 'suspend', expectedRevision: 3, reason: 'Nouveau symptôme à revoir', clientId: 'c1' });
  assert.equal(buildProtocolStateInput(protocol({ state: 'suspended' }), 'suspend', 'motif', 'c1').ok, false);
  assert.equal(buildProtocolStateInput(protocol({ state: 'suspended' }), 'revoke', 'motif', 'c1').ok, true);
  assert.equal(buildProtocolStateInput(protocol({ state: 'revoked' }), 'revoke', 'motif', 'c1').ok, false);
  assert.equal(buildProtocolStateInput(protocol(), 'revoke', 'x'.repeat(PROTOCOL_FORM_LIMITS.reasonMax + 1), 'c1').ok, false);
});
