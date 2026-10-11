import assert from 'node:assert/strict';
import test from 'node:test';
import type { Reminder } from '../src/contracts/care';
import type { CareAction } from '../src/contracts/monitoring';
import { ASSIST_COPY } from '../src/lib/client/copy/assist';
import { CARE_COPY } from '../src/lib/client/copy/care';
import {
  careActionReminderState,
  reminderDisplay,
  reminderGroups,
  upcomingReminders,
} from '../src/components/patient/plan/reminder-view';

const at = (hour: number) => new Date(Date.UTC(2026, 9, 12, hour)).toISOString();
const NOW = Date.parse(at(12));
const RECENT_MS = 12 * 3600_000;

const action = (id: string, state: CareAction['state']): CareAction => ({
  id,
  patientId: 'p1',
  planId: 'plan',
  revision: 2,
  proposalId: 'prop',
  protocolId: null,
  originVersion: 1,
  action: { templateId: 'home.blood_pressure', templateVersion: 1, parameters: {} },
  dueAt: at(14),
  state,
  reportedAt: state === 'pending' ? null : at(11),
  clientId: `c-${id}`,
  createdAt: at(1),
});

// Shape pushed by monitoring-worker.ts when an approved action's reminder is due.
const actionReminder = (id: string, actionId: string, hour: number): Reminder => ({
  id,
  patientId: 'p1',
  label: 'Mesurer la tension selon le plan approuvé.',
  dueAt: at(hour),
  acknowledgedAt: null,
  taken: null,
  delivery: 'sent',
  origin: { kind: 'care_action', actionId, planId: 'plan', protocolId: null, originVersion: 1 },
});

const medication = (id: string, hour: number): Reminder => ({
  id,
  patientId: 'p1',
  label: 'Traitement du soir',
  dueAt: at(hour),
  acknowledgedAt: null,
  taken: null,
  delivery: 'pending',
});

test('a reminder follows the state of its care action; a legacy reminder has none', () => {
  const actions = [action('done', 'completed'), action('open', 'pending'), action('skip', 'not_completed'), action('gone', 'cancelled')];
  assert.deepEqual(careActionReminderState(medication('m', 13), actions), { kind: 'none' });
  assert.deepEqual(careActionReminderState(actionReminder('r1', 'open', 13), actions), { kind: 'pending', actionId: 'open' });
  assert.deepEqual(careActionReminderState(actionReminder('r2', 'done', 13), actions), {
    kind: 'closed',
    actionId: 'done',
    state: 'completed',
    reportedAt: at(11),
  });
  assert.equal(careActionReminderState(actionReminder('r3', 'skip', 13), actions).kind, 'closed');
  assert.equal(careActionReminderState(actionReminder('r4', 'gone', 13), actions).kind, 'closed');
  // Not shared, or a device copy without that action: unknown, never assumed pending.
  assert.deepEqual(careActionReminderState(actionReminder('r5', 'missing', 13), actions), { kind: 'unknown', actionId: 'missing' });
});

test('a completed care action no longer appears as an upcoming reminder on Home', () => {
  const actions = [action('done', 'completed'), action('open', 'pending')];
  const reminders = [actionReminder('r-done', 'done', 13), actionReminder('r-open', 'open', 14), actionReminder('r-unknown', 'missing', 15), medication('m', 16)];
  assert.deepEqual(
    upcomingReminders(reminders, actions, NOW, 3).map((r) => r.id),
    ['r-open', 'm'],
  );
});

test('the Reminders screen lists a finished care action in the past group, whatever its due time', () => {
  const actions = [action('done', 'completed'), action('open', 'pending')];
  // m-old is due 13 h before NOW (hour -1 = 23:00 the previous day): past by time, as before.
  const groups = reminderGroups([actionReminder('r-done', 'done', 13), actionReminder('r-open', 'open', 14), medication('m-old', -1)], actions, NOW, RECENT_MS);
  assert.deepEqual(groups.upcoming.map((r) => r.id), ['r-open']);
  assert.deepEqual(groups.past.map((r) => r.id), ['r-done', 'm-old']);
});

test('care-action reminders never get medication "taken / not taken" controls (FR + AR)', () => {
  const actions = [action('done', 'completed'), action('open', 'pending')];
  for (const lang of ['fr', 'ar'] as const) {
    const done = reminderDisplay(actionReminder('r-done', 'done', 13), actions, lang);
    assert.deepEqual(done, { mode: 'closed', stateLabel: CARE_COPY[lang].actionState.completed, note: CARE_COPY[lang].plan.reportNote });
    const open = reminderDisplay(actionReminder('r-open', 'open', 14), actions, lang);
    assert.deepEqual(open, { mode: 'plan_link', href: '/patient/plan', label: ASSIST_COPY[lang].reminders.planLink });
    const unknown = reminderDisplay(actionReminder('r-x', 'missing', 14), actions, lang);
    assert.deepEqual(unknown, { mode: 'plan_link', href: '/patient/plan', label: ASSIST_COPY[lang].reminders.planLink });
    for (const view of [done, open, unknown]) assert.notEqual(view.mode, 'medication');
  }
  // A legacy medication reminder keeps its existing self-report exactly as before.
  assert.deepEqual(reminderDisplay(medication('m', 13), actions, 'fr'), { mode: 'medication' });
});
