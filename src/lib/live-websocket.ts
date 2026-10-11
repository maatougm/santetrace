import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type { Actor } from "../contracts/care";
import type { CareState, CareStoreAdapter } from "./care-store";
import { SESSION_COOKIE, verifySession } from "./care-session";
import { hasScope, projectPatientRecord, resolvePatientAccess } from "./patient-access-service";
import { currentAiCaseScore } from "./ai-case-score";
import { configuredGenerationIdentity } from "./generation-identity";

export const LIVE_PATH = "/api/live";
export const LIVE_AUTH_CLOSE = 4401;
const MAX_CONNECTIONS = 256;
const MAX_ACTOR_CONNECTIONS = 6;
const MAX_BUFFERED_BYTES = 65_536;

export function liveCookieToken(cookie: string | undefined): string | undefined {
  const cookies = cookie?.split(";").map(value => value.trim()).filter(value => value.startsWith(`${SESSION_COOKIE}=`)) ?? [];
  return cookies.length === 1 ? cookies[0].slice(SESSION_COOKIE.length + 1) : undefined;
}

/** Authority comes from deployment configuration, never Host/forwarded headers. */
export function liveOriginAllowed(origin: string | undefined, expectedOrigin: string): boolean {
  try { return !!origin && new URL(origin).origin === origin && origin === new URL(expectedOrigin).origin; }
  catch { return false; }
}

function digest(value: unknown): string {
  // GET projections recompute these read-time stamps. They are not a clinical change.
  return createHash("sha256").update(JSON.stringify(value, (key, item) => key === "checkedAt" || key === "evaluatedAt" ? undefined : item)).digest("hex");
}

/** Only data the actor may currently retrieve influences notifications. Hashes never leave the server. */
export function liveFingerprint(state: CareState, actor: Actor, now = new Date().toISOString()): string {
  const records = state.patients.flatMap(patient => {
    if (!patient.consent) return [];
    try {
      const access = resolvePatientAccess(state, actor, patient.id);
      const messages = hasScope(access, "messages") ? state.messages.filter(message => message.patientId === patient.id && (access.owner || message.clinicianId === actor.id)) : [];
      const contacts = hasScope(access, "messages") ? state.contactRequests.filter(contact => contact.patientId === patient.id && (access.owner || contact.clinicianId === actor.id)) : [];
      const generation = configuredGenerationIdentity();
      const aiCaseScore = currentAiCaseScore(state, actor, patient.id, generation?.model, generation?.cacheIdentity);
      return [{ record: projectPatientRecord(state, actor, patient.id, now), messages, contacts, aiCaseScore,
        ...(access.owner ? { grants: state.careGrants.filter(grant => grant.patientId === patient.id) } : {}) }];
    } catch { return []; }
  });
  const invitations = actor.role === "clinician" ? state.doctorInvitations.filter(invitation => invitation.targetClinicianId === actor.id && Date.parse(invitation.expiresAt) > Date.parse(now) && state.careGrants.some(grant => grant.id === invitation.grantId && state.patients.some(patient => patient.id === grant.patientId && patient.consent))) : [];
  return digest({ records, invitations });
}

type Connection = { token: string; actorId: string; fingerprint: string; lastPongAt: number };
export interface LiveServerOptions {
  origin: string;
  store: CareStoreAdapter;
  /** Optional existing SQLite file; watching also catches worker-process commits. */
  databasePath?: string;
  /** Shorter interval is useful for isolated integration tests. */
  heartbeatMs?: number;
}

export function attachLiveWebSocket(server: Server, options: LiveServerOptions) {
  const sockets = new Map<WebSocket, Connection>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_024, perMessageDeflate: false });
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let attemptWindow = Date.now();
  let attempts = 0;
  const addressAttempts = new Map<string, number>();

  const reject = (socket: Duplex, status: number) => {
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const refresh = () => {
    if (!sockets.size) return;
    let state: CareState;
    try { state = options.store.read(); } catch { return; }
    const snapshot: CareStoreAdapter = { read: () => state, transaction: () => { throw new Error("Read-only live snapshot"); } };
    for (const [socket, connection] of sockets) {
      const actor = verifySession(connection.token, Date.now(), snapshot);
      if (!actor || actor.id !== connection.actorId) { socket.close(LIVE_AUTH_CLOSE, "Session unavailable"); continue; }
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) { socket.terminate(); continue; }
      const fingerprint = liveFingerprint(state, actor);
      if (fingerprint !== connection.fingerprint) {
        connection.fingerprint = fingerprint;
        // No body, resource id, actor id, or hash is sent over the channel.
        socket.send('{"type":"invalidate"}');
      }
    }
  };
  const notifyPersisted = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 20);
    refreshTimer.unref();
  };
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(request.url ?? "", options.origin); } catch { reject(socket, 400); return; }
    if (url.pathname !== LIVE_PATH) return;
    if (request.method !== "GET" || url.search || !liveOriginAllowed(request.headers.origin, options.origin)) { reject(socket, 403); return; }
    const now = Date.now();
    if (now - attemptWindow >= 60_000) { attemptWindow = now; attempts = 0; addressAttempts.clear(); }
    const address = request.socket.remoteAddress ?? "unknown";
    const count = addressAttempts.get(address) ?? 0;
    if (attempts >= 120 || count >= 30 || sockets.size >= MAX_CONNECTIONS) { reject(socket, 429); return; }
    attempts++;
    addressAttempts.set(address, count + 1);
    const token = liveCookieToken(request.headers.cookie);
    let actor: Actor | null;
    let fingerprint: string;
    try {
      const state = options.store.read();
      const snapshot: CareStoreAdapter = { read: () => state, transaction: () => { throw new Error("Read-only live snapshot"); } };
      actor = verifySession(token, now, snapshot);
      if (!actor || !token) { reject(socket, 401); return; }
      const actorId = actor.id;
      if ([...sockets.values()].filter(connection => connection.actorId === actorId).length >= MAX_ACTOR_CONNECTIONS) { reject(socket, 429); return; }
      fingerprint = liveFingerprint(state, actor);
    } catch { reject(socket, 503); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      sockets.set(ws, { token: token!, actorId: actor!.id, fingerprint, lastPongAt: Date.now() });
      ws.on("error", () => ws.terminate());
      ws.on("close", () => sockets.delete(ws));
      ws.on("pong", () => { const connection = sockets.get(ws); if (connection) connection.lastPongAt = Date.now(); });
      // Durable writes use the audited HTTP API. Client-supplied subscriptions are deliberately unsupported.
      ws.on("message", () => ws.close(1008, "Unsupported live command"));
      ws.send('{"type":"ready"}');
      // Close the handshake/commit race: a write may finish just before registration.
      notifyPersisted();
    });
  };
  server.on("upgrade", onUpgrade);
  const heartbeat = setInterval(() => {
    refresh(); // Recheck session versions, principal disablement, consent, grants and worker commits.
    for (const [socket, connection] of sockets) {
      if (Date.now() - connection.lastPongAt > 30_000) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, options.heartbeatMs ?? 5_000);
  heartbeat.unref();
  let watcher: ReturnType<typeof watch> | undefined;
  if (options.databasePath && options.databasePath !== ":memory:") {
    const database = resolve(options.databasePath), name = basename(database);
    try { watcher = watch(dirname(database), (_, filename) => { if (filename && [name, `${name}-wal`, `${name}-shm`].includes(String(filename))) notifyPersisted(); }); }
    catch { /* Heartbeat reconciliation covers unavailable filesystem watching. */ }
    watcher?.on("error", () => { watcher?.close(); watcher = undefined; });
    watcher?.unref();
  }
  const close = () => {
    clearInterval(heartbeat);
    if (refreshTimer) clearTimeout(refreshTimer);
    watcher?.close();
    server.off("upgrade", onUpgrade);
    for (const socket of sockets.keys()) socket.terminate();
    wss.close();
  };
  const revokeSession = (token: string | undefined) => {
    if (token) for (const [socket, connection] of sockets) if (connection.token === token) socket.close(LIVE_AUTH_CLOSE, "Session unavailable");
  };
  return { notifyPersisted, refresh, revokeSession, close, get connectionCount() { return sockets.size; } };
}
