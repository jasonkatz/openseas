import { parseServerMessage, type ClientMessage, type ServerMessage } from "@openseas/protocol";
import { wsUrl } from "./base.js";

export type SocketStatus = "idle" | "connecting" | "open" | "closed";
type Listener = (msg: ServerMessage) => void;

/**
 * One socket per tab. Reconnects with backoff while the tab is open. Messages are validated against
 * the protocol schemas before anyone sees them.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: SocketStatus) => void>();
  private attempt = 0;
  private timer: number | null = null;
  private wantOpen = false;
  status: SocketStatus = "idle";
  /** serverNow - Date.now(), estimated from the last message that carried a server clock. */
  clockOffset = 0;

  connect(): void {
    this.wantOpen = true;
    this.open();
  }

  disconnect(): void {
    this.wantOpen = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: SocketStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private open(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus("connecting");
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
    };
    ws.onmessage = (ev) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const msg = parseServerMessage(raw);
      if (!msg) return;
      if ("serverNow" in msg) this.clockOffset = msg.serverNow - Date.now();
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.setStatus("closed");
      if (this.wantOpen) {
        const delay = Math.min(10_000, 500 * 2 ** this.attempt++);
        this.timer = window.setTimeout(() => this.open(), delay);
      }
    };
    ws.onerror = () => ws.close();
  }

  private setStatus(s: SocketStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}
