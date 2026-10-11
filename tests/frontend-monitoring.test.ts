import assert from 'node:assert/strict';
import test from 'node:test';
import type { Alert, Measurement, Rules, Status } from '../src/contracts/care';
import type {
  CareAction,
  CarePlan,
  CareProposal,
  ConditionEvaluation,
  Coverage,
  MedicalFact,
  MonitoringState,
  ProtocolApplication,
  RevisionGuard,
} from '../src/contracts/monitoring';
import {
  cardTitle,
  conditionCards,
  globalMonitoringDisplay,
  latestOfKind,
  measurementBadge,
  needsReferent,
  nextAnnouncement,
  openRedAlert,
  orderedCoverage,
  reasonItems,
} from '../src/components/patient/monitoring/monitoring-view';
import {
  deliveryCareStep,
  historyAlertText,
  receiptNotes,
  statusExplainText,
} from '../src/components/patient/monitoring/care-team-view';
import { CARE_COPY } from '../src/lib/client/copy/care';
import { getMessages } from '../src/lib/client/i18n';
import {
  actionApproval,
  actionOrigin,
  adviceFromAction,
  blockedApplications,
  canSelfReport,
  doctorName,
  groupProposals,
  isActionOverdue,
  patientProposalRows,
  patientProposalStatuses,
  reviewDeadlineView,
  selfReportNote,
  sortActions,
} from '../src/components/patient/plan/plan-view';

const at = (hour: number) => new Date(Date.UTC(2026, 9, 11, hour)).toISOString();
const NOW = Date.parse(at(12));

const guard: RevisionGuard = { contextRevision: 1, evidenceRevision: 1, authorityRevision: 1, carePlanRevision: 1, profileVersions: [] };
const rules = { version: 'demo-1' } as Rules;

const fact = (id: string, code: string | null, extra: Partial<MedicalFact> = {}): MedicalFact => ({
  id,
  patientId: 'p1',
  kind: 'condition',
  code,
  label: code ?? 'Autre',
  value: null,
  polarity: 'affirmed',
  verification: 'patient_reported',
  sources: [],
  revision: 1,
  createdAt: at(1),
  supersededBy: null,
  ...extra,
});

const evaluation = (
  conditionFactId: string,
  priority: Status,
  coverage: Coverage[],
  extra: Partial<ConditionEvaluation> = {},
): ConditionEvaluation => ({
  id: `ev-${conditionFactId}`,
  patientId: 'p1',
  conditionFactId,
  profileId: 'demo_blood_pressure',
  profileVersion: '1',
  evaluatedAt: at(10),
  priority,
  coverage,
  sources: [],
  reasons: [],
  nextDueAt: null,
  guard,
  ...extra,
});

const monitoring = (priority: Status, coverage: Coverage[]): MonitoringState => ({ priority, coverage, reasons: [], evaluatedAt: at(10) });

const alert = (id: string, priority: Alert['priority'], status: Alert['status'], hour: number): Alert => ({
  id,
  patientId: 'p1',
  status,
  priority,
  reason: 'demo',
  ruleVersion: 'demo-1',
  rulesSnapshot: rules,
  createdAt: at(hour),
  history: [],
});

const bp = (id: string, hour: number, status: Status): Measurement => ({
  id,
  patientId: 'p1',
  kind: 'blood_pressure',
  systolic: 120,
  diastolic: 80,
  unit: 'mmHg',
  status,
  measuredAt: at(hour),
  capturedAt: at(hour),
  receivedAt: at(hour),
  clientId: id,
  source: 'app',
  ruleVersion: 'demo-1',
});

const pulse = (id: string, hour: number): Measurement => ({
  id,
  patientId: 'p1',
  kind: 'pulse',
  value: 72,
  unit: 'bpm',
  status: 'unknown',
  measuredAt: at(hour),
  capturedAt: at(hour),
  receivedAt: at(hour),
  clientId: id,
  source: 'simulated',
  ruleVersion: 'demo-1',
});

const display = (input: Partial<Parameters<typeof globalMonitoringDisplay>[0]>) =>
  globalMonitoringDisplay({ monitoring: null, patientStatus: 'unknown', cards: [], openRed: false, stale: false, ...input });

// ---------------------------------------------------------------------------
// Global display: never a reassuring global green
// ---------------------------------------------------------------------------

test('global green is shown only with a green priority, complete coverage everywhere and at least one evaluation', () => {
  const facts = [fact('f-hta', 'hypertension')];
  const cards = conditionCards(facts, [evaluation('f-hta', 'green', ['complete'])]);
  const result = display({ monitoring: monitoring('green', ['complete']), patientStatus: 'green', cards });
  assert.equal(result.status, 'green');
  assert.equal(result.notGreen, false);
});

test('a fresh blood pressure never hides stale glucose: no global green, explicit not-green note', () => {
  const facts = [fact('f-hta', 'hypertension'), fact('f-dia', 'diabetes')];
  const cards = conditionCards(facts, [
    evaluation('f-hta', 'green', ['complete']),
    evaluation('f-dia', 'green', ['stale'], { profileId: 'demo_glucose' }),
  ]);
  const result = display({ monitoring: monitoring('green', ['complete', 'stale']), patientStatus: 'green', cards });
  assert.equal(result.status, 'unknown');
  assert.equal(result.notGreen, true);
  assert.deepEqual(result.coverage, ['stale', 'complete']);
});

test('missing coverage, empty coverage or no evaluation at all never produce a global green', () => {
  const facts = [fact('f-hta', 'hypertension')];
  const missing = display({
    monitoring: monitoring('green', ['missing']),
    cards: conditionCards(facts, [evaluation('f-hta', 'green', ['missing'])]),
  });
  assert.equal(missing.status, 'unknown');

  const empty = display({ monitoring: monitoring('green', []), cards: conditionCards(facts, [evaluation('f-hta', 'green', [])]) });
  assert.equal(empty.status, 'unknown');

  const none = display({ monitoring: monitoring('green', ['complete']), patientStatus: 'green', cards: [] });
  assert.equal(none.status, 'unknown');

  const nothing = display({ monitoring: null, patientStatus: 'green' });
  assert.equal(nothing.status, 'unknown');
  assert.equal(nothing.hasEvaluation, false);
});

test('a recorded condition without a monitoring profile blocks the global green and is listed as unsupported', () => {
  const facts = [fact('f-hta', 'hypertension'), fact('f-asthma', 'asthma')];
  const cards = conditionCards(facts, [evaluation('f-hta', 'green', ['complete'])]);
  assert.deepEqual(
    cards.map((card) => [card.kind, card.fact?.id]),
    [
      ['evaluated', 'f-hta'],
      ['unsupported', 'f-asthma'],
    ],
  );
  const result = display({ monitoring: monitoring('green', ['complete']), patientStatus: 'green', cards });
  assert.equal(result.status, 'unknown');
  assert.ok(result.coverage.includes('unsupported'));
});

test('a server evaluation without profile is unsupported; a profiled condition not yet evaluated is not green either', () => {
  const facts = [fact('f-hta', 'hypertension'), fact('f-other', null), fact('f-dia', 'diabetes')];
  const cards = conditionCards(facts, [evaluation('f-other', 'unknown', ['unsupported'], { profileId: null, profileVersion: null })]);
  assert.deepEqual(
    cards.map((card) => [card.kind, card.fact?.id]),
    [
      ['not_evaluated', 'f-hta'],
      ['unsupported', 'f-other'],
      ['not_evaluated', 'f-dia'],
    ],
  );
  assert.equal(display({ monitoring: monitoring('green', ['complete']), cards }).status, 'unknown');
});

test('negated, unknown and superseded conditions are not monitored conditions', () => {
  const cards = conditionCards(
    [
      fact('f-neg', 'diabetes', { polarity: 'negated' }),
      fact('f-unk', 'hypertension', { polarity: 'unknown' }),
      fact('f-old', 'hypertension', { supersededBy: 'f-new' }),
      fact('f-sym', null, { kind: 'symptom' }),
    ],
    [],
  );
  assert.deepEqual(cards, []);
});

test('an open red alert forces red even when the server aggregate still says green', () => {
  const facts = [fact('f-hta', 'hypertension')];
  const cards = conditionCards(facts, [evaluation('f-hta', 'green', ['complete'])]);
  const result = display({ monitoring: monitoring('green', ['complete']), patientStatus: 'green', cards, openRed: true });
  assert.equal(result.status, 'red');
});

test('orange or red evidence stays visible despite partial coverage', () => {
  const facts = [fact('f-hta', 'hypertension'), fact('f-dia', 'diabetes')];
  const cards = conditionCards(facts, [
    evaluation('f-hta', 'orange', ['complete']),
    evaluation('f-dia', 'unknown', ['missing'], { profileId: 'demo_glucose' }),
  ]);
  assert.equal(display({ monitoring: monitoring('unknown', ['complete', 'missing']), cards }).status, 'orange');
});

test('a stale screen (device copy or failing poll) never shows a green', () => {
  const facts = [fact('f-hta', 'hypertension')];
  const cards = conditionCards(facts, [evaluation('f-hta', 'green', ['complete'])]);
  assert.equal(display({ monitoring: monitoring('green', ['complete']), patientStatus: 'green', cards, stale: true }).status, 'unknown');
});

test('a condition card is green only with complete coverage; it is unknown otherwise', () => {
  const cards = conditionCards(
    [fact('a', 'hypertension'), fact('b', 'diabetes')],
    [evaluation('a', 'green', ['complete']), evaluation('b', 'green', ['awaiting_verification'], { profileId: 'demo_glucose' })],
  );
  const statuses = cards.map((card) => (card.kind === 'evaluated' ? card.display : card.kind));
  assert.deepEqual(statuses, ['green', 'unknown']);
});

// ---------------------------------------------------------------------------
// Evaluation time and reasons (root browser QA)
// ---------------------------------------------------------------------------

const EPOCH = '1970-01-01T00:00:00.000Z';

test('the epoch "never evaluated" sentinel shows no time and counts as no evaluation', () => {
  const result = display({ monitoring: { ...monitoring('unknown', []), evaluatedAt: EPOCH } });
  assert.equal(result.evaluatedAt, null);
  assert.equal(result.hasEvaluation, false);
  assert.equal(display({ monitoring: { ...monitoring('unknown', []), evaluatedAt: 'not-a-date' } }).evaluatedAt, null);
});

test('a global sentinel time is never replaced by another time', () => {
  const facts = [fact('f-hta', 'hypertension')];
  const cards = conditionCards(facts, [evaluation('f-hta', 'unknown', ['missing'])]);
  const result = display({ monitoring: { ...monitoring('unknown', ['missing']), evaluatedAt: EPOCH }, cards });
  assert.equal(result.evaluatedAt, null);
  // A real condition evaluation still counts as an evaluation.
  assert.equal(result.hasEvaluation, true);
});

test('a condition card with the epoch sentinel has no displayable evaluation time', () => {
  const cards = conditionCards([fact('f-hta', 'hypertension')], [evaluation('f-hta', 'unknown', ['missing'], { evaluatedAt: EPOCH })]);
  assert.equal(cards[0].kind, 'evaluated');
  assert.equal(cards[0].kind === 'evaluated' ? cards[0].evaluatedAt : 'x', null);
  const real = conditionCards([fact('f-hta', 'hypertension')], [evaluation('f-hta', 'unknown', ['missing'])]);
  assert.equal(real[0].kind === 'evaluated' ? real[0].evaluatedAt : null, at(10));
});

test('server reasons are translated when known and flagged as untranslated otherwise', () => {
  const items = reasonItems(['Systolic 182 mmHg >= 180 mmHg (red; demo rule demo-1).', 'A brand new server sentence.'], 'fr');
  assert.equal(items.length, 2);
  assert.equal(items[0].translated, true);
  assert.match(items[0].text, /^Systolique 182 mmHg/);
  assert.deepEqual(items[1], { key: '1-A brand new server sentence.', text: 'A brand new server sentence.', translated: false });
  const arabic = reasonItems(['No current condition evaluations are available.'], 'ar');
  assert.equal(arabic[0].translated, true);
  assert.ok(!/[A-Za-z]{4,}/.test(arabic[0].text));
});

test('condition card titles never show a raw registry code', () => {
  const [hta] = conditionCards([fact('f-hta', 'hypertension')], []);
  assert.equal(cardTitle(hta, 'fr'), 'Hypertension artérielle');
  assert.equal(cardTitle(hta, 'ar'), 'ارتفاع ضغط الدم');
  const [dia] = conditionCards([fact('f-dia', 'diabetes')], []);
  assert.equal(cardTitle(dia, 'fr'), 'Diabète');
  // "declared" is the fact kind; a typed label stays as written; an unknown code is not guessed.
  const [declared] = conditionCards([fact('f-x', null, { label: 'declared' })], []);
  assert.equal(cardTitle(declared, 'fr'), 'Maladie ou condition');
  const [typed] = conditionCards([fact('f-y', 'hypertension', { label: 'Tension haute (mon médecin)' })], []);
  assert.equal(cardTitle(typed, 'fr'), 'Tension haute (mon médecin)');
  const [unknownCode] = conditionCards([fact('f-z', 'asthma')], []);
  assert.equal(cardTitle(unknownCode, 'fr'), 'asthma');
  // An evaluation without a matching fact gets the generic kind label.
  const [orphan] = conditionCards([], [evaluation('f-gone', 'unknown', ['missing'])]);
  assert.equal(cardTitle(orphan, 'fr'), 'Maladie ou condition');
});

// ---------------------------------------------------------------------------
// "unsupported" on a profiled evaluation = partial coverage, not "no profile"
// ---------------------------------------------------------------------------

test('a profiled BP evaluation with [unsupported, complete] is partial coverage, keeps its orange and caps green', () => {
  // Real shape from root QA (Nadia): demo_blood_pressure profile, orange, low direction unassessed.
  const bpOrange = evaluation('f-hta', 'orange', ['unsupported', 'complete'], { profileId: 'demo_blood_pressure', profileVersion: 'demo-v1' });
  const cards = conditionCards([fact('f-hta', 'hypertension')], [bpOrange]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'evaluated', 'a profiled condition is never shown as "no profile"');
  assert.deepEqual(cards[0].kind === 'evaluated' ? [cards[0].display, cards[0].coverage] : null, ['orange', ['partial', 'complete']]);

  const orange = display({ monitoring: monitoring('orange', ['unsupported', 'complete']), patientStatus: 'orange', cards });
  assert.equal(orange.status, 'orange');
  assert.deepEqual(orange.coverage, ['partial', 'complete']);
  assert.ok(!orange.coverage.includes('unsupported'));

  // The same partial coverage never allows a green, on the card or globally.
  const bpGreen = evaluation('f-hta', 'green', ['unsupported', 'complete']);
  const greenCards = conditionCards([fact('f-hta', 'hypertension')], [bpGreen]);
  assert.equal(greenCards[0].kind === 'evaluated' ? greenCards[0].display : null, 'unknown');
  const green = display({ monitoring: monitoring('green', ['unsupported', 'complete']), patientStatus: 'green', cards: greenCards });
  assert.equal(green.status, 'unknown');
  assert.equal(green.notGreen, true);
});

test('a condition without a profile is still listed as unsupported next to a partial one', () => {
  const cards = conditionCards(
    [fact('f-hta', 'hypertension'), fact('f-asthma', 'asthma')],
    [evaluation('f-hta', 'orange', ['unsupported', 'complete'])],
  );
  assert.deepEqual(
    cards.map((card) => card.kind),
    ['evaluated', 'unsupported'],
  );
  const result = display({ monitoring: monitoring('orange', ['unsupported', 'complete']), cards });
  assert.deepEqual(result.coverage, ['unsupported', 'partial', 'complete']);
  // A server evaluation with a null profile keeps the "no profile" meaning.
  const nullProfile = conditionCards([fact('f-x', null)], [evaluation('f-x', 'unknown', ['unsupported'], { profileId: null, profileVersion: null })]);
  assert.equal(nullProfile[0].kind, 'unsupported');
});

test('coverage entries are de-duplicated and ordered worst first', () => {
  assert.deepEqual(orderedCoverage(['complete', 'missing', 'complete', 'unsupported', 'stale']), ['unsupported', 'missing', 'stale', 'complete']);
});

// ---------------------------------------------------------------------------
// Red episode
// ---------------------------------------------------------------------------

test('an open red episode stays after a newer green measurement until a clinician resolves it', () => {
  const alerts = [alert('red-1', 'red', 'new', 8)];
  const measurements = [bp('m-red', 8, 'red'), bp('m-green', 11, 'green')];
  assert.equal(latestOfKind(measurements, 'blood_pressure')?.status, 'green');
  assert.equal(openRedAlert(alerts)?.id, 'red-1');
  assert.equal(openRedAlert([alert('red-1', 'red', 'acknowledged', 8)])?.id, 'red-1');
  assert.equal(openRedAlert([alert('red-1', 'red', 'resolved', 8)]), null);
  assert.equal(openRedAlert([alert('red-1', 'red', 'rejected', 8)]), null);
  assert.equal(openRedAlert([alert('o-1', 'orange', 'new', 9)]), null);
});

test('the most recent open red episode is the one shown', () => {
  const alerts = [alert('red-old', 'red', 'acknowledged', 3), alert('red-new', 'red', 'new', 9), alert('red-closed', 'red', 'resolved', 11)];
  assert.equal(openRedAlert(alerts)?.id, 'red-new');
});

test('the red episode is announced only when the open red id changes, not on every poll', () => {
  const first = nextAnnouncement(null, 'red-1');
  assert.deepEqual(first, { announce: true, announcedId: 'red-1' });
  const samePoll = nextAnnouncement(first.announcedId, 'red-1');
  assert.equal(samePoll.announce, false);
  // A failed poll without data does not reset the memory, so the same episode is not re-announced.
  const gap = nextAnnouncement(samePoll.announcedId, null);
  assert.deepEqual(gap, { announce: false, announcedId: 'red-1' });
  assert.equal(nextAnnouncement(gap.announcedId, 'red-1').announce, false);
  assert.equal(nextAnnouncement(gap.announcedId, 'red-2').announce, true);
});

test('no referent is claimed only for the owner on live data with no plan or a plan awaiting a clinician', () => {
  const plan = (state: CarePlan['state']): CarePlan => ({
    id: 'plan',
    patientId: 'p1',
    revision: 1,
    state,
    clinicianId: state === 'awaiting_clinician' ? null : 'dr-a',
    profileBindings: [],
    actionIds: [],
    reviewDeadline: null,
  });
  const owner = { owner: true } as Parameters<typeof needsReferent>[0]['access'];
  assert.equal(needsReferent({ plan: null, access: owner }, 'server'), true);
  assert.equal(needsReferent({ plan: plan('awaiting_clinician'), access: owner }, 'server'), true);
  assert.equal(needsReferent({ plan: plan('active'), access: owner }, 'server'), false);
  // A device copy has no plan section: unknown, never "no referent".
  assert.equal(needsReferent({ plan: null, access: owner }, 'device'), false);
  assert.equal(needsReferent({ plan: null, access: { ...owner, owner: false } }, 'server'), false);
});

// ---------------------------------------------------------------------------
// No implied care team without an accepted doctor (FR-027, root QA item 9)
// ---------------------------------------------------------------------------

const CARE_TEAM_WORDING = /équipe soignante|فريق الرعاية/;

test('without an accepted care team, no receipt, step, history line or status text mentions a care team', () => {
  for (const lang of ['fr', 'ar'] as const) {
    const t = getMessages(lang);
    for (const team of ['none', 'unknown'] as const) {
      for (const linked of [null, alert('o', 'orange', 'new', 9), alert('r', 'red', 'new', 9)]) {
        for (const note of receiptNotes(team, linked, t).notes) assert.doesNotMatch(note, CARE_TEAM_WORDING, `${lang}/${team}`);
        const step = deliveryCareStep(team, linked, t);
        if (step) assert.doesNotMatch(step.label, CARE_TEAM_WORDING);
        if (linked) assert.doesNotMatch(historyAlertText(team, linked, t), CARE_TEAM_WORDING);
      }
      for (const status of ['orange', 'red'] as const) assert.doesNotMatch(statusExplainText(team, status, t), CARE_TEAM_WORDING);
    }
  }
});

test('with no doctor at all, the result says nobody receives the alert and offers an invitation', () => {
  const t = getMessages('fr');
  const open = alert('o', 'orange', 'new', 9);
  assert.deepEqual(receiptNotes('none', open, t), { notes: [t.noReferent.alertCreated, t.noReferent.receivedNote], invite: true });
  assert.deepEqual(receiptNotes('none', null, t), { notes: [t.noReferent.receivedNote], invite: true });
  // A fact about now, not a step "still to come".
  assert.deepEqual(deliveryCareStep('none', open, t), { label: t.noReferent.deliveryStep, at: null, done: false, waiting: false });
  assert.equal(historyAlertText('none', open, t), t.noReferent.historyAlertOpen);
  assert.equal(statusExplainText('none', 'orange', t), t.noReferent.statusOrange);
  assert.equal(statusExplainText('none', 'red', t), t.noReferent.statusRed);
});

test('an unknown care team omits the care-team step and only says the app cannot confirm', () => {
  const t = getMessages('fr');
  const open = alert('o', 'orange', 'new', 9);
  assert.equal(deliveryCareStep('unknown', open, t), null);
  assert.deepEqual(receiptNotes('unknown', open, t), { notes: [t.noReferent.unknownTeam], invite: false });
  assert.equal(historyAlertText('unknown', open, t), t.outbox.state.server_received);
  assert.equal(statusExplainText('unknown', 'orange', t), t.noReferent.unknownTeam);
  // The fixed red guidance (emergency number) is kept; it names no care team.
  assert.equal(statusExplainText('unknown', 'red', t), t.status.explain.red);
});

test('a present care team keeps the existing wording; "seen" comes only from server alert data', () => {
  const t = getMessages('fr');
  const open = alert('o', 'orange', 'new', 9);
  assert.deepEqual(deliveryCareStep('present', open, t), { label: t.delivery.careTeam, at: null, done: false, waiting: true });
  assert.deepEqual(receiptNotes('present', open, t), { notes: [t.measure.result.alertCreated, t.measure.result.receivedNote], invite: false });
  assert.equal(historyAlertText('present', open, t), t.history.alert.new);
  assert.equal(statusExplainText('present', 'orange', t), t.status.explain.orange);
  // A clinician action recorded by the server stays visible whatever the current grants are.
  const seen = { ...alert('o', 'orange', 'acknowledged', 9), acknowledgedAt: at(10) };
  for (const team of ['present', 'none', 'unknown'] as const) {
    assert.deepEqual(deliveryCareStep(team, seen, t), { label: t.delivery.careTeam, at: at(10), done: true, waiting: false });
    assert.equal(historyAlertText(team, seen, t), t.history.alert.acknowledged);
  }
});

// ---------------------------------------------------------------------------
// Pulse and simulated readings
// ---------------------------------------------------------------------------

test('pulse is shown unscored, never with a status badge', () => {
  assert.deepEqual(measurementBadge(pulse('p', 9)), { kind: 'unscored' });
  assert.deepEqual(measurementBadge(bp('b', 9, 'orange')), { kind: 'status', status: 'orange' });
  assert.equal(latestOfKind([bp('b', 11, 'green'), pulse('p1', 9), pulse('p2', 10)], 'pulse')?.id, 'p2');
  assert.equal(latestOfKind([bp('b', 11, 'green')], 'pulse'), null);
});

// ---------------------------------------------------------------------------
// Patient proposal view
// ---------------------------------------------------------------------------

const fullProposal = (id: string, kind: CareProposal['kind'], state: CareProposal['state']): CareProposal & Record<string, unknown> => ({
  id,
  patientId: 'p1',
  revision: 3,
  kind,
  state,
  action: { templateId: 'exam.clinician_review', templateVersion: 1, parameters: { exam: 'HbA1c secret', dose: 5 } },
  sources: [{ kind: 'candidate', id: 's1', revision: 1, contentHash: null, date: at(1), verification: 'candidate', polarity: 'affirmed', quote: 'hidden' }],
  guard,
  decision: null,
  history: [],
  hypothesis: 'Hypothèse cachée',
  examName: 'Nom d’examen caché',
});

test('the patient proposal view keeps only id, revision, kind and state, and only items in review', () => {
  const statuses = patientProposalStatuses([
    fullProposal('a', 'lab_exam', 'pending'),
    fullProposal('b', 'home_measurement', 'needs_review'),
    fullProposal('c', 'information', 'needs_inputs'),
    fullProposal('d', 'lab_exam', 'approved'),
    fullProposal('e', 'lab_exam', 'rejected'),
  ]);
  assert.deepEqual(statuses, [
    { id: 'a', revision: 3, kind: 'lab_exam', state: 'pending' },
    { id: 'b', revision: 3, kind: 'home_measurement', state: 'needs_review' },
    { id: 'c', revision: 3, kind: 'information', state: 'needs_inputs' },
  ]);
  for (const status of statuses) assert.deepEqual(Object.keys(status).sort(), ['id', 'kind', 'revision', 'state']);
  assert.ok(!JSON.stringify(statuses).includes('HbA1c'));
  assert.ok(!JSON.stringify(statuses).includes('cachée'));
});

test('proposals in review are grouped by kind and state with counts only', () => {
  const groups = groupProposals(
    patientProposalStatuses([
      fullProposal('a', 'lab_exam', 'pending'),
      fullProposal('b', 'lab_exam', 'pending'),
      fullProposal('c', 'home_measurement', 'pending'),
    ]),
  );
  assert.deepEqual(groups, [
    { kind: 'lab_exam', state: 'pending', count: 2 },
    { kind: 'home_measurement', state: 'pending', count: 1 },
  ]);
});

test('patient proposal rows use neutral kind labels: a pending exam is never named or called an exam', () => {
  const proposals = [
    fullProposal('a', 'lab_exam', 'pending'),
    fullProposal('b', 'lab_exam', 'needs_review'),
    fullProposal('c', 'home_measurement', 'pending'),
    fullProposal('d', 'information', 'needs_inputs'),
  ];
  const fr = patientProposalRows(proposals, 'fr');
  const state = CARE_COPY.fr.proposalState;
  assert.deepEqual(
    fr.map((row) => [row.kindLabel, row.stateLabel, row.count]),
    [
      ['Proposition en cours de revue', state.pending, 1],
      ['Proposition en cours de revue', state.needs_review, 1],
      ['Mesure à domicile', state.pending, 1],
      ['Informations à compléter', state.needs_inputs, 1],
    ],
  );
  assert.doesNotMatch(JSON.stringify(fr), /examen|HbA1c|cach/i);
  const ar = patientProposalRows(proposals, 'ar');
  assert.doesNotMatch(JSON.stringify(ar), /فحص|HbA1c/);
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const careAction = (id: string, extra: Partial<CareAction> = {}): CareAction => ({
  id,
  patientId: 'p1',
  planId: 'plan',
  revision: 1,
  proposalId: 'prop-1',
  protocolId: null,
  originVersion: 2,
  action: { templateId: 'home.blood_pressure', templateVersion: 1, parameters: {} },
  dueAt: at(14),
  state: 'pending',
  reportedAt: null,
  clientId: `c-${id}`,
  createdAt: at(1),
  ...extra,
});

test('a passed review deadline is overdue: silence is never approval', () => {
  const plan: CarePlan = { id: 'p', patientId: 'p1', revision: 1, state: 'awaiting_clinician', clinicianId: null, profileBindings: [], actionIds: [], reviewDeadline: at(9) };
  assert.deepEqual(reviewDeadlineView(plan, NOW), { deadline: at(9), overdue: true });
  assert.deepEqual(reviewDeadlineView({ ...plan, reviewDeadline: at(20) }, NOW), { deadline: at(20), overdue: false });
  assert.deepEqual(reviewDeadlineView({ ...plan, reviewDeadline: null }, NOW), { deadline: null, overdue: false });
  assert.deepEqual(reviewDeadlineView(null, NOW), { deadline: null, overdue: false });
});

test('action origin distinguishes a one-time approval from a protocol application', () => {
  assert.deepEqual(actionOrigin(careAction('a')), { kind: 'approved_once', version: 2 });
  assert.deepEqual(actionOrigin(careAction('b', { proposalId: null, protocolId: 'proto', originVersion: 4 })), { kind: 'protocol', version: 4 });
  assert.equal(adviceFromAction(careAction('b', { protocolId: 'proto', originVersion: 4 })).kind, 'protocol_applied');
  assert.equal(adviceFromAction(careAction('a')).kind, 'approved_once');
});

// "Validé(e)" as a word; "invalide" in a translated reason is not an approval claim.
const VALIDATED_WORDING = /\bvalid[ée]|اعتمده|اعتمدها/i;

test('a lapsed approval never shows "validé" wording, even on a pending action', () => {
  const lapsed = careAction('a', {
    approval: { currentlyApproved: false, reasons: ['The plan review deadline is invalid.', 'A brand new reason.'], checkedAt: at(11) },
  });
  for (const lang of ['fr', 'ar'] as const) {
    const view = actionApproval(lapsed, lang);
    assert.equal(view.lapsed, true);
    assert.equal(view.origin, null, 'the original approval line is not shown');
    assert.equal(view.checkedAt, at(11));
    const copy = CARE_COPY[lang].plan;
    const rendered = [copy.approvalLapsed, copy.approvalLapsedNote, copy.approvalCheckedAt('x'), ...view.reasons.map((r) => r.text)];
    for (const text of rendered) assert.doesNotMatch(text, VALIDATED_WORDING, `${lang}: ${text}`);
  }
  assert.deepEqual(actionApproval(lapsed, 'fr').reasons, [
    { text: 'La date de revue du plan est invalide.', translated: true },
    { text: 'A brand new reason.', translated: false },
  ]);
  // Protocol-applied actions lapse the same way, and the advice card switches to its lapsed form.
  const protocolLapsed = careAction('p', { protocolId: 'proto', approval: { currentlyApproved: false, reasons: [], checkedAt: at(11) } });
  assert.equal(actionApproval(protocolLapsed, 'fr').origin, null);
  assert.equal(adviceFromAction(lapsed).kind, 'lapsed');
  assert.equal(adviceFromAction(protocolLapsed).kind, 'lapsed');
});

test('without live approval metadata the original origin is kept but nothing claims it is current', () => {
  const absent = careAction('a');
  const view = actionApproval(absent, 'fr');
  assert.deepEqual(view, {
    lapsed: false,
    current: false,
    closed: false,
    origin: { kind: 'approved_once', version: 2 },
    awaitReconfirmation: false,
    checkedAt: null,
    reasons: [],
  });
  assert.equal(adviceFromAction(absent).kind, 'approved_once');
});

test('a currently approved action keeps the existing wording', () => {
  const current = careAction('a', { approval: { currentlyApproved: true, reasons: [], checkedAt: at(11) } });
  assert.deepEqual(actionApproval(current, 'fr'), {
    lapsed: false,
    current: true,
    closed: false,
    origin: { kind: 'approved_once', version: 2 },
    awaitReconfirmation: false,
    checkedAt: at(11),
    reasons: [],
  });
  assert.equal(adviceFromAction(current).kind, 'approved_once');
});

// Root click-testing follow-up: a lapsed action may still be reported as already done
// (intended self-report), but a finished action is never told to wait before "following" it.
test('a pending lapsed action asks to wait for reconfirmation and says reporting records only what was already done', () => {
  const pending = careAction('a', { approval: { currentlyApproved: false, reasons: [], checkedAt: at(11) } });
  const view = actionApproval(pending, 'fr');
  assert.equal(view.lapsed, true);
  assert.equal(view.closed, false);
  assert.equal(view.origin, null);
  assert.equal(view.awaitReconfirmation, true);
  // Reporting stays possible: the backend permission is unchanged.
  assert.equal(canSelfReport(pending, { online: true, origin: 'server' }), 'allowed');
});

test('the note beside report controls appears only on a pending lapsed action, with the approved FR/AR copy', () => {
  const lapsed = { currentlyApproved: false, reasons: [], checkedAt: at(11) };
  const pending = careAction('a', { approval: lapsed });
  assert.equal(selfReportNote(pending, 'fr'), 'Déclarer ici enregistre une action déjà faite. Cela n’autorise pas à la faire maintenant.');
  assert.equal(selfReportNote(pending, 'ar'), 'التصريح هنا يسجّل إجراءً أُنجز من قبل، ولا يمنح إذنًا بإنجازه الآن.');
  for (const lang of ['fr', 'ar'] as const) assert.doesNotMatch(selfReportNote(pending, lang) ?? '', /\bvalid[ée]|اعتمده/i);
  // No note where nothing is lapsed, nor on a finished action (it has no report controls).
  assert.equal(selfReportNote(careAction('b'), 'fr'), null);
  assert.equal(selfReportNote(careAction('c', { approval: { ...lapsed, currentlyApproved: true } }), 'fr'), null);
  assert.equal(selfReportNote(careAction('d', { state: 'completed', reportedAt: at(10), approval: lapsed }), 'fr'), null);
});

test('a finished lapsed action keeps its history but never gets the "wait before following it" directive', () => {
  for (const state of ['completed', 'not_completed', 'cancelled'] as const) {
    const done = careAction('a', { state, reportedAt: at(10), approval: { currentlyApproved: false, reasons: ['x'], checkedAt: at(11) } });
    const view = actionApproval(done, 'fr');
    assert.equal(view.lapsed, true, `${state}: the live check is kept as data`);
    assert.equal(view.closed, true);
    assert.equal(view.awaitReconfirmation, false, `${state}: no future-action directive`);
    assert.deepEqual(view.origin, { kind: 'approved_once', version: 2 }, `${state}: historical authorization stays visible`);
    assert.notEqual(adviceFromAction(done).kind, 'lapsed');
  }
  const protocolDone = careAction('p', { state: 'completed', protocolId: 'proto', originVersion: 3, approval: { currentlyApproved: false, reasons: [], checkedAt: at(11) } });
  assert.deepEqual(actionApproval(protocolDone, 'fr').origin, { kind: 'protocol', version: 3 });
});

test('an action is overdue only while pending and past due', () => {
  assert.equal(isActionOverdue(careAction('a', { dueAt: at(9) }), NOW), true);
  assert.equal(isActionOverdue(careAction('a', { dueAt: at(13) }), NOW), false);
  assert.equal(isActionOverdue(careAction('a', { dueAt: at(9), state: 'completed' }), NOW), false);
});

test('self-report is online-only, on live data, for pending actions', () => {
  const pending = careAction('a');
  assert.equal(canSelfReport(pending, { online: true, origin: 'server' }), 'allowed');
  assert.equal(canSelfReport(pending, { online: false, origin: 'server' }), 'offline');
  assert.equal(canSelfReport(pending, { online: true, origin: 'device' }), 'device_copy');
  assert.equal(canSelfReport(careAction('a', { state: 'completed' }), { online: true, origin: 'server' }), 'not_pending');
});

test('actions list pending first by due date, then reported ones most recent first', () => {
  const sorted = sortActions([
    careAction('done-old', { state: 'completed', reportedAt: at(2) }),
    careAction('late', { dueAt: at(9) }),
    careAction('cancel', { state: 'cancelled' }),
    careAction('done-new', { state: 'not_completed', reportedAt: at(5) }),
    careAction('soon', { dueAt: at(13) }),
  ]);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['late', 'soon', 'done-new', 'done-old', 'cancel'],
  );
});

test('the validator name comes from the directory, otherwise it stays generic', () => {
  const doctors = [{ id: 'dr-a', displayName: 'Dr A', specialty: 'MG', fictional: true as const }];
  assert.equal(doctorName('dr-a', doctors), 'Dr A');
  assert.equal(doctorName('dr-x', doctors), null);
  assert.equal(doctorName(null, doctors), null);
});

test('blocked protocol applications are listed most recent first; others are not shown as blocked', () => {
  const application = (id: string, state: ProtocolApplication['state'], hour: number): ProtocolApplication => ({
    id,
    patientId: 'p1',
    protocolId: 'proto',
    protocolVersion: 2,
    triggerId: id,
    guard,
    state,
    reasons: ['treatment_changed'],
    sources: [],
    actionId: null,
    createdAt: at(hour),
    deliveredAt: null,
  });
  const blocked = blockedApplications([application('a', 'blocked', 3), application('b', 'delivered', 4), application('c', 'blocked', 6)]);
  assert.deepEqual(
    blocked.map((b) => b.id),
    ['c', 'a'],
  );
});
