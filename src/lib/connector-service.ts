import { randomBytes } from "node:crypto";
import type { Actor } from "../contracts/care";
import type { Connector, ConnectorEvent, MeasurementReceipt } from "../contracts/monitoring";
import { careId, type CareState, type CareStoreAdapter } from "./care-store";
import { ingestReading } from "./care-service";
import { boundedText, canonical, fail, hash, integer, replay } from "./monitoring-utils";
import { journalAccess, requirePatientCapability, resolvePatientAccess } from "./patient-access-service";

type PublicConnector = Omit<Connector, "credentialHash">;
type PairInput = { deviceId: string; kind: "simulator" | "device"; clientId: string };
type RevokeInput = { action: "revoke"; expectedRevision: number; clientId: string };
function publicConnector(connector: Connector): PublicConnector {
  const { credentialHash: _secret, ...visible } = connector;
  return structuredClone(visible);
}
function onlyKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) fail("INVALID_INPUT");
}
function validateEvent(input: ConnectorEvent): ConnectorEvent {
  onlyKeys(input, ["externalEventId", "measuredAt", "reading", "quality"]);
  const externalEventId = boundedText(input.externalEventId, 128);
  if (input.quality !== "accepted" && input.quality !== "suspect") fail("INVALID_INPUT");
  const reading = input.reading;
  onlyKeys(reading, reading?.kind === "blood_pressure" ? ["kind", "systolic", "diastolic", "unit"] : ["kind", "value", "unit"]);
  // Numeric/unit/time validation stays in the one shared ingestion path.
  return { externalEventId, measuredAt: input.measuredAt, quality: input.quality, reading: structuredClone(reading) };
}
function currentBinding(state: CareState, connectorId: string): Connector {
  const connector = state.connectors.find(item => item.id === connectorId);
  if (!connector?.enabled || !state.patients.some(patient => patient.id === connector.patientId && patient.consent)
    || !state.accounts.some(account => account.role === "patient" && account.patientId === connector.patientId && account.enabled)) {
    fail("CONNECTOR_UNAVAILABLE", "Connecteur indisponible.", 404);
  }
  return connector;
}

export class ConnectorService {
  constructor(public store: CareStoreAdapter, private clock = () => Date.now()) {}

  list(actor: Actor, patientId: string): { connectors: PublicConnector[] } {
    const state = this.store.read();
    if (!resolvePatientAccess(state, actor, patientId).owner) fail("FORBIDDEN", "Accès propriétaire requis.", 403);
    return { connectors: state.connectors.filter(item => item.patientId === patientId).map(publicConnector) };
  }

  pairSimulator(actor: Actor, patientId: string, input: { deviceId: string; kind?: "simulator"; clientId: string }) {
    onlyKeys(input, ["deviceId", "kind", "clientId"]);
    if (input.kind !== undefined && input.kind !== "simulator") fail("INVALID_INPUT");
    return this.pair(actor, patientId, { ...input, kind: "simulator" });
  }

  pair(actor: Actor, patientId: string, input: PairInput): { connector: PublicConnector; credential: string | null } {
    onlyKeys(input, ["deviceId", "kind", "clientId"]);
    const deviceId = boundedText(input.deviceId, 100), clientId = boundedText(input.clientId, 128);
    if (input.kind !== "simulator" && input.kind !== "device") fail("INVALID_INPUT");
    const normalized = { deviceId, kind: input.kind, clientId };
    return this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "owner");
      const key = JSON.stringify([actor.id, "connector_pair", patientId, clientId]), digest = hash(canonical(normalized));
      const old = state.idempotency[key];
      if (old) {
        if (old.hash !== digest) fail("IDEMPOTENCY_CONFLICT", "Identifiant déjà utilisé.", 409);
        const connector = state.connectors.find(item => item.id === (old.result as { connectorId: string }).connectorId);
        if (!connector || connector.patientId !== patientId) fail("CONNECTOR_UNAVAILABLE", "Connecteur indisponible.", 404);
        return { connector: publicConnector(connector), credential: null };
      }
      if (state.connectors.some(item => item.patientId === patientId && item.deviceId === deviceId && item.enabled)) {
        fail("CONNECTOR_CONFLICT", "Appareil déjà associé.", 409);
      }
      const credential = randomBytes(32).toString("base64url");
      const connector: Connector = { id: careId(), patientId, deviceId, kind: input.kind,
        credentialHash: hash(credential), enabled: true, revision: 1, createdAt: new Date(this.clock()).toISOString() };
      state.connectors.push(connector);
      state.idempotency[key] = { hash: digest, result: { connectorId: connector.id } };
      journalAccess(state, actor, patientId, "pair_connector", "connector", connector.id, "allowed");
      return { connector: publicConnector(connector), credential };
    });
  }

  revoke(actor: Actor, id: string, input: RevokeInput): { connector: PublicConnector } {
    onlyKeys(input, ["action", "expectedRevision", "clientId"]);
    const clientId = boundedText(input.clientId, 128), revision = integer(input.expectedRevision, 1);
    if (input.action !== "revoke") fail("INVALID_INPUT");
    return this.store.transaction(state => {
      const connector = state.connectors.find(item => item.id === id);
      if (!connector) fail("CONNECTOR_UNAVAILABLE", "Connecteur indisponible.", 404);
      if (!resolvePatientAccess(state, actor, connector.patientId).owner) fail("FORBIDDEN", "Accès propriétaire requis.", 403);
      return replay(state, JSON.stringify([actor.id, "connector_revoke", id, clientId]), input, () => {
        if (connector.revision !== revision) fail("STALE_REVISION", "Le connecteur a changé.", 409);
        connector.enabled = false; connector.revision++;
        journalAccess(state, actor, connector.patientId, "revoke_connector", "connector", id, "allowed");
        return { connector: publicConnector(connector) };
      });
    });
  }

  private capture(state: CareState, connector: Connector, input: ConnectorEvent): MeasurementReceipt {
    // Binding/consent are checked by callers before this replay can release a receipt.
    return replay(state, JSON.stringify(["connector_event", connector.id, input.externalEventId]), input, () => {
      const result = ingestReading(state, connector.patientId, { ...input.reading, measuredAt: input.measuredAt, clientId: input.externalEventId },
        connector.kind === "simulator" ? "simulated" : "device", { connectorId: connector.id, deviceId: connector.deviceId,
          externalEventId: input.externalEventId, simulated: connector.kind === "simulator", quality: input.quality }, new Date(this.clock()).toISOString());
      return { measurement: result.measurement, alert: result.alert, monitoring: result.monitoring };
    });
  }

  ingest(credential: string, input: ConnectorEvent): MeasurementReceipt {
    if (typeof credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(credential)) fail("CONNECTOR_UNAVAILABLE", "Connecteur indisponible.", 404);
    const event = validateEvent(input);
    return this.store.transaction(state => {
      const candidate = state.connectors.find(item => item.credentialHash === hash(credential));
      if (!candidate) fail("CONNECTOR_UNAVAILABLE", "Connecteur indisponible.", 404);
      return this.capture(state, currentBinding(state, candidate.id), event);
    });
  }

  simulate(actor: Actor, patientId: string, connectorId: string, input: ConnectorEvent): MeasurementReceipt {
    const event = validateEvent(input);
    return this.store.transaction(state => {
      requirePatientCapability(state, actor, patientId, "owner");
      const connector = currentBinding(state, connectorId);
      if (connector.patientId !== patientId || connector.kind !== "simulator") fail("CONNECTOR_UNAVAILABLE", "Connecteur indisponible.", 404);
      return this.capture(state, connector, event);
    });
  }
}
