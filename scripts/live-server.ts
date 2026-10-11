import { createServer } from "node:http";
import next from "next";
import { getCareStore } from "../src/lib/care-store";
import { attachLiveWebSocket, liveCookieToken, LIVE_PATH } from "../src/lib/live-websocket";

async function main() {
  const dev = process.env.NODE_ENV !== "production";
  const port = Number(process.env.HACKCURE_LIVE_PORT ?? process.env.PORT ?? 3001);
  const hostname = process.env.HACKCURE_LIVE_HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid PORT");
  const origin = process.env.APP_ORIGIN ?? `http://${hostname}:${port}`;
  if (new URL(origin).origin !== origin) throw new Error("APP_ORIGIN must be an origin without a path");
  if (!dev && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production");
  let handle: ReturnType<ReturnType<typeof next>["getRequestHandler"]>;
  const server = createServer((request, response) => {
    // Existing APIs own validation, authorization, transaction durability and audit.
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET") && request.url?.startsWith("/api/")) {
      response.once("finish", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return;
        if (request.url?.split("?")[0] === "/api/session") live.revokeSession(liveCookieToken(request.headers.cookie));
        live.notifyPersisted();
      });
    }
    void handle(request, response).catch(() => {
      if (!response.headersSent) { response.statusCode = 500; response.end(); }
      else response.destroy();
    });
  });
  // Next 16 installs its own upgrade listener lazily from getRequestHandler().
  // The documented httpServer option lets us filter that listener while retaining HMR.
  const nextHttpServer = new Proxy(server, { get(target, property, receiver) {
    if (property !== "on") return Reflect.get(target, property, receiver);
    return (event: string, listener: (...args: unknown[]) => void) => {
      if (event !== "upgrade") return target.on(event, listener);
      return target.on("upgrade", (request, socket, head) => {
        let path: string;
        try { path = new URL(request.url ?? "", origin).pathname; } catch { socket.destroy(); return; }
        if (path !== LIVE_PATH) listener(request, socket, head);
      });
    };
  } });
  const app = next({ dev, hostname, port, webpack: dev, httpServer: nextHttpServer });
  await app.prepare();
  handle = app.getRequestHandler();
  const live = attachLiveWebSocket(server, { origin, store: getCareStore(), databasePath: process.env.HACKCURE_CARE_DATABASE_PATH ?? ".data/care.sqlite" });
  server.listen(port, hostname, () => console.log(`Sentetrace live server listening on ${hostname}:${port}`));
  const shutdown = () => { live.close(); server.close(() => { void app.close().then(() => process.exit(0)); }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch(() => { console.error("Live server startup failed; check configuration and build."); process.exitCode = 1; });
