/**
 * Explicit pairing: one request per submit, never automatic. Each kind has its
 * own call (simulator or real device); the idempotency key survives a retry of
 * the same kind and name only.
 */
import { pairDevice, pairSimulator, type ConnectorKind, type PairResult } from "@/lib/client/devices-api";
import type { RequestOptions } from "@/lib/client/transport";

export interface PairAttempt {
  readonly kind: ConnectorKind;
  readonly deviceId: string;
  readonly clientId: string;
}

type PairCall = (patientId: string, input: { deviceId: string; clientId: string }, options?: RequestOptions) => Promise<PairResult>;

export const PAIR_REQUEST: Readonly<Record<ConnectorKind, PairCall>> = Object.freeze({
  simulator: pairSimulator,
  device: pairDevice,
});

export const CLIENT_ID_PREFIX: Readonly<Record<ConnectorKind, string>> = Object.freeze({
  simulator: "pair",
  device: "pair-device",
});

/** Same kind and device name retried after a failure keeps its key; anything else gets a new one. */
export function pairAttempt(previous: PairAttempt | null, kind: ConnectorKind, deviceId: string, makeId: () => string): PairAttempt {
  if (previous && previous.kind === kind && previous.deviceId === deviceId) return previous;
  return { kind, deviceId, clientId: makeId() };
}
