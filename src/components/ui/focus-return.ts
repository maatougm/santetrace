/**
 * Focus return for a modal that unmounts while open. Keyed or conditionally
 * rendered dialogs (`key={target.id}`, `{open && <Dialog open />}`) never go
 * through `open = false`: the browser removes the focused node and leaves
 * focus on <body>. Kept DOM-free so the rule is testable without a browser.
 */

interface Connected {
  readonly isConnected: boolean;
}

export interface FocusTarget extends Connected {
  focus(): void;
}

export interface FocusScope {
  readonly activeElement: Connected | null;
  readonly body: Connected | null;
  readonly documentElement: Connected | null;
}

/** Where focus may go back once the dialog is gone, both recorded when it opened. */
export interface ReturnTargets {
  readonly opener: FocusTarget | null;
  /**
   * Explicit opt-in stand-in, captured from the opener at opening (never looked
   * up after the close), for an opener the dialog's own action removes, e.g. a
   * review button that disappears once the review is recorded.
   */
  readonly fallback: FocusTarget | null;
}

/** Focus is lost when nothing live holds it: no element, <body>, <html>, or a node that left the page. */
export function focusWasLost(scope: FocusScope): boolean {
  const active = scope.activeElement;
  return active === null || active === scope.body || active === scope.documentElement || !active.isConnected;
}

/**
 * The stand-in, only when the opener has left the page, focus was lost and the
 * stand-in itself is still in the page; otherwise null (nothing to focus).
 */
export function fallbackTarget({ opener, fallback }: ReturnTargets, scope: FocusScope): FocusTarget | null {
  if (opener?.isConnected || !fallback?.isConnected) return null;
  return focusWasLost(scope) ? fallback : null;
}

/**
 * Called from the dialog's unmount cleanup, deferred one microtask (after the
 * whole effect flush):
 * - node still connected: not a real unmount (Strict Mode's simulated
 *   unmount, Fast Refresh, a hidden Activity), nothing changes and the
 *   targets stay recorded;
 * - focus held by something live (a dialog opened meanwhile, or moved on
 *   purpose by the app): left alone;
 * - otherwise the opener gets focus back, only if it is still in the page;
 *   failing that, the opted-in stand-in, only if it is still in the page.
 */
export function returnFocusAfterUnmount(
  node: Connected,
  takeTargets: () => ReturnTargets,
  scope: FocusScope,
  defer: (task: () => void) => void = queueMicrotask,
): void {
  defer(() => {
    if (node.isConnected) return;
    const targets = takeTargets();
    if (targets.opener?.isConnected && focusWasLost(scope)) targets.opener.focus();
    else fallbackTarget(targets, scope)?.focus();
  });
}
