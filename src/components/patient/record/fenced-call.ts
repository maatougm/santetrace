/**
 * `runFenced` plus error handling for one-shot patient calls. A result or an
 * error that comes back after the access fence moved (revocation, authority
 * change) or after an abort is "stale": the caller shows nothing from it.
 * `answered` tells whether the server did answer successfully (a mutation
 * then happened even though its answer is withheld), so the caller can word
 * the follow-up honestly.
 */
import { runFenced, type AccessFence } from "@/lib/client/access-fence";
import { toApiError, type ApiError } from "@/lib/client/transport";

export type FencedCall<T> =
  | { status: "current"; value: T }
  | { status: "stale"; answered: boolean }
  | { status: "error"; error: ApiError };

export async function fencedCall<T>(
  fence: AccessFence,
  work: () => Promise<T>,
  revisionOf?: (value: T) => number | null | undefined,
): Promise<FencedCall<T>> {
  const started = fence.epoch();
  let answered = false;
  try {
    const result = await runFenced(
      fence,
      async () => {
        const value = await work();
        answered = true;
        return value;
      },
      revisionOf,
    );
    return result.status === "current" ? result : { status: "stale", answered };
  } catch (caught) {
    const error = toApiError(caught);
    if (error.isAborted || !fence.isCurrent(started)) return { status: "stale", answered: false };
    return { status: "error", error };
  }
}

/**
 * What one user action may touch: the fence of the actor/patient on screen when
 * it started, and that actor's record callbacks (`mutate` is bound to the same
 * fence by usePatientRecord). Captured once, at the start of the action, and
 * used for everything after the first await: after an account or patient
 * switch the fence is retired, so nothing from the held answer lands anywhere.
 */
export interface ActionScope<R> {
  fence: AccessFence;
  mutate: (updater: (current: R) => R) => void;
  refresh: () => Promise<void>;
}

export function captureAction<R>(data: ActionScope<R>): ActionScope<R> {
  return { fence: data.fence, mutate: data.mutate, refresh: data.refresh };
}

/**
 * Runs a mutation under the action's fence and, only when its answer is
 * current, echoes it into that action's record and asks for a fresh read.
 */
export async function runAction<T, R>(
  scope: ActionScope<R>,
  work: () => Promise<T>,
  toUpdate: (value: T) => (current: R) => R,
  revisionOf?: (value: T) => number | null | undefined,
): Promise<FencedCall<T>> {
  const result = await fencedCall(scope.fence, work, revisionOf);
  if (result.status === "current") {
    scope.mutate(toUpdate(result.value));
    void scope.refresh();
  }
  return result;
}
