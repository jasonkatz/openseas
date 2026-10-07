import type { WebSocket } from 'ws';
import type { ServerMsg } from '@tidebound/shared';

export class Session {
  pirateId: string | null = null;
  pos = { x: 800, y: 740, facing: 2, moving: false };
  emote: string | null = null;
  emoteUntil = 0;
  lastSeen = Date.now();
  /** Active puzzle session id. */
  puzzleSessionId: string | null = null;
  alive = true;

  constructor(public readonly id: string, public readonly ws: WebSocket) {}

  send(msg: ServerMsg): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}
