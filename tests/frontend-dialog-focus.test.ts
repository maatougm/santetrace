import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  fallbackTarget,
  focusWasLost,
  returnFocusAfterUnmount,
  type FocusTarget,
  type ReturnTargets,
} from '../src/components/ui/focus-return';

/**
 * A page reduced to what the focus rule reads: which node holds focus and which
 * nodes are still connected. Removing a focused node leaves focus on <body>, as
 * browsers do when a keyed or conditionally rendered <dialog> is unmounted.
 */
type FakeNode = { name: string; isConnected: boolean; focusCalls: number; focus(): void; remove(): void };

function page() {
  const state = { activeElement: null as FakeNode | null };
  const make = (name: string): FakeNode => {
    const node: FakeNode = {
      name,
      isConnected: true,
      focusCalls: 0,
      focus() {
        node.focusCalls += 1;
        if (node.isConnected) state.activeElement = node;
      },
      remove() {
        node.isConnected = false;
        if (state.activeElement === node) state.activeElement = body;
      },
    };
    return node;
  };
  const body = make('body');
  const documentElement = make('html');
  state.activeElement = body;
  const scope = {
    get activeElement() {
      return state.activeElement;
    },
    body,
    documentElement,
  };
  return { make, scope, state };
}

/** Deferred tasks run only when the test says so. */
function manualQueue() {
  const tasks: (() => void)[] = [];
  return { defer: (task: () => void) => void tasks.push(task), flush: () => tasks.splice(0).forEach((task) => task()) };
}

/** The Dialog's two refs, recorded at opening and read-and-cleared together. */
function openerSlot(opener: FocusTarget | null, fallback: FocusTarget | null = null) {
  const slot = { current: opener, fallback, taken: 0 };
  return {
    slot,
    take: (): ReturnTargets => {
      slot.taken += 1;
      const targets = { opener: slot.current, fallback: slot.fallback };
      slot.current = null;
      slot.fallback = null;
      return targets;
    },
  };
}

test('Escape on a keyed reason dialog: once React really removes it, focus returns to the button that opened it', () => {
  const { make, scope, state } = page();
  const reviewButton = make('Marquer le contexte comme revu');
  const dialog = make('dialog');
  const reason = make('Motif');
  reviewButton.focus();
  reason.focus();
  const { slot, take } = openerSlot(reviewButton);
  const queue = manualQueue();

  // Unmount (key "message-1" -> "none"): the node leaves the page, the browser drops focus on <body>.
  reason.remove();
  dialog.remove();
  assert.equal(state.activeElement?.name, 'body', 'the reproduced bug: focus lost to BODY');
  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  assert.equal(state.activeElement?.name, 'body', 'deferred: nothing happens inside the React cleanup itself');

  queue.flush();
  assert.equal(state.activeElement, reviewButton);
  assert.equal(slot.current, null, 'the opener is consumed once');
});

test("Strict Mode's simulated unmount keeps the node connected: focus stays in the dialog and the opener is kept for the real close", () => {
  const { make, scope, state } = page();
  const opener = make('Accuser réception');
  const dialog = make('dialog');
  const reason = make('Motif');
  reason.focus();
  const { slot, take } = openerSlot(opener);
  const queue = manualQueue();

  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, reason, 'focus is not pulled out of the open modal');
  assert.equal(opener.focusCalls, 0);
  assert.equal(slot.taken, 0, 'the opener is not consumed by a fake cleanup');
  assert.equal(slot.current, opener);
});

test('a dialog that opened meanwhile keeps its focus; a moved or removed opener is never focused', () => {
  const { make, scope, state } = page();
  const opener = make('Déclarer un contact');
  const closing = make('closing dialog');
  const next = make('field in the next dialog');
  const queue = manualQueue();

  closing.remove();
  next.focus();
  returnFocusAfterUnmount(closing, openerSlot(opener).take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, next, 'focus already in a newly active modal is not stolen');
  assert.equal(opener.focusCalls, 0);

  const gone = make('reviewed message button');
  const second = make('second dialog');
  second.remove();
  gone.remove();
  state.activeElement = scope.body;
  returnFocusAfterUnmount(second, openerSlot(gone).take, scope, queue.defer);
  queue.flush();
  assert.equal(gone.focusCalls, 0, 'an opener no longer in the page is not focused');

  const third = make('third dialog');
  third.remove();
  returnFocusAfterUnmount(third, openerSlot(null).take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, scope.body, 'already closed through `open`: no opener left, nothing to do');
});

test('focus counts as lost only on <body>, <html>, nothing, or a node that left the page', () => {
  const { make, scope, state } = page();
  const live = make('live');
  const removed = make('removed');
  removed.remove();
  for (const [active, lost] of [
    [null, true],
    [scope.body, true],
    [scope.documentElement, true],
    [removed, true],
    [live, false],
  ] as const) {
    state.activeElement = active;
    assert.equal(focusWasLost(scope), lost, active?.name ?? 'null');
  }
});

test('the default deferral is one microtask: after the synchronous effect flush, before any timer', async () => {
  const { make, scope, state } = page();
  const opener = make('opener');
  const dialog = make('dialog');
  dialog.remove();
  returnFocusAfterUnmount(dialog, openerSlot(opener).take, scope);
  assert.equal(state.activeElement, scope.body);
  await Promise.resolve();
  assert.equal(state.activeElement, opener);
});

test('static: the shared Dialog runs the unmount rule from a mount-only effect, with the node captured at mount', () => {
  const dialogSource = readFileSync(join(process.cwd(), 'src', 'components', 'ui', 'Dialog.tsx'), 'utf8');
  const effect = dialogSource.slice(dialogSource.indexOf('const dialog = dialogRef.current;\n    if (!dialog) return undefined;'));
  assert.ok(effect.length > 0, 'node captured in the effect body, not read from the ref during cleanup');
  const end = effect.indexOf('}, []);');
  assert.ok(end > 0, 'mount-only effect: toggling `open` never triggers it');
  assert.match(effect.slice(0, end), /return \(\) =>\s*returnFocusAfterUnmount\(\s*dialog,/);
  // The existing close path, busy veto and native close re-sync stay as they were.
  assert.match(dialogSource, /function handleCancel\(event: SyntheticEvent<HTMLDialogElement>\) \{\s*event\.preventDefault\(\);\s*onCloseRef\.current\(\);/);
  assert.match(dialogSource, /onCloseRef\.current\(\);\s*setSyncTick\(\(tick\) => tick \+ 1\);/);
});

// ---------------------------------------------------------------------------
// Confirmed message review: the opener leaves the page with the dialog
// ---------------------------------------------------------------------------

/**
 * The post-submit case: confirming the review applies the reviewed message
 * (canReviewMessage turns false, its button is removed) and resets the dialog
 * key in the same commit. Only the same keyed message <li> survives; it was
 * captured as the stand-in when the dialog opened from its button.
 */
function confirmedReview() {
  const { make, scope, state } = page();
  const message = make('message <li> (data-message-review-focus-return, tabIndex -1)');
  const reviewButton = make('Marquer le contexte comme revu');
  const dialog = make('dialog');
  const confirm = make('Marquer comme revu');
  reviewButton.focus();
  const { slot, take } = openerSlot(reviewButton, message);
  confirm.focus();
  const commit = () => {
    confirm.remove();
    dialog.remove();
    reviewButton.remove();
  };
  return { make, scope, state, message, reviewButton, dialog, confirm, slot, take, queue: manualQueue(), commit };
}

test('confirmed message review: the review button leaves with the dialog, focus goes to the same message captured at opening', () => {
  const { scope, state, message, reviewButton, dialog, slot, take, queue, commit } = confirmedReview();
  commit();
  assert.equal(state.activeElement, scope.body, 'the reproduced bug: focus lost to BODY');
  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  assert.equal(state.activeElement, scope.body, 'deferred: nothing happens inside the React cleanup itself');

  queue.flush();
  assert.equal(state.activeElement, message);
  assert.equal(message.focusCalls, 1);
  assert.equal(reviewButton.focusCalls, 1, 'only the focus that opened the dialog: the removed opener is not focused again');
  assert.deepEqual([slot.current, slot.fallback, slot.taken], [null, null, 1], 'both targets consumed once');
});

test('a captured message that left the page (actor or patient switched) is never focused, nor a look-alike rendered afterwards', () => {
  const { make, scope, state, message, dialog, take, queue, commit } = confirmedReview();
  commit();
  message.remove();
  const lookAlike = make('marked message in the new actor/patient thread');
  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, scope.body, 'focus stays lost rather than landing in another context');
  assert.equal(message.focusCalls, 0);
  assert.equal(lookAlike.focusCalls, 0, 'no lookup after the close: only the node captured at opening can be focused');
});

test('Escape / Annuler: the opener is still in the page and keeps priority over the stand-in', () => {
  const { scope, state, message, reviewButton, dialog, confirm, take, queue } = confirmedReview();
  confirm.remove();
  dialog.remove();
  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, reviewButton);
  assert.equal(message.focusCalls, 0);
});

test('the stand-in never takes focus from a live element or a modal opened meanwhile', () => {
  const { make, scope, state, message, dialog, take, queue, commit } = confirmedReview();
  commit();
  const nextField = make('field in the next modal');
  nextField.focus();
  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, nextField);
  assert.equal(message.focusCalls, 0);
});

test("Strict Mode's simulated unmount: the stand-in is neither focused nor consumed", () => {
  const { scope, state, message, dialog, confirm, slot, take, queue } = confirmedReview();
  returnFocusAfterUnmount(dialog, take, scope, queue.defer);
  queue.flush();
  assert.equal(state.activeElement, confirm, 'focus stays in the open modal');
  assert.equal(message.focusCalls, 0);
  assert.equal(slot.taken, 0);
  assert.equal(slot.fallback, message, 'still recorded for the real close');
});

test('fallbackTarget (shared by close and unmount): only for a gone opener, while focus is lost, if the stand-in is still in the page', () => {
  const { make, scope, state } = page();
  const opener = make('opener');
  const fallback = make('message');
  const gone = make('removed');
  gone.remove();
  for (const active of [null, scope.body, scope.documentElement, gone]) {
    state.activeElement = active;
    const label = active?.name ?? 'null';
    assert.equal(fallbackTarget({ opener: gone, fallback }, scope), fallback, label);
    assert.equal(fallbackTarget({ opener: null, fallback }, scope), fallback, label);
    assert.equal(fallbackTarget({ opener, fallback }, scope), null, `${label}: a connected opener keeps priority`);
    assert.equal(fallbackTarget({ opener: gone, fallback: null }, scope), null, `${label}: not opted in`);
    assert.equal(fallbackTarget({ opener: gone, fallback: gone }, scope), null, `${label}: stand-in left the page`);
  }
  state.activeElement = make('live');
  assert.equal(fallbackTarget({ opener: gone, fallback }, scope), null, 'live focus is never taken');
  assert.equal(fallback.focusCalls, 0, 'picks only, never focuses');
});

/** Repo-relative paths of the source files containing `pattern`. */
function sourcesMatching(pattern: RegExp): string[] {
  const root = join(process.cwd(), 'src');
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file) && pattern.test(readFileSync(join(root, file), 'utf8')))
    .map((file) => `src/${file}`)
    .sort();
}

test('static: the stand-in is captured with the opener at opening, only through the opt-in prop, and only the message review opts in', () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');
  const dialog = read('components', 'ui', 'Dialog.tsx');
  assert.match(
    dialog,
    /if \(open && !dialog\.open\) \{\s*if \(openerRef\.current === null\) \{\s*const active = document\.activeElement;\s*openerRef\.current = active instanceof HTMLElement \? active : null;\s*fallbackRef\.current = openerRef\.current \? \(captureFallbackRef\.current\?\.\(openerRef\.current\) \?\? null\) : null;\s*\}\s*dialog\.showModal\(\);/,
    'captured from the recorded opener, in the opening branch, before showModal',
  );
  assert.equal(dialog.match(/captureFallbackRef\.current\?\.\(/g)?.length, 1, 'the capture runs nowhere else: no lookup after the close');
  assert.doesNotMatch(dialog, /closest\(/, 'the generic Dialog never guesses a stand-in');
  assert.match(
    dialog,
    /if \(opener && opener\.isConnected\) \{\s*opener\.focus\(\);\s*\} else \{\s*fallbackTarget\(\{ opener, fallback \}, document\)\?\.focus\(\);\s*\}/,
    'open=false: a connected opener first, as before; the stand-in only through the shared rule',
  );
  assert.match(
    dialog,
    /const targets = \{ opener: openerRef\.current, fallback: fallbackRef\.current \};\s*openerRef\.current = null;\s*fallbackRef\.current = null;\s*return targets;/,
    'unmount: both targets read and cleared together',
  );

  assert.deepEqual(sourcesMatching(/returnFocusFallback=\{/), ['src/components/doctor/comms/ReasonDialog.tsx'], 'every other Dialog is unchanged');
  const reason = read('components', 'doctor', 'comms', 'ReasonDialog.tsx');
  assert.match(reason, /returnFocusFallback=\{messageReviewFocusFallback\}/);
  assert.match(reason, /const close = \(\) => \{\s*if \(!submitting\) onClose\(\);\s*\};/, 'busy veto unchanged');
  assert.match(reason, /const \[reason, setReason\] = useState\(""\);/, 'reason still starts empty per keyed target');
  assert.match(reason, /<TextArea\s+\{\.\.\.UNKNOWN_LANGUAGE_TEXT\}/);

  const item = read('components', 'doctor', 'comms', 'MessageItem.tsx');
  assert.match(item, /const REVIEW_FOCUS_RETURN = "\[data-message-review-focus-return\]";/);
  assert.match(item, /return opener\.closest<HTMLElement>\(REVIEW_FOCUS_RETURN\);/, 'only the narrowly named marker, never any <li>');
  assert.deepEqual(sourcesMatching(/data-message-review-focus-return/), ['src/components/doctor/comms/MessageItem.tsx']);
  assert.match(
    item,
    /<li className=\{status\.mine \? `\$\{styles\.message\} \$\{styles\.mine\}` : styles\.message\} data-message-review-focus-return tabIndex=\{-1\}>/,
    'marker and tabIndex -1 unconditional: the <li> stays focusable once reviewed, never a tab stop',
  );
  const li = item.slice(item.indexOf('<li '), item.indexOf('</li>'));
  assert.match(li, /onClick=\{\(\) => onReview\(message\)\}/, 'the review button sits inside the marked <li>');
  assert.match(item, /<p className=\{styles\.messageText\} \{\.\.\.UNKNOWN_LANGUAGE_TEXT\}>/);
});
