import { fixtureStore } from "./helpers/care-fixture";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CareStore, DEFAULT_CARE_RULES } from '../src/lib/care-store';
import { CareService } from '../src/lib/care-service';
import type { Actor } from '../src/contracts/care';
const actor: Actor = { id: 'patient:fatma', role: 'patient', displayName: 'Fatma', patientId: 'fatma' };
const doctor: Actor = { id: 'demo-clinician', role: 'clinician', displayName: 'Demo', patientId: null };
test('measurement and replay survive a closed and reopened disk repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hackcure-restart-'));
  const path = join(directory, 'care.sqlite');
  let store = fixtureStore(path);
  try {
    const input = { kind: 'blood_pressure', systolic: 170, diastolic: 95, unit: 'mmHg', measuredAt: new Date().toISOString(), clientId: 'restart-key' };
    const first = new CareService(store).measurement(actor, 'fatma', input);
    store.close(); store = fixtureStore(path);
    assert.deepEqual(new CareService(store).measurement(actor, 'fatma', input), first);
    assert.equal(store.read().measurements.length, 1); assert.equal(store.read().alerts.length, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('delayed capture uses current received rules while earlier alerts retain their snapshots', () => {
  const store = fixtureStore();
  try {
    const service = new CareService(store);
    const first = service.measurement(actor, 'fatma', { kind: 'glucose', value: 260, unit: 'mg/dL', measuredAt: new Date().toISOString(), clientId: 'original' });
    const rules = service.rules(doctor, 'fatma', { ...DEFAULT_CARE_RULES, glucoseWarn: 150, glucoseHigh: 200 }).patient.rules;
    const captured = new Date(Date.now() - 48 * 3600000).toISOString();
    const received = service.measurement(actor, 'fatma', { kind: 'glucose', value: 210, unit: 'mg/dL', measuredAt: captured, capturedAt: captured, clientId: 'delayed' });
    assert.equal(received.measurement.ruleVersion, rules!.version); assert.equal(received.alert!.rulesSnapshot.glucoseHigh, 200);
    assert.notEqual(received.measurement.receivedAt, captured); assert.ok(received.measurement.clockWarning);
    assert.equal(store.read().alerts.find(a => a.id === first.alert!.id)!.rulesSnapshot.glucoseHigh, 250);
  } finally { store.close(); }
});
test('summary and export omit proposed candidates and preserve confirmed source IDs', () => {
  const store = fixtureStore();
  try {
    store.transaction(s => {
      s.candidates.push({ id: 'candidate', documentId: 'source', patientId: 'fatma', exam: 'HbA1c', value: 8.4, unit: '%', examDate: '2026-10-03', page: 1, sourceText: 'Synthetic', confidence: 'high', confidenceReason: 'Synthetic', identityMatch: 'matched', status: 'proposed' });
      s.observations.push({ id: 'confirmed', documentId: 'confirmed-source', candidateId: 'reviewed-candidate', patientId: 'fatma', exam: 'HbA1c', value: 8, unit: '%', examDate: '2026-10-02', confirmedBy: doctor.id, confirmedAt: new Date().toISOString(), revisions: [] });
    });
    const service = new CareService(store); const summary = service.summary(doctor, 'fatma');
    assert.equal(summary.ai, false); assert.deepEqual(summary.facts, [{ id: 'confirmed', kind: 'HbA1c', sourceId: 'confirmed-source' }]);
    const exported = service.export(doctor, 'fatma'); assert.equal(exported.terminologyMapping, 'unverified');
    assert.equal(exported.observations.length, 1); assert.equal(exported.observations[0].documentId, 'confirmed-source');
  } finally { store.close(); }
});
