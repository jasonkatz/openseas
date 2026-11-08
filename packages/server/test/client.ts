import { WebSocket } from "ws";
import { parseServerMessage, type ServerMessage } from "@openseas/protocol";

/** A test's end of the websocket: every server message parsed, and a way to wait for the next one of a kind. */
export class Client {
  readonly inbox: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      const m = parseServerMessage(JSON.parse(d.toString()));
      if (!m) throw new Error(`unparseable server message: ${d.toString()}`);
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(m);
      else this.inbox.push(m);
    });
  }
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
  until<T extends ServerMessage["type"]>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    const test = (m: ServerMessage): boolean => m.type === type && pred(m as Extract<ServerMessage, { type: T }>);
    const i = this.inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}; inbox: ${this.inbox.map((m) => m.type).join(",")}`)), 8000);
      this.waiters.push({
        pred: test,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }
  /** Drop what has piled up, so the next `until` waits for something new. */
  clear(): void {
    this.inbox.length = 0;
  }
}
