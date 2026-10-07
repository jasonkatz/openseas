import type { ClientMsg, ServerMsg } from '@tidebound/shared';

type Listener = (msg: ServerMsg) => void;

/** Reconnecting WebSocket client. */
export class Net {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private retry = 0;
  private closedByUser = false;
  onStatus: (s: 'connecting' | 'open' | 'closed') => void = () => {};
  /** Estimated server clock offset (serverTime - localTime). */
  clockOffset = 0;

  url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const override = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL;
    return override || `${proto}://${location.host}/ws`;
  }

  connect(): void {
    this.closedByUser = false;
    this.onStatus('connecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus('open');
      for (const m of this.queue) ws.send(m);
      this.queue = [];
      this.send({ t: 'ping', at: Date.now() });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data as string) as ServerMsg; } catch { return; }
      if (msg.t === 'pong') {
        const rtt = Date.now() - msg.at;
        this.clockOffset = msg.serverTime - (Date.now() - rtt / 2);
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      this.onStatus('closed');
      if (this.closedByUser) return;
      const delay = Math.min(8000, 500 * Math.pow(2, this.retry++));
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  send(msg: ClientMsg): void {
    const s = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (msg.t === 'login') this.queue.push(s);
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  serverNow(): number { return Date.now() + this.clockOffset; }
}

export const net = new Net();
