/**
 * Technical facts shown in the real-device setup guide, kept out of the
 * translated copy so both languages show the identical tokens. They mirror the
 * server's ingest route (src/lib/monitoring-http.ts): POST /api/connectors/events,
 * credential in `Authorization: Bearer <43-char base64url>`, body = ConnectorEvent.
 * The guide shows a placeholder, never a real credential.
 */
import type { ConnectorEvent } from "@/contracts/monitoring";

export const INGEST_METHOD = "POST";
export const INGEST_PATH = "/api/connectors/events";
export const CREDENTIAL_HEADER = "Authorization";
export const CREDENTIAL_SCHEME = "Bearer";
export const CREDENTIAL_PLACEHOLDER = "<secret>";
export const INSECURE_TLS_CALL = "setInsecure()";

/** "POST /api/connectors/events" */
export const INGEST_REQUEST_LINE = `${INGEST_METHOD} ${INGEST_PATH}`;

/** "Authorization: Bearer <secret>": the placeholder only, by construction. */
export const CREDENTIAL_HEADER_LINE = `${CREDENTIAL_HEADER}: ${CREDENTIAL_SCHEME} ${CREDENTIAL_PLACEHOLDER}`;

/** Fictional example, typed against the shared contract so it cannot drift. */
const EXAMPLE: ConnectorEvent = {
  externalEventId: "contour-000123",
  measuredAt: "2026-10-11T07:45:00.000Z",
  reading: { kind: "glucose", value: 112, unit: "mg/dL" },
  quality: "accepted",
};

export const EXAMPLE_EVENT: Readonly<ConnectorEvent> = Object.freeze(EXAMPLE);

export const EXAMPLE_EVENT_JSON = JSON.stringify(EXAMPLE_EVENT, null, 2);
