import type { ServerMessage } from "@openseas/protocol";
import type { Line } from "../src/presence.js";

/** A pirate's line that keeps everything said on it, standing in for their socket. */
export class Inbox implements Line {
  readonly got: ServerMessage[] = [];
  constructor(readonly id: string) {}
  send(m: ServerMessage): void {
    this.got.push(m);
  }
  of<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.got.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}
