import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import type { Alert, Measurement, Reminder, Rules, Status } from '../src/contracts/care';
import type { CareAction, CareProposal, MedicalFact, MonitoringState, ConditionEvaluation, RevisionGuard } from '../src/contracts/monitoring';
import type { ProjectedRecord } from '../src/contracts/patient-platform';
import { isNavActive } from '../src/components/layout/nav';
import { HOME_COPY } from '../src/components/patient/home/home-copy';
import { homeStatusView, type HomeStatusInput } from '../src/components/patient/home/home-status';
import { firstName, hasAttention, homeAttention, nextPlanAction, nextStep } from '../src/components/patient/home/home-view';
import {
  DEVICES_HREF,
  HOME_QUICK_LINKS,
  PLAN_LINKS,
  RECORD_LINKS,
  RECORD_ROUTES,
  patientNavItems,
} from '../src/components/patient/patient-nav';
import { CARE_COPY } from '../src/lib/client/copy/care';
import { formatDateTime } from '../src/lib/client/format';
import { getMessages } from '../src/lib/client/i18n';

const at = (hour: number) => new Date(Date.UTC(2026, 9, 11, hour)).toISOString();
const NOW = Date.parse(at(12));
const fr = getMessages('fr');
const ar = getMessages('ar');
const guard: RevisionGuard = { contextRevision: 1, evidenceRevision: 1, authorityRevision: 1, carePlanRevision: 1, profileVersions: [] };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const record = (extra: Partial<ProjectedRecord> = {}, patient: Partial<ProjectedRecord['patient']> = {}): ProjectedRecord => ({
  patient: {
    id: 'p1',
    displayName: 'Fatma Ben Salah',
    region: 'Siliana',
    age: 62,
    language: 'fr',
    fictional: true,
    consent: true,
    rules: { overdueHours: 48 } as Rules,
    status: 'unknown',
    createdAt: at(0),
    ...patient,
  },
  measurements: [],
  alerts: [],
  reminders: [],
  documents: [],
  candidates: [],
  observations: [],
  access: { owner: true, relationship: null, scopes: [], grantId: null, grantRevision: null, authorityRevision: 1, canManageCare: false, canReviewLabs: false },
  medicalFacts: [],
  plan: null,
  actions: [],
  evaluations: [],
  monitoring: null,
  proposals: [],
  ...extra,
});

const fact = (id: string, code: string | null): MedicalFact => ({
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
});

const evaluation = (conditionFactId: string, priority: Status, coverage: ConditionEvaluation['coverage']): ConditionEvaluation => ({
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
});

const monitoring = (priority: Status, coverage: MonitoringState['coverage']): MonitoringState => ({ priority, coverage, reasons: [], evaluatedAt: at(10) });

const action = (id: string, dueHour: number, extra: Partial<CareAction> = {}): CareAction => ({
  id,
  patientId: 'p1',
  planId: 'plan',
  revision: 1,
  proposalId: null,
  protocolId: null,
  originVersion: 1,
  action: { templateId: 'home.blood_pressure', templateVersion: 1, parameters: {} },
  dueAt: at(dueHour),
  state: 'pending',
  reportedAt: null,
  clientId: `c-${id}`,
  createdAt: at(1),
  ...extra,
});

const reminder = (id: string, hour: number): Reminder => ({
  id,
  patientId: 'p1',
  label: 'Traitement du soir',
  dueAt: at(hour),
  acknowledgedAt: null,
  taken: null,
  delivery: 'pending',
});

const proposal = (id: string, state: CareProposal['state']): CareProposal => ({
  id,
  patientId: 'p1',
  revision: 1,
  kind: 'lab_exam',
  state,
  action: { templateId: 'exam.clinician_review', templateVersion: 1, parameters: {} },
  sources: [],
  guard,
  decision: null,
  history: [],
});

const bp = (id: string, hour: number, quality?: 'accepted' | 'suspect'): Measurement => ({
  id,
  patientId: 'p1',
  kind: 'blood_pressure',
  systolic: 150,
  diastolic: 95,
  unit: 'mmHg',
  status: 'orange',
  measuredAt: at(hour),
  capturedAt: at(hour),
  receivedAt: at(hour),
  clientId: id,
  source: quality ? 'device' : 'app',
  ruleVersion: 'demo-1',
  ...(quality ? { connector: { connectorId: 'c', deviceId: 'd', externalEventId: id, simulated: true, quality } } : {}),
});

const openRed: Alert = {
  id: 'a-red',
  patientId: 'p1',
  status: 'new',
  priority: 'red',
  reason: 'demo',
  ruleVersion: 'demo-1',
  rulesSnapshot: {} as Rules,
  createdAt: at(9),
  history: [],
};

const statusInput = (extra: Partial<HomeStatusInput>): HomeStatusInput => ({
  record: record(),
  live: true,
  stale: false,
  staleSince: null,
  team: 'present',
  lang: 'fr',
  t: fr,
  ...extra,
});

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

test('greeting uses the first name only, and a neutral greeting without a name', () => {
  assert.equal(firstName('Fatma Ben Salah'), 'Fatma');
  assert.equal(firstName('  Leïla   Mansour '), 'Leïla');
  assert.equal(firstName(''), '');
  assert.equal(firstName(null), '');
  assert.equal(fr.home.greeting(firstName(undefined)), 'Bonjour');
});

// ---------------------------------------------------------------------------
// Next step: from live data only, never invented
// ---------------------------------------------------------------------------

test('next step is the soonest pending, still-approved plan action', () => {
  const actions = [
    action('later', 20),
    action('lapsed', 13, { approval: { currentlyApproved: false, reasons: [], checkedAt: at(11) } }),
    action('done', 13, { state: 'completed', reportedAt: at(11) }),
    action('soon', 15),
  ];
  assert.equal(nextPlanAction(actions)?.id, 'soon');
  const step = nextStep({ live: true, actions, reminders: [reminder('r', 14)], facts: [fact('f', 'hypertension')], now: NOW });
  assert.deepEqual(step && step.kind === 'action' ? [step.action.id, step.overdue] : null, ['soon', false]);
  const overdue = nextStep({ live: true, actions: [action('late', 10)], reminders: [], facts: [], now: NOW });
  assert.equal(overdue?.kind === 'action' && overdue.overdue, true);
});

test('next step falls back to an undeclared reminder, then to the welcome questions when nothing is declared', () => {
  const withReminder = nextStep({ live: true, actions: [], reminders: [reminder('r', 14)], facts: [fact('f', 'hypertension')], now: NOW });
  assert.equal(withReminder?.kind === 'reminder' && withReminder.reminder.id, 'r');
  assert.deepEqual(nextStep({ live: true, actions: [], reminders: [], facts: [], now: NOW }), { kind: 'onboarding' });
});

test('no next step is invented: none with declared facts and nothing due, none from a device copy', () => {
  assert.equal(nextStep({ live: true, actions: [], reminders: [], facts: [fact('f', 'hypertension')], now: NOW }), null);
  assert.equal(nextStep({ live: false, actions: [action('a', 15)], reminders: [reminder('r', 14)], facts: [], now: NOW }), null);
  const lapsedOnly = [action('lapsed', 15, { approval: { currentlyApproved: false, reasons: [], checkedAt: at(11) } })];
  assert.equal(nextStep({ live: true, actions: lapsedOnly, reminders: [], facts: [fact('f', 'x')], now: NOW }), null);
});

// ---------------------------------------------------------------------------
// Attention rows
// ---------------------------------------------------------------------------

test('attention: the latest suspect reading, approvals at the doctor, answers owed by the patient and missing consent stay visible', () => {
  const attention = homeAttention(
    record(
      {
        measurements: [bp('old-suspect', 2, 'suspect'), bp('latest', 8, 'suspect')],
        proposals: [
          proposal('p1', 'pending'),
          proposal('p2', 'needs_review'),
          proposal('p3', 'approved'),
          proposal('p4', 'needs_inputs'),
          proposal('p5', 'rejected'),
        ],
        actions: [action('lapsed', 15, { approval: { currentlyApproved: false, reasons: [], checkedAt: at(11) } })],
      },
      { consent: false },
    ),
    true,
  );
  assert.deepEqual(attention.suspect.map((m) => m.id), ['latest']);
  // needs_inputs waits on the patient, never counted as "waiting for the doctor".
  assert.equal(attention.awaitingDoctor, 2);
  assert.equal(attention.needsInputs, 1);
  assert.equal(attention.toReconfirm, 1);
  assert.equal(attention.consentMissing, true);
  assert.equal(hasAttention(attention), true);
});

test('needs_inputs alone is an attention row for the patient, not a doctor-review count', () => {
  const attention = homeAttention(record({ proposals: [proposal('p', 'needs_inputs')] }), true);
  assert.equal(attention.needsInputs, 1);
  assert.equal(attention.awaitingDoctor, 0);
  assert.equal(hasAttention(attention), true);
  assert.doesNotMatch(HOME_COPY.fr.needsInputs(1), /médecin/);
  assert.match(HOME_COPY.fr.needsInputs(1), /^À compléter : 1 proposition attend vos réponses$/);
  assert.match(HOME_COPY.fr.needsInputs(2), /2 propositions attendent vos réponses/);
  assert.match(HOME_COPY.ar.needsInputs(2), /إجاباتك: 2$/);
  assert.match(HOME_COPY.fr.awaitingDoctor(2), /revue du médecin/);
});

test('attention: a newer accepted reading clears the suspect row; a device copy claims no pending approvals', () => {
  const attention = homeAttention(
    record({ measurements: [bp('suspect', 2, 'suspect'), bp('ok', 8, 'accepted')], proposals: [proposal('p', 'pending'), proposal('q', 'needs_inputs')] }),
    false,
  );
  assert.deepEqual(attention.suspect, []);
  assert.equal(attention.awaitingDoctor, 0);
  assert.equal(attention.needsInputs, 0);
  assert.equal(hasAttention(attention), false);
});

// ---------------------------------------------------------------------------
// Status card: never a green the data does not support
// ---------------------------------------------------------------------------

test('status card: live green only with complete coverage and a working poll', () => {
  const facts = [fact('f', 'hypertension')];
  const live = record({ medicalFacts: facts, evaluations: [evaluation('f', 'green', ['complete'])], monitoring: monitoring('green', ['complete']) }, { status: 'green' });
  const view = homeStatusView(statusInput({ record: live }));
  assert.equal(view.status, 'green');
  assert.deepEqual(view.lines, []);
  assert.equal(view.evaluatedAt, at(10));
  assert.equal(view.serverOnly, true);

  const failing = homeStatusView(statusInput({ record: live, stale: true, staleSince: at(11) }));
  assert.equal(failing.status, 'unknown');
  assert.deepEqual(failing.lines, [fr.status.staleUnverified(formatDateTime(at(11), 'fr'))]);
  assert.equal(failing.serverOnly, false);
});

test('status card: no evaluation reads unknown with the honest reason; an open red alert is red', () => {
  const none = homeStatusView(statusInput({ record: record({}, { status: 'green' }) }));
  assert.equal(none.status, 'unknown');
  assert.deepEqual(none.lines, [CARE_COPY.fr.monitoring.noEvaluation]);
  const red = homeStatusView(statusInput({ record: record({ alerts: [openRed] }) }));
  assert.equal(red.status, 'red');
});

test('status card from a device copy: green is unverified, orange stays dated, unknown says data is missing', () => {
  const since = at(6);
  const date = formatDateTime(since, 'ar');
  const device = (status: Status) => homeStatusView(statusInput({ record: record({}, { status }), live: false, stale: true, staleSince: since, team: 'none', lang: 'ar', t: ar }));
  const green = device('green');
  assert.equal(green.status, 'unknown');
  assert.deepEqual(green.lines, [ar.status.staleUnverified(date)]);
  const orange = device('orange');
  assert.equal(orange.status, 'orange');
  assert.deepEqual(orange.lines, [ar.noReferent.statusOrange, ar.status.staleAsOf(date)]);
  const unknown = device('unknown');
  assert.deepEqual(unknown.lines, [ar.status.unknown(48), ar.status.staleAsOf(date)]);
  assert.equal(unknown.serverOnly, false);
});

// ---------------------------------------------------------------------------
// Navigation: ≤ 5 short tabs, every route ≤ 2 taps away, one highlighted tab
// ---------------------------------------------------------------------------

function patientRoutes(): string[] {
  const root = join(process.cwd(), 'src', 'app', 'patient');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path);
      return name === 'page.tsx' ? [`/patient${relative(root, dir).split(sep).map((s) => (s ? `/${s}` : '')).join('')}`] : [];
    });
  return walk(root).sort();
}

test('bottom navigation has at most 5 items with short French and Arabic labels', () => {
  for (const [t, lang] of [[fr, 'fr'], [ar, 'ar']] as const) {
    const items = patientNavItems(t, lang);
    assert.ok(items.length <= 5);
    assert.deepEqual(items.map((item) => item.href), ['/patient', '/patient/measure', '/patient/messages', '/patient/plan', '/patient/record']);
    for (const item of items) assert.ok(item.label.length > 0 && item.label.length <= 10, `${lang}: "${item.label}" is too long for 320 px`);
  }
});

test('every patient route is reachable within two taps of the tab bar, and highlights exactly one tab', () => {
  const nav = patientNavItems(fr, 'fr');
  const hubs: Record<string, readonly string[]> = {
    '/patient': [...HOME_QUICK_LINKS.map((l) => l.href), DEVICES_HREF],
    '/patient/measure': [DEVICES_HREF],
    '/patient/plan': PLAN_LINKS.map((l) => l.href),
    '/patient/record': RECORD_LINKS.map((l) => l.href),
  };
  const routes = patientRoutes();
  assert.ok(routes.length >= 14, routes.join(', '));
  for (const route of routes) {
    const direct = nav.some((item) => item.href === route);
    const viaHub = nav.some((item) => (hubs[item.href] ?? []).includes(route));
    assert.ok(direct || viaHub, `${route} is more than two taps away`);
    const active = nav.filter((item) => isNavActive(route, item)).map((item) => item.href);
    assert.equal(active.length, 1, `${route} highlights ${active.join(', ') || 'no tab'}`);
  }
  assert.deepEqual([...RECORD_ROUTES].sort(), RECORD_LINKS.map((l) => l.href).sort());
  assert.ok(existsSync(join(process.cwd(), 'src', 'app', 'patient', 'measure', 'devices', 'page.tsx')));
});

// ---------------------------------------------------------------------------
// Local copy parity
// ---------------------------------------------------------------------------

type Leaf = { path: string; kind: string; arity?: number; value?: string };

function leaves(value: unknown, path = ''): Leaf[] {
  if (typeof value === 'function') return [{ path, kind: 'function', arity: value.length }];
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value)
      .sort()
      .flatMap((key) => leaves((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
  }
  return [{ path, kind: typeof value, value: String(value) }];
}

test('home copy: French and Arabic have the same keys and arities, and Arabic strings are Arabic', () => {
  const strip = (list: Leaf[]) => list.map(({ path, kind, arity }) => ({ path, kind, arity }));
  assert.deepEqual(strip(leaves(HOME_COPY.ar)), strip(leaves(HOME_COPY.fr)));
  const arabic = /[؀-ۿ]/;
  for (const leaf of leaves(HOME_COPY.ar)) {
    if (leaf.kind === 'string') assert.ok(arabic.test(leaf.value ?? ''), `ar.${leaf.path} is not Arabic`);
  }
  assert.match(HOME_COPY.ar.awaitingDoctor(3), /3/);
  assert.match(HOME_COPY.fr.awaitingDoctor(1), /^1 proposition /);
  assert.match(HOME_COPY.fr.suspect('Tension'), /exclue des règles/);
});
