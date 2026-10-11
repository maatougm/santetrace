import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { Reminder } from '../src/contracts/care';
import type { CareAction } from '../src/contracts/monitoring';
import { reminderDisplay } from '../src/components/patient/plan/reminder-view';
import { ASSIST_COPY } from '../src/lib/client/copy/assist';
import { CARE_COPY } from '../src/lib/client/copy/care';
import { getMessages } from '../src/lib/client/i18n';

/**
 * The reminders page lists every reminder of the plan (medication and care
 * actions such as measuring blood pressure). Its general copy must not frame
 * everything as treatment; medication wording belongs to the medication
 * branch only, and the irreversibility of a declaration stays explicit.
 */

const fr = getMessages('fr');
const ar = getMessages('ar');

// Medication-only vocabulary. Arabic: علاج (treatment), دواء (medicine), تناول (to take).
const MEDICATION_FR = /traitement|médicament|\bpris(e)?\b|comprimé|dose/i;
const MEDICATION_AR = /علاج|دواء|تناول/;
const ARABIC = /[؀-ۿ]/;

const FR_INTRO =
  'Consultez les actions prévues dans votre plan. Pour un rappel de médicament, vous pouvez déclarer une prise ; cette déclaration ne peut plus être modifiée ensuite.';
const AR_INTRO =
  'اطّلع على الإجراءات المقرّرة في خطتك. بالنسبة لتذكير بدواء، يمكنك التصريح بتناوله؛ لا يمكن تعديل هذا التصريح بعد ذلك.';

/** "General sentence. Medication clause." */
function splitIntro(intro: string): [string, string] {
  const end = intro.indexOf('. ');
  assert.ok(end > 0, `intro has no general sentence: ${intro}`);
  return [intro.slice(0, end + 1), intro.slice(end + 2)];
}

test('reminder page title and intro use the required neutral wording (FR + AR)', () => {
  assert.equal(fr.reminders.title, 'Mes rappels');
  assert.equal(fr.reminders.intro, FR_INTRO);
  assert.equal(ar.reminders.title, 'تذكيراتي');
  assert.equal(ar.reminders.intro, AR_INTRO);
  // Same wording as the plan's link to this page.
  assert.equal(fr.reminders.title, CARE_COPY.fr.plan.reminders);
  assert.equal(ar.reminders.title, CARE_COPY.ar.plan.reminders);
});

test('medication wording appears only in the medication clause of the intro, never in the heading', () => {
  assert.doesNotMatch(fr.reminders.title, MEDICATION_FR);
  assert.doesNotMatch(ar.reminders.title, MEDICATION_AR);
  assert.doesNotMatch(fr.reminders.intro, /traitement/i, 'no global "treatment" framing');
  assert.doesNotMatch(ar.reminders.intro, /علاج/);

  const [frGeneral, frMedication] = splitIntro(fr.reminders.intro);
  assert.doesNotMatch(frGeneral, MEDICATION_FR);
  assert.match(frGeneral, /plan/);
  assert.match(frMedication, /^Pour un rappel de médicament,/);

  const [arGeneral, arMedication] = splitIntro(ar.reminders.intro);
  assert.doesNotMatch(arGeneral, MEDICATION_AR);
  assert.match(arGeneral, /خطتك/);
  assert.match(arMedication, /^بالنسبة لتذكير بدواء،/);
});

test('the intro keeps the irreversibility of a declaration (FR + AR)', () => {
  assert.match(fr.reminders.intro, /déclaration ne peut plus être modifiée/);
  assert.match(ar.reminders.intro, /لا يمكن تعديل هذا التصريح/);
  // The confirmation step still says it, separately, in the medication branch.
  assert.match(fr.reminders.confirmQuestion, /définitive/);
  assert.match(ar.reminders.confirmQuestion, /نهائي/);
});

test('general empty states say there are no reminders, not no medication (FR + AR)', () => {
  for (const text of [fr.reminders.empty, fr.home.noReminders]) {
    assert.match(text, /rappel/i);
    assert.doesNotMatch(text, MEDICATION_FR);
  }
  for (const text of [ar.reminders.empty, ar.home.noReminders]) {
    assert.match(text, /تذكير/);
    assert.doesNotMatch(text, MEDICATION_AR);
  }
  const screen = readFileSync(join(process.cwd(), 'src', 'components', 'patient', 'RemindersScreen.tsx'), 'utf8');
  assert.match(screen, /<EmptyState icon="bell" title=\{careTeam\.status === "present" \? t\.reminders\.empty : t\.home\.noReminders\}/);
  assert.doesNotMatch(screen, /EmptyState icon="pill"/, 'a general empty list is not drawn as medication');
});

test('other general strings shown on the reminders page carry no medication-only wording', () => {
  const general = (t: typeof fr) => [
    t.nav.reminders,
    t.reminders.upcoming,
    t.reminders.past,
    t.reminders.due,
    t.reminders.deliveryLabel,
    ...Object.values(t.reminders.delivery),
    t.reminders.reportLabel,
    t.reminders.offlineList,
    t.reminders.unavailable,
  ];
  // readIsNotDone is branch-qualified on purpose: its general sentence is checked separately below.
  for (const text of [...general(fr), ASSIST_COPY.fr.reminders.planLink, ASSIST_COPY.fr.reminders.planActionLabel]) {
    assert.doesNotMatch(text, MEDICATION_FR, text);
  }
  for (const text of [...general(ar), ASSIST_COPY.ar.reminders.planLink, ASSIST_COPY.ar.reminders.planActionLabel]) {
    assert.doesNotMatch(text, MEDICATION_AR, text);
  }
});

test('the reading note qualifies declaration by branch: medication here, plan action in the plan (FR + AR)', () => {
  const frNote = ASSIST_COPY.fr.reminders.readIsNotDone;
  const arNote = ASSIST_COPY.ar.reminders.readIsNotDone;
  // No longer tells every reminder (a blood-pressure task included) to "declare it".
  assert.doesNotMatch(frNote, /déclarez-le explicitement/);
  assert.doesNotMatch(arNote, /صرّح بذلك صراحة/);

  // General sentence: reading is not doing, with no medication wording.
  const [frGeneral, frBranches] = splitIntro(frNote);
  assert.match(frGeneral, /^Lire un rappel ne le marque pas comme fait\.$/);
  assert.doesNotMatch(frGeneral, MEDICATION_FR);
  // Medication: declare the intake here. Plan action: follow the plan.
  assert.match(frBranches, /^Pour un médicament, déclarez la prise ici ;/);
  assert.match(frBranches, /pour une action du plan, suivez votre plan\.$/);

  const [arGeneral, arBranches] = splitIntro(arNote);
  assert.doesNotMatch(arGeneral, MEDICATION_AR);
  assert.match(arGeneral, /قراءة التذكير لا تعني إنجازه/);
  assert.match(arBranches, /^بالنسبة لدواء، صرّح هنا بتناوله؛/);
  assert.match(arBranches, /إجراء من الخطة، اتّبع خطتك\.$/);

  // Arabic is actually Arabic.
  assert.ok(ARABIC.test(arNote));
  assert.doesNotMatch(arNote, /[A-Za-zÀ-ÿ]{4,}/, 'untranslated Latin text in the Arabic note');
});

test('non-medication cards get a neutral "Action du plan" label, distinct from "Votre déclaration" (FR + AR)', () => {
  assert.equal(ASSIST_COPY.fr.reminders.planActionLabel, 'Action du plan');
  assert.equal(ASSIST_COPY.ar.reminders.planActionLabel, 'إجراء من الخطة');
  assert.ok(ARABIC.test(ASSIST_COPY.ar.reminders.planActionLabel));
  for (const lang of ['fr', 'ar'] as const) {
    const t = getMessages(lang);
    const label = ASSIST_COPY[lang].reminders.planActionLabel;
    // The medication label is unchanged and still distinct from the plan-action label.
    assert.notEqual(label, t.reminders.reportLabel, `${lang}: plan-action label reuses the declaration label`);
    assert.notEqual(label, ASSIST_COPY[lang].reminders.planLink, `${lang}: label and link say the same thing`);
  }
  assert.equal(fr.reminders.reportLabel, 'Votre déclaration');
  assert.equal(ar.reminders.reportLabel, 'تصريحك');
});

test('RemindersScreen: report label follows the medication mode; Pris / Pas pris and verbatim titles stay', () => {
  const screen = readFileSync(join(process.cwd(), 'src', 'components', 'patient', 'RemindersScreen.tsx'), 'utf8');
  // Same branch as the pill/clipboard icon: medication -> "Votre déclaration", otherwise -> "Action du plan".
  assert.match(
    screen,
    /const reportLabel =\s+display\.mode === "medication" \? t\.reminders\.reportLabel : ASSIST_COPY\[lang\]\.reminders\.planActionLabel;/,
  );
  assert.match(screen, /<p className=\{rem\.reportLabel\}>\{reportLabel\}<\/p>/);
  assert.doesNotMatch(
    screen,
    /<p className=\{rem\.reportLabel\}>\{t\.reminders\.reportLabel\}<\/p>/,
    'the declaration label is no longer shown on every card',
  );
  assert.match(screen, /<Icon name=\{display\.mode === "medication" \? "pill" : "clipboard"\} size=\{20\} \/>/);
  // Medication "Pris / Pas pris" controls are still there.
  assert.match(screen, /onClick=\{\(\) => setChoice\(true\)\}>\s+\{t\.reminders\.taken\}/);
  assert.match(screen, /onClick=\{\(\) => setChoice\(false\)\}>\s+\{t\.reminders\.notTaken\}/);
  // Server title verbatim, its own direction.
  assert.match(screen, /<h3 className=\{rem\.label\} dir="auto">\{reminder\.label\}<\/h3>/);
  // The global note is the branch-qualified one.
  assert.match(screen, /\{assist\.readIsNotDone\}/);
});

test('page heading, intro and server titles are rendered as given (no rewrite of reminder titles)', () => {
  const screen = readFileSync(join(process.cwd(), 'src', 'components', 'patient', 'RemindersScreen.tsx'), 'utf8');
  assert.match(screen, /title=\{t\.reminders\.title\}\s+description=\{t\.reminders\.intro\}/);
  // Verbatim server title; dir="auto" so an Arabic (or French) title keeps its own direction.
  assert.match(screen, /<h3 className=\{rem\.label\} dir="auto">\{reminder\.label\}<\/h3>/);
  // Pris / Pas pris only inside the medication self-report; care actions get their own report.
  assert.match(screen, /display\.mode === "medication" \? <SelfReport \{\.\.\.props\} \/> : <CareActionReport display=\{display\} \/>/);
});

test('branch-specific labels stay: medication "Pris / Pas pris", care action "À faire / faite", and they never overlap', () => {
  assert.equal(fr.reminders.taken, 'Pris');
  assert.equal(fr.reminders.notTaken, 'Pas pris');
  assert.equal(CARE_COPY.fr.actionState.pending, 'À faire');
  assert.match(CARE_COPY.fr.actionState.completed, /faite/);
  for (const lang of ['fr', 'ar'] as const) {
    const t = getMessages(lang);
    const medication = [t.reminders.taken, t.reminders.notTaken, t.reminders.confirmTaken, t.reminders.confirmNotTaken];
    const careAction = Object.values(CARE_COPY[lang].actionState);
    assert.equal(new Set(medication).size, medication.length, `${lang}: medication labels are distinct`);
    for (const label of careAction) assert.ok(!medication.includes(label), `${lang}: "${label}" is shared by both branches`);
    assert.notEqual(t.reminders.taken, t.reminders.notTaken);
  }
});

test('a blood-pressure task alone: neutral heading, plan link, never "Pris / Pas pris" (FR + AR)', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 12, hour)).toISOString();
  const action: CareAction = {
    id: 'bp',
    patientId: 'p1',
    planId: 'plan',
    revision: 1,
    proposalId: null,
    protocolId: null,
    originVersion: 1,
    action: { templateId: 'home.blood_pressure', templateVersion: 1, parameters: {} },
    dueAt: at(14),
    state: 'pending',
    reportedAt: null,
    clientId: 'c-bp',
    createdAt: at(1),
  };
  const reminder: Reminder = {
    id: 'r-bp',
    patientId: 'p1',
    label: 'Mesurer la tension selon le plan approuvé.',
    dueAt: at(14),
    acknowledgedAt: null,
    taken: null,
    delivery: 'sent',
    origin: { kind: 'care_action', actionId: 'bp', planId: 'plan', protocolId: null, originVersion: 1 },
  };
  for (const lang of ['fr', 'ar'] as const) {
    const t = getMessages(lang);
    const display = reminderDisplay(reminder, [action], lang);
    assert.deepEqual(display, { mode: 'plan_link', href: '/patient/plan', label: ASSIST_COPY[lang].reminders.planLink });
    assert.doesNotMatch(t.reminders.title, lang === 'fr' ? MEDICATION_FR : MEDICATION_AR);
  }
  // A reminder without an origin keeps the medication self-report.
  assert.deepEqual(reminderDisplay({}, [action], 'fr'), { mode: 'medication' });
});

test('a failed self-report says the declaration was not kept, never "the measurement" (FR + AR)', () => {
  // Same vocabulary as the report area ("Votre déclaration" / "تصريحك").
  assert.match(fr.reminders.noStorage, /déclaration/);
  assert.doesNotMatch(fr.reminders.noStorage, /mesure/i);
  assert.match(ar.reminders.noStorage, /تصريح/);
  assert.doesNotMatch(ar.reminders.noStorage, /قياس/);
  const screen = readFileSync(join(process.cwd(), 'src', 'components', 'patient', 'RemindersScreen.tsx'), 'utf8');
  assert.doesNotMatch(screen, /t\.measure\./, 'the reminders screen does not reuse measurement copy');
});

test('touched reminder keys: FR/AR parity, non-empty, Arabic is Arabic', () => {
  for (const key of ['title', 'intro', 'empty'] as const) {
    assert.equal(typeof fr.reminders[key], 'string');
    assert.equal(typeof ar.reminders[key], 'string');
    assert.ok(fr.reminders[key].trim().length > 0, `fr.reminders.${key} is empty`);
    assert.ok(ARABIC.test(ar.reminders[key]), `ar.reminders.${key} is not Arabic`);
    assert.doesNotMatch(ar.reminders[key], /[A-Za-zÀ-ÿ]{4,}/, `ar.reminders.${key} has untranslated Latin text`);
  }
  assert.ok(ARABIC.test(ar.home.noReminders));
});
