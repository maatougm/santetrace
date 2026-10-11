/**
 * Connector bindings and the explicit simulator (feature 006, lot D2). The
 * server resolves patient and simulation identity from the binding; a client
 * never claims a reading is real. Credentials are shown once (null on replay).
 */
import type { Connector, ConnectorEvent, MeasurementReceipt, ReadingInput } from "@/contracts/monitoring";
import { request, seg, type RequestOptions } from "./transport";

export type { ConnectorEvent, MeasurementReceipt, ReadingInput };

/** What the API returns for a binding: never the credential hash. */
export type ConnectorView = Omit<Connector, "credentialHash">;

/** "simulator" (demo readings sent from this app) or "device" (a real device posting its own events). */
export type ConnectorKind = ConnectorView["kind"];

export interface PairResult {
  connector: ConnectorView;
  /** Shown once; null on replay. Never stored by the client. */
  credential: string | null;
}

const connectorsPath = (patientId: string) => `/patients/${seg(patientId)}/connectors`;

export function listConnectors(patientId: string, options?: RequestOptions): Promise<{ connectors: ConnectorView[] }> {
  return request<{ connectors: ConnectorView[] }>(connectorsPath(patientId), { ...options, expect: ["connectors"] });
}

export function pairSimulator(
  patientId: string,
  input: { deviceId: string; clientId: string },
  options?: RequestOptions,
): Promise<PairResult> {
  return request<PairResult>(connectorsPath(patientId), {
    ...options,
    method: "POST",
    json: { deviceId: input.deviceId, kind: "simulator", clientId: input.clientId },
    expect: ["connector", "credential"],
  });
}

/**
 * Binds a real device: the server records a binding and returns a one-time
 * credential (null on an idempotent replay). This is NOT a Bluetooth or
 * physical connection; readings exist only once the device itself posts
 * events to /api/connectors/events with that credential.
 */
export function pairDevice(
  patientId: string,
  input: { deviceId: string; clientId: string },
  options?: RequestOptions,
): Promise<PairResult> {
  return request<PairResult>(connectorsPath(patientId), {
    ...options,
    method: "POST",
    json: { deviceId: input.deviceId, kind: "device", clientId: input.clientId },
    expect: ["connector", "credential"],
  });
}

export function revokeConnector(
  connectorId: string,
  input: { expectedRevision: number; clientId: string },
  options?: RequestOptions,
): Promise<{ connector: ConnectorView }> {
  return request<{ connector: ConnectorView }>(`/connectors/${seg(connectorId)}`, {
    ...options,
    method: "PATCH",
    json: { action: "revoke", ...input },
    expect: ["connector"],
  });
}

/**
 * Sends one simulated reading. Reuse the same externalEventId to retransmit:
 * the server deduplicates and the reading stays labelled simulated.
 */
export function sendSimulatedReading(
  patientId: string,
  connectorId: string,
  event: ConnectorEvent,
  options?: RequestOptions,
): Promise<MeasurementReceipt> {
  return request<MeasurementReceipt>(`${connectorsPath(patientId)}/${seg(connectorId)}/simulate`, {
    ...options,
    method: "POST",
    json: event,
    expect: ["measurement", "monitoring"],
  });
}

/** Demo input sanity bounds (not alert thresholds). */
export const SIMULATOR_LIMITS = {
  systolic: { min: 60, max: 260 },
  diastolic: { min: 30, max: 160 },
  glucoseMgDl: { min: 20, max: 600 },
  glucoseMmol: { min: 1, max: 33 },
  pulse: { min: 1, max: 300 },
} as const;
