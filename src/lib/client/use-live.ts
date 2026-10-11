"use client";

import { useEffect, useRef, useState } from "react";

export type LiveConnectionStatus = "connecting" | "live" | "reconnecting" | "offline" | "unavailable" | "denied";
export interface LiveConnectionState { status: LiveConnectionStatus; connected: boolean; lastEventAt: number | null }
export interface LiveConnectionOptions { enabled?: boolean; onInvalidate?: () => void }
export function liveReconnectDelay(attempt: number, random = Math.random): number {
  return Math.min(30_000, Math.round(Math.min(30_000, 1_000 * 2 ** Math.min(Math.max(attempt, 0), 5)) * (0.8 + random() * 0.4)));
}

type Listener = { changed: (state: LiveConnectionState) => void; invalidate: () => void };
const initial: LiveConnectionState = { status: "unavailable", connected: false, lastEventAt: null };
/** One bounded connection per browser tab, shared by all mounted data hooks. */
class LiveConnection {
  private listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private handshake: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private state = initial;
  private revision = "";
  private publish(status: LiveConnectionStatus, lastEventAt = this.state.lastEventAt) {
    this.state = { status, connected: status === "live", lastEventAt };
    for (const listener of this.listeners) listener.changed(this.state);
  }
  private invalidate() { for (const listener of this.listeners) listener.invalidate(); }
  private online = () => { this.attempt = 0; this.disconnect(); this.connect(); };
  private offline = () => { this.disconnect(); this.publish("offline"); };
  private sessionInvalidated = () => { this.disconnect(); this.publish("denied"); };
  private storage = (event: StorageEvent) => { if (event.key === "hackcure:device-revision") this.online(); };
  private readRevision() { try { return window.localStorage.getItem("hackcure:device-revision") ?? ""; } catch { return ""; } }
  private disconnect() {
    if (this.retry) clearTimeout(this.retry);
    if (this.handshake) clearTimeout(this.handshake);
    this.retry = undefined;
    this.handshake = undefined;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
  }
  private connect() {
    if (!this.listeners.size || this.socket) return;
    if (typeof WebSocket === "undefined") { this.publish("unavailable"); return; }
    if (navigator.onLine === false) { this.publish("offline"); return; }
    this.revision = this.readRevision();
    this.publish(this.attempt ? "reconnecting" : "connecting");
    const url = new URL("/api/live", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch { this.schedule(); return; }
    this.socket = socket;
    this.handshake = setTimeout(() => { if (this.socket === socket && this.state.status !== "live") socket.close(); }, 8_000);
    socket.onmessage = event => {
      if (this.socket !== socket || typeof event.data !== "string" || event.data.length > 128) return;
      // Same-tab logout/admission changes also invalidate the previous socket's binding.
      if (this.readRevision() !== this.revision) { this.online(); return; }
      let message: { type?: string };
      try { message = JSON.parse(event.data); } catch { socket.close(); return; }
      if (message.type === "ready") {
        if (this.handshake) clearTimeout(this.handshake);
        this.attempt = 0;
        this.publish("live", Date.now());
        this.invalidate(); // Reconcile updates missed during disconnect; no event replay needed.
      } else if (message.type === "invalidate") { this.publish("live", Date.now()); this.invalidate(); }
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.handshake) clearTimeout(this.handshake);
      if (event.code === 4401) { this.publish("denied"); this.invalidate(); return; }
      this.schedule();
    };
    socket.onerror = () => { /* onclose owns bounded retries; polling stays available meanwhile. */ };
  }
  private schedule() {
    if (!this.listeners.size) return;
    if (navigator.onLine === false) { this.publish("offline"); return; }
    this.publish("reconnecting");
    this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, liveReconnectDelay(this.attempt++));
  }
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener.changed(this.state);
    if (this.listeners.size === 1) {
      window.addEventListener("online", this.online);
      window.addEventListener("offline", this.offline);
      window.addEventListener("storage", this.storage);
      window.addEventListener("hackcure:session-invalidated", this.sessionInvalidated);
      this.attempt = 0;
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.disconnect();
        window.removeEventListener("online", this.online);
        window.removeEventListener("offline", this.offline);
        window.removeEventListener("storage", this.storage);
        window.removeEventListener("hackcure:session-invalidated", this.sessionInvalidated);
        this.state = initial;
      }
    };
  }
}

const connection = new LiveConnection();
export function useLiveConnection({ enabled = true, onInvalidate }: LiveConnectionOptions = {}): LiveConnectionState {
  const [state, setState] = useState<LiveConnectionState>(initial);
  const invalidateRef = useRef(onInvalidate);
  invalidateRef.current = onInvalidate;
  useEffect(() => {
    if (!enabled) return;
    return connection.subscribe({ changed: setState, invalidate: () => invalidateRef.current?.() });
  }, [enabled]);
  return enabled ? state : initial;
}
