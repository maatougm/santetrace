import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { consentDisplay, type ConsentDisplayInput } from '../src/components/patient/consent-display';

const server = (consent: boolean | undefined) => ({ record: { patient: { consent } }, origin: 'server' as const });
const device = (consent: boolean) => ({ record: { patient: { consent } }, origin: 'device' as const });
const none = { record: null, origin: null };
const err = (code: string) => ({ code });
const input = (over: Partial<ConsentDisplayInput>): ConsentDisplayInput => ({ acknowledged: false, ...none, error: null, ...over });

test('a revoked consent stays revoked after remount (no local acknowledgement)', () => {
  // Navigating away/back or reloading drops the component's memory; the server record still says false.
  assert.equal(consentDisplay(input({ ...server(false) })), 'revoked');
  // A server that refuses the read with CONSENT_REVOKED is just as authoritative.
  assert.equal(consentDisplay(input({ error: err('CONSENT_REVOKED') })), 'revoked');
  // Withdrawal is one-way server-side, so a dated device copy that recorded it is still true.
  assert.equal(consentDisplay(input({ ...device(false), error: err('NETWORK_ERROR') })), 'revoked');
});

test('only a live server record with consent true offers the withdrawal action', () => {
  assert.equal(consentDisplay(input({ ...server(true) })), 'active');
});

test('loading never briefly asserts that consent is active', () => {
  assert.equal(consentDisplay(input({})), 'loading');
  // A device copy shown while the first poll is in flight is not proof of current consent.
  assert.equal(consentDisplay(input({ ...device(true) })), 'loading');
});

test('network errors, other refusals and missing consent are unknown, never withdrawn or active', () => {
  for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'HTTP_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'UNAUTHENTICATED']) {
    assert.equal(consentDisplay(input({ error: err(code) })), 'unknown', code);
    // A stale "true" from earlier in the visit is not vouched for while the poll fails.
    assert.equal(consentDisplay(input({ ...server(true), error: err(code) })), 'unknown', `${code} + stale true`);
    assert.equal(consentDisplay(input({ ...device(true), error: err(code) })), 'unknown', `${code} + device true`);
  }
  assert.equal(consentDisplay(input({ ...server(undefined) })), 'unknown');
});

test('the successful withdrawal is shown immediately, before the refresh lands', () => {
  assert.equal(consentDisplay(input({ acknowledged: true, ...server(true) })), 'revoked');
  assert.equal(consentDisplay(input({ acknowledged: true })), 'revoked');
  assert.equal(consentDisplay(input({ acknowledged: true, error: err('NETWORK_ERROR') })), 'revoked');
});

test('SummaryScreen derives the panel from the runtime and keeps the same purge/logout path', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'components', 'patient', 'SummaryScreen.tsx'), 'utf8');
  // The withdrawn panel is no longer gated by a mount-local boolean.
  assert.doesNotMatch(source, /\[done, setDone\]/);
  assert.match(source, /consentDisplay\(\{[^}]*record: data\.record[^}]*origin: data\.origin[^}]*error: data\.error/s);
  // The acknowledgement is memory-only and bound to the actor scope that revoked.
  assert.doesNotMatch(source, /sessionStorage|localStorage/);
  assert.match(source, /setRevokedScope\(scope\)/);
  assert.match(source, /revokedScope === scope/);
  // Same authorised logout: actor purge veto runs before signing out.
  assert.match(source, /useLogout\(\{ onBeforeLogout: beforeLogout \}\)/);
  assert.equal(source.match(/onClick=\{\(\) => void logout\(\)\}/g)?.length, 2);
  // Withdrawal only from the explicit confirm button, and the dialog stays busy-vetoed.
  assert.equal(source.match(/revokeConsent\(/g)?.length, 1);
  assert.match(source, /onClick=\{\(\) => void revoke\(\)\}/);
  assert.match(source, /onClose=\{\(\) => \(busy \? undefined : setOpen\(false\)\)\}/);
});
