/**
 * The one-time connector credential, held in component memory only: never in
 * storage, logs, a URL, an href or the patient runtime context. Pure so the
 * clearing rules are testable without React.
 *
 * - Masked by default; revealed only by an explicit toggle.
 * - Bound to the server's connector ID (never the reusable device name).
 * - Wiped by the explicit acknowledgement, a fence epoch move (revocation,
 *   authority change), an access denial, a change of patient/fence key, or a
 *   confirmed (current, fenced) revoke of THAT connector ID: a revoked
 *   binding's secret must not stay on screen, while a late revoke of an older
 *   or different binding (even one with the same device name) never erases a
 *   newer binding's only secret. A stale or failed revoke changes nothing here.
 * - A pairing that completed after the fence moved ("stale") never yields one.
 * - Replay (credential null) carries no secret and cannot be revealed.
 */
import type { FencedResult } from "@/lib/client/access-fence";
import type { ConnectorKind, PairResult } from "@/lib/client/devices-api";

/** The access context a credential was issued under. */
export interface CredentialScope {
  readonly patientId: string;
  readonly fenceKey: string | null;
  readonly epoch: number;
}

export interface ShownCredential {
  readonly status: "shown";
  /** Server connector ID of the binding this secret belongs to. */
  readonly connectorId: string;
  readonly kind: ConnectorKind;
  readonly deviceId: string;
  /** null: idempotent replay, the secret is no longer available. */
  readonly credential: string | null;
  readonly revealed: boolean;
  readonly scope: CredentialScope;
}

export type CredentialState = { readonly status: "none" } | ShownCredential;

export type PairedAction = {
  type: "paired";
  connectorId: string;
  kind: ConnectorKind;
  deviceId: string;
  credential: string | null;
  scope: CredentialScope;
};

export type CredentialAction =
  | PairedAction
  | { type: "toggle_reveal" }
  | { type: "acknowledge" }
  | { type: "fence_moved" }
  | { type: "access_denied" }
  /** Dispatched only for a CURRENT fenced revoke result (see RevokeDialog), with the server's connector ID. */
  | { type: "connector_revoked"; connectorId: string }
  | { type: "scope_changed"; scope: CredentialScope };

export const NO_CREDENTIAL: CredentialState = Object.freeze({ status: "none" as const });

export function sameScope(a: CredentialScope, b: CredentialScope): boolean {
  return a.patientId === b.patientId && a.fenceKey === b.fenceKey && a.epoch === b.epoch;
}

export function credentialReducer(state: CredentialState, action: CredentialAction): CredentialState {
  switch (action.type) {
    case "paired":
      return {
        status: "shown",
        connectorId: action.connectorId,
        kind: action.kind,
        deviceId: action.deviceId,
        credential: action.credential,
        revealed: false,
        scope: action.scope,
      };
    case "toggle_reveal":
      return state.status === "shown" && state.credential !== null ? { ...state, revealed: !state.revealed } : state;
    case "scope_changed":
      return state.status === "shown" && !sameScope(state.scope, action.scope) ? NO_CREDENTIAL : state;
    case "connector_revoked":
      return state.status === "shown" && state.connectorId === action.connectorId ? NO_CREDENTIAL : state;
    case "acknowledge":
    case "fence_moved":
    case "access_denied":
      return NO_CREDENTIAL;
  }
}

/**
 * Render guard: a credential is visible only under the scope it was issued
 * for, so nothing from a previous patient, fence or epoch is drawn even in
 * the render before the wipe lands.
 */
export function visibleCredential(state: CredentialState, scope: CredentialScope): ShownCredential | null {
  return state.status === "shown" && sameScope(state.scope, scope) ? state : null;
}

/**
 * Only a current fenced pairing becomes a "paired" action. The connector ID,
 * kind and device name come from the server's binding, not from the request.
 * Without a server connector ID the secret could not be matched to a later
 * revoke, so nothing is shown (fail closed; the patient can pair again).
 */
export function pairedAction(result: FencedResult<PairResult>, scope: CredentialScope): PairedAction | null {
  if (result.status !== "current") return null;
  const { connector, credential } = result.value;
  if (typeof connector.id !== "string" || connector.id.length === 0) return null;
  return {
    type: "paired",
    connectorId: connector.id,
    kind: connector.kind,
    deviceId: connector.deviceId,
    credential: typeof credential === "string" && credential.length > 0 ? credential : null,
    scope,
  };
}
