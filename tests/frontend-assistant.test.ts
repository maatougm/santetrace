import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiMeta, AssistantResponse, CareAction, CareMessage, ContactRequest, RevisionGuard } from '../src/contracts/monitoring';
import type { CareGrant, DoctorProfile } from '../src/contracts/patient-platform';
import { ASSIST_COPY } from '../src/lib/client/copy/assist';
import { replyProvenance, replyTitle, replyView, validateQuestion } from '../src/components/patient/plan/assistant-view';
import { CARE_COPY } from '../src/lib/client/copy/care';
import {
  buildMessageInput,
  canCancelContact,
  contactStateLabel,
  fetchAllMessages,
  forwardOption,
  mergeContactRequests,
  mergeMessages,
  messageRecipients,
  messagesToMarkRead,
  ownMessageState,
  validateMessage,
} from '../src/components/patient/contact/contact-view';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 9, minute)).toISOString();
const guard: RevisionGuard = { contextRevision: 1, evidenceRevision: 1, authorityRevision: 1, carePlanRevision: 1, profileVersions: [] };
const meta = (extra: Partial<AiMeta> = {}): AiMeta => ({
  mode: 'deterministic',
  model: null,
  schemaVersion: 's1',
  promptVersion: 'p1',
  guard,
  generatedAt: at(0),
  stale: false,
  failureReason: null,
  ...extra,
});
const action: CareAction = {
  id: 'act-1',
  patientId: 'p1',
  planId: 'plan',
  revision: 1,
  proposalId: 'prop',
  protocolId: null,
  originVersion: 1,
  action: { templateId: 'home.blood_pressure', templateVersion: 1, parameters: {} },
  dueAt: at(30),
  state: 'pending',
  reportedAt: null,
  clientId: 'c',
  createdAt: at(0),
};
const response = (extra: Partial<AssistantResponse>): AssistantResponse => ({
  replyKind: 'record_answer',
  answer: 'Réponse du serveur',
  approvedActions: [],
  sources: [],
  messageId: null,
  meta: meta(),
  ...extra,
});

// ---------------------------------------------------------------------------
// Assistant reply decision table
// ---------------------------------------------------------------------------

test('record_answer shows the server text only, never actions', () => {
  const view = replyView(response({ replyKind: 'record_answer', approvedActions: [action] }), 'record_query');
  assert.equal(view.kind, 'record_answer');
  assert.equal(view.answer, 'Réponse du serveur');
  assert.deepEqual(view.actions, []);
  assert.equal(view.note, null);
});

test('approved_action shows the approved actions and their sources', () => {
  const source = { kind: 'measurement' as const, id: 'm1', revision: 1, contentHash: null, date: at(1), verification: 'patient_reported' as const, polarity: 'affirmed' as const };
  const view = replyView(response({ replyKind: 'approved_action', approvedActions: [action], sources: [source] }), 'record_query');
  assert.deepEqual(view.actions, [action]);
  assert.deepEqual(view.sources, [source]);
  assert.equal(view.note, null);
});

test('an approved_action reply with a lapsed approval is not titled as validated', () => {
  const lapsed = { ...action, approval: { currentlyApproved: false, reasons: [], checkedAt: at(5) } };
  const view = replyView(response({ replyKind: 'approved_action', approvedActions: [lapsed] }), 'record_query');
  assert.equal(view.lapsed, true);
  for (const lang of ['fr', 'ar'] as const) assert.doesNotMatch(replyTitle(view, lang), /\bvalid[ée]|اعتمده|اعتمدها/i);
  // Current or unchecked approvals keep the normal title.
  const current = replyView(response({ replyKind: 'approved_action', approvedActions: [action] }), 'record_query');
  assert.equal(current.lapsed, false);
  assert.equal(replyTitle(current, 'fr'), ASSIST_COPY.fr.assistant.replyKind.approved_action);
});

test('needs_clinician claims a recorded message only when the server returned a message id', () => {
  const recorded = replyView(response({ replyKind: 'needs_clinician', messageId: 'msg-1' }), 'question');
  assert.equal(recorded.note, 'messageRecorded');

  const pending = replyView(response({ replyKind: 'needs_clinician', messageId: null }), 'question');
  assert.equal(pending.note, 'noRecipientPending');
  assert.notEqual(pending.note, 'messageRecorded');
  const text = ASSIST_COPY.fr.assistant[pending.note as 'noRecipientPending'];
  assert.ok(!text.includes('enregistrée comme message'));

  // A fixed record query sends nothing anyway: no recipient wording at all.
  assert.equal(replyView(response({ replyKind: 'needs_clinician', messageId: null }), 'record_query').note, null);
  // Actions are never offered on a needs_clinician reply.
  assert.deepEqual(replyView(response({ replyKind: 'needs_clinician', approvedActions: [action] }), 'question').actions, []);
});

test('unavailable falls back to the fixed text when the server gave none, and never shows actions or sources', () => {
  const empty = replyView(response({ replyKind: 'unavailable', answer: '  ', approvedActions: [action] }), 'question');
  assert.equal(empty.answer, null);
  assert.equal(empty.note, 'unavailableBody');
  assert.deepEqual(empty.actions, []);
  assert.deepEqual(empty.sources, []);

  const explained = replyView(response({ replyKind: 'unavailable', answer: 'Aucun médecin référent.' }), 'question');
  assert.equal(explained.answer, 'Aucun médecin référent.');
  assert.equal(explained.note, null);
});

test('an unknown reply kind is treated as unavailable, without its text', () => {
  const view = replyView(response({ replyKind: 'free_advice' as AssistantResponse['replyKind'], answer: 'Prenez 2 comprimés' }), 'question');
  assert.equal(view.kind, 'unavailable');
  assert.equal(view.answer, null);
  assert.equal(view.note, 'unavailableBody');
});

test('the AI mode and failure reason are always carried to the view', () => {
  const view = replyView(response({ meta: meta({ mode: 'local_model', failureReason: 'timeout' }) }), 'question');
  assert.equal(view.mode, 'local_model');
  assert.equal(view.failure, 'timeout');
});

// ---------------------------------------------------------------------------
// Truthful AI provenance (root follow-up: cloud_model)
// ---------------------------------------------------------------------------

const LOCAL_OR_VALIDATED = /local|محلي|valid[ée]|اعتمد|clinique|سريري/i;

test('a cloud_model reply is labelled as the remote external model, never as local', () => {
  const view = replyView(response({ meta: meta({ mode: 'cloud_model', model: 'remote-model' }) }), 'question');
  assert.equal(view.mode, 'cloud_model');
  for (const lang of ['fr', 'ar'] as const) {
    const provenance = replyProvenance(view, lang);
    assert.equal(provenance.modeLabel, CARE_COPY[lang].aiMode.cloud_model);
    assert.notEqual(provenance.modeLabel, CARE_COPY[lang].aiMode.local_model);
    assert.equal(provenance.fallbackLine, null);
    assert.doesNotMatch(provenance.modeLabel ?? '', LOCAL_OR_VALIDATED);
    // The always-shown limit says what the assistant does not do; it validates nothing.
    assert.doesNotMatch(ASSIST_COPY[lang].assistant.noAdvice, /valid[ée]|اعتمد/i);
  }
  assert.match(replyProvenance(view, 'fr').modeLabel ?? '', /distant|externe/);
});

test('a failed model call still shows the fixed-rules line, whatever mode the server reports', () => {
  for (const mode of ['cloud_model', 'deterministic', 'local_model'] as const) {
    const view = replyView(response({ meta: meta({ mode, failureReason: 'provider_unavailable' }) }), 'question');
    const provenance = replyProvenance(view, 'fr');
    assert.equal(provenance.fallbackLine, `${CARE_COPY.fr.aiMode.deterministic} · ${CARE_COPY.fr.aiFailure.provider_unavailable}`);
    assert.doesNotMatch(provenance.fallbackLine ?? '', LOCAL_OR_VALIDATED);
  }
  // The unavailable fallback text claims neither local processing nor validation.
  for (const lang of ['fr', 'ar'] as const) assert.doesNotMatch(ASSIST_COPY[lang].assistant.unavailableBody, LOCAL_OR_VALIDATED);
});

test('an unknown AI mode gets no provenance label rather than a guessed one', () => {
  const view = replyView(response({ meta: meta({ mode: 'mystery' as AiMeta['mode'] }) }), 'question');
  assert.equal(replyProvenance(view, 'fr').modeLabel, null);
});

test('questions are required and bounded to 2000 characters', () => {
  assert.equal(validateQuestion('   '), 'emptyQuestion');
  assert.equal(validateQuestion('x'.repeat(2001)), 'tooLong');
  assert.equal(validateQuestion(' Bonjour '), null);
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const message = (id: string, extra: Partial<CareMessage> = {}): CareMessage => ({
  id,
  revision: 1,
  patientId: 'p1',
  clinicianId: 'dr-a',
  threadId: 't',
  authorId: 'p1-actor',
  authorCategory: 'patient',
  text: 'Bonjour',
  kind: 'clinical',
  actionId: null,
  createdAt: at(1),
  readAt: null,
  review: null,
  ...extra,
});

test('own message state: recorded, read only with readAt, reviewed when the clinician reviewed it', () => {
  assert.equal(ownMessageState(message('a')), 'recorded');
  assert.equal(ownMessageState(message('a', { readAt: at(5) })), 'read');
  const review = { clinicianId: 'dr-a', at: at(6), reason: 'vu', guard };
  assert.equal(ownMessageState(message('a', { readAt: at(5), review })), 'reviewed');
  // A review is shown as a review; it never fabricates a "read" receipt.
  assert.equal(ownMessageState(message('a', { readAt: null, review })), 'reviewed');
});

test('only unread incoming messages are marked read, once each', () => {
  const messages = [
    message('mine'),
    message('doc-unread', { authorCategory: 'clinician', authorId: 'dr-a' }),
    message('doc-read', { authorCategory: 'clinician', authorId: 'dr-a', readAt: at(3) }),
    message('system', { authorCategory: 'system', authorId: 'system', kind: 'approved_action' }),
  ];
  assert.deepEqual(messagesToMarkRead(messages, new Set()), ['doc-unread', 'system']);
  assert.deepEqual(messagesToMarkRead(messages, new Set(['doc-unread'])), ['system']);
});

test('merging messages keeps the newest revision of each and orders by time', () => {
  const merged = mergeMessages(
    [message('b', { createdAt: at(2) }), message('a', { createdAt: at(1) })],
    [message('b', { createdAt: at(2), revision: 2, readAt: at(4) }), message('c', { createdAt: at(3) })],
  );
  assert.deepEqual(
    merged.map((m) => [m.id, m.revision]),
    [
      ['a', 1],
      ['b', 2],
      ['c', 1],
    ],
  );
  const stale = mergeMessages([message('b', { revision: 3 })], [message('b', { revision: 2 })]);
  assert.equal(stale[0].revision, 3);
});

test('all message pages are followed through the cursor, bounded by a page cap', async () => {
  const pages: Record<string, { messages: CareMessage[]; nextCursor: string | null }> = {
    '': { messages: [message('a', { createdAt: at(1) })], nextCursor: 'a' },
    a: { messages: [message('b', { createdAt: at(2) })], nextCursor: 'b' },
    b: { messages: [message('c', { createdAt: at(3) })], nextCursor: null },
  };
  const calls: (string | null)[] = [];
  const all = await fetchAllMessages(async (after) => {
    calls.push(after);
    return pages[after ?? ''];
  }, 10);
  assert.deepEqual(calls, [null, 'a', 'b']);
  assert.deepEqual(all.messages.map((m) => m.id), ['a', 'b', 'c']);
  assert.equal(all.truncated, false);

  const capped = await fetchAllMessages(async (after) => pages[after ?? ''], 2);
  assert.deepEqual(capped.messages.map((m) => m.id), ['a', 'b']);
  assert.equal(capped.truncated, true);
});

test('patient messages are always sent as clinical: there is no patient type choice', () => {
  assert.deepEqual(buildMessageInput('  Bonjour docteur  ', 'dr-a', 'msg-1'), {
    text: 'Bonjour docteur',
    kind: 'clinical',
    clinicianId: 'dr-a',
    clientId: 'msg-1',
  });
  assert.equal(buildMessageInput.length, 3);
});

test('message text is required and bounded to 2000 characters', () => {
  assert.equal(validateMessage(''), 'emptyText');
  assert.equal(validateMessage('x'.repeat(2001)), 'tooLong');
  assert.equal(validateMessage('x'.repeat(2000)), null);
});

test('recipients are active grants with the messages scope, named from the directory', () => {
  const grant = (id: string, clinicianId: string, state: CareGrant['state'], scopes: CareGrant['scopes']): CareGrant => ({
    id,
    patientId: 'p1',
    clinicianId,
    relationship: 'generalist',
    scopes,
    state,
    issuedAt: at(0),
    acceptedAt: at(1),
    revokedAt: null,
    revision: 1,
  });
  const doctors: DoctorProfile[] = [{ id: 'dr-a', displayName: 'Dr A', specialty: 'MG', fictional: true }];
  const recipients = messageRecipients(
    [
      grant('g1', 'dr-a', 'active', ['status', 'messages']),
      grant('g2', 'dr-b', 'active', ['status']),
      grant('g3', 'dr-c', 'pending', ['messages']),
      grant('g4', 'dr-d', 'revoked', ['messages']),
      grant('g5', 'dr-e', 'active', ['messages']),
    ],
    doctors,
  );
  assert.deepEqual(recipients, [
    { clinicianId: 'dr-a', name: 'Dr A' },
    { clinicianId: 'dr-e', name: null },
  ]);
});

// ---------------------------------------------------------------------------
// Owner-authorized forwarding to the primary referent
// ---------------------------------------------------------------------------

const careGrant = (clinicianId: string, relationship: CareGrant['relationship'], state: CareGrant['state'] = 'active'): CareGrant => ({
  id: `g-${clinicianId}`,
  patientId: 'p1',
  clinicianId,
  relationship,
  scopes: ['messages'],
  state,
  issuedAt: at(0),
  acceptedAt: at(1),
  revokedAt: null,
  revision: 1,
});

test('forwarding is offered only for own clinical messages in a secondary thread with an active primary', () => {
  const grants = [careGrant('dr-primary', 'primary'), careGrant('dr-spec', 'specialist')];
  const own = message('m1', { clinicianId: 'dr-spec' });
  assert.deepEqual(forwardOption(own, 'dr-spec', grants), { kind: 'offer', targetClinicianId: 'dr-primary' });

  // Not the patient's own clinical text: never offered.
  assert.deepEqual(forwardOption(message('m2', { clinicianId: 'dr-spec', kind: 'administrative' }), 'dr-spec', grants), { kind: 'none' });
  assert.deepEqual(
    forwardOption(message('m3', { clinicianId: 'dr-spec', authorCategory: 'clinician', authorId: 'dr-spec' }), 'dr-spec', grants),
    { kind: 'none' },
  );
  // The primary's own thread needs no forwarding.
  assert.deepEqual(forwardOption(message('m4', { clinicianId: 'dr-primary' }), 'dr-primary', grants), { kind: 'none' });
  // A thread without an active grant offers nothing.
  assert.deepEqual(forwardOption(own, 'dr-gone', grants), { kind: 'none' });
});

test('without an active primary the message cannot be forwarded', () => {
  const pendingPrimary = [careGrant('dr-primary', 'primary', 'pending'), careGrant('dr-gp', 'generalist')];
  assert.deepEqual(forwardOption(message('m1', { clinicianId: 'dr-gp' }), 'dr-gp', pendingPrimary), { kind: 'no_primary' });
  const revokedPrimary = [careGrant('dr-primary', 'primary', 'revoked'), careGrant('dr-gp', 'generalist')];
  assert.deepEqual(forwardOption(message('m1', { clinicianId: 'dr-gp' }), 'dr-gp', revokedPrimary), { kind: 'no_primary' });
});

test('an already forwarded message shows the server record, and a forwarded copy is never forwarded again', () => {
  const grants = [careGrant('dr-primary', 'primary'), careGrant('dr-spec', 'specialist')];
  const forwarded = message('m1', {
    clinicianId: 'dr-spec',
    forwardedForReview: { messageId: 'copy-1', clinicianId: 'dr-primary', at: at(9) },
  });
  assert.deepEqual(forwardOption(forwarded, 'dr-spec', grants), { kind: 'forwarded', at: at(9) });
  const copy = message('copy-1', { clinicianId: 'dr-primary', forwardedFromMessageId: 'm1', forwardedFromMessageRevision: 1 });
  assert.deepEqual(forwardOption(copy, 'dr-primary', grants), { kind: 'none' });
});

// ---------------------------------------------------------------------------
// Contact requests
// ---------------------------------------------------------------------------

const contact = (id: string, state: ContactRequest['state'], extra: Partial<ContactRequest> = {}): ContactRequest => ({
  id,
  revision: 1,
  patientId: 'p1',
  clinicianId: 'dr-a',
  state,
  messageId: null,
  createdAt: at(1),
  history: [],
  ...extra,
});

test('a contact request is never presented as a call or a connection', () => {
  for (const lang of ['fr', 'ar'] as const) {
    for (const state of ['requested', 'acknowledged', 'contact_reported', 'cancelled'] as const) {
      const label = contactStateLabel(state, lang);
      assert.ok(label, `${state} has a label`);
      assert.ok(!/appel en cours|connecté|établi/i.test(label ?? ''));
    }
  }
  assert.match(contactStateLabel('requested', 'fr') ?? '', /pas un appel/);
  assert.equal(contactStateLabel('connected', 'fr'), null);
});

test('only open requests can be cancelled by the patient', () => {
  assert.equal(canCancelContact(contact('a', 'requested')), true);
  assert.equal(canCancelContact(contact('a', 'acknowledged')), true);
  assert.equal(canCancelContact(contact('a', 'contact_reported')), false);
  assert.equal(canCancelContact(contact('a', 'cancelled')), false);
});

test('contact requests merge by id, keep the newest revision and list most recent first', () => {
  const merged = mergeContactRequests(
    [contact('a', 'requested', { createdAt: at(1) })],
    [contact('a', 'cancelled', { revision: 2, createdAt: at(1) }), contact('b', 'requested', { createdAt: at(5) })],
  );
  assert.deepEqual(
    merged.map((c) => [c.id, c.state]),
    [
      ['b', 'requested'],
      ['a', 'cancelled'],
    ],
  );
});
