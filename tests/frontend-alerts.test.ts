import assert from 'node:assert/strict';
import test from 'node:test';
import { sortAlertQueue, summarizeOpenAlerts } from '../src/components/doctor/shared/alerts';

type Fixture = {
  id: string;
  status: 'new' | 'acknowledged' | 'rejected' | 'resolved';
  priority: 'orange' | 'red';
  createdAt: string;
};

const at = (minute: number) => new Date(Date.UTC(2026, 9, 10, 8, minute)).toISOString();
const alert = (id: string, status: Fixture['status'], priority: Fixture['priority'], minute: number): Fixture => ({
  id,
  status,
  priority,
  createdAt: at(minute),
});

const ids = (alerts: readonly Fixture[]) => alerts.map((a) => a.id);

test('acknowledged red stays ahead of a newer new orange: acknowledgment is not resolution', () => {
  const queue = sortAlertQueue([
    alert('orange-new', 'new', 'orange', 50),
    alert('red-ack', 'acknowledged', 'red', 5),
  ]);
  assert.deepEqual(ids(queue), ['red-ack', 'orange-new']);
});

test('open alerts order by severity, then new before acknowledged, then most recent first; closed last', () => {
  const queue = sortAlertQueue([
    alert('resolved-red', 'resolved', 'red', 59),
    alert('orange-ack', 'acknowledged', 'orange', 40),
    alert('orange-new-old', 'new', 'orange', 10),
    alert('red-ack', 'acknowledged', 'red', 1),
    alert('rejected-orange', 'rejected', 'orange', 58),
    alert('orange-new-recent', 'new', 'orange', 45),
    alert('red-new', 'new', 'red', 2),
    alert('red-ack-recent', 'acknowledged', 'red', 30),
  ]);
  assert.deepEqual(ids(queue), [
    'red-new',
    'red-ack-recent',
    'red-ack',
    'orange-new-recent',
    'orange-new-old',
    'orange-ack',
    'resolved-red',
    'rejected-orange',
  ]);
});

test('returns a new array and leaves the input untouched', () => {
  const input = Object.freeze([alert('a', 'new', 'orange', 1), alert('b', 'acknowledged', 'red', 2)]);
  const queue = sortAlertQueue(input);
  assert.notEqual(queue, input);
  assert.deepEqual(ids(input), ['a', 'b']);
});

test('an unreadable timestamp never lifts an alert above a readable one of the same rank', () => {
  const queue = sortAlertQueue([
    { ...alert('red-bad-date', 'new', 'red', 0), createdAt: 'not-a-date' },
    alert('red-dated', 'new', 'red', 3),
    alert('orange-new', 'new', 'orange', 9),
  ]);
  assert.deepEqual(ids(queue), ['red-dated', 'red-bad-date', 'orange-new']);
});

test('open summary counts every open red, with new/acknowledged breakdown, and ignores closed alerts', () => {
  const summary = summarizeOpenAlerts([
    alert('r1', 'new', 'red', 1),
    alert('r2', 'acknowledged', 'red', 2),
    alert('r3', 'acknowledged', 'red', 3),
    alert('r4', 'resolved', 'red', 4),
    alert('o1', 'new', 'orange', 5),
    alert('o2', 'acknowledged', 'orange', 6),
    alert('o3', 'rejected', 'orange', 7),
  ]);
  assert.deepEqual(summary, {
    red: { total: 3, new: 1, acknowledged: 2 },
    orange: { total: 2, new: 1, acknowledged: 1 },
  });
});

test('open summary is all zeros for an empty or fully closed queue', () => {
  const zero = { total: 0, new: 0, acknowledged: 0 };
  assert.deepEqual(summarizeOpenAlerts([]), { red: zero, orange: zero });
  assert.deepEqual(summarizeOpenAlerts([alert('x', 'resolved', 'red', 1)]), { red: zero, orange: zero });
});
