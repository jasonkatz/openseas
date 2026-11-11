import type { ServerMessage } from "@openseas/protocol";

/** A pirate's end of the line: their socket, or a test's inbox. */
export interface Line {
  send(message: ServerMessage): void;
}

/**
 * Who is connected, and the way to each of them. One pirate, one seat: the newest socket holds it,
 * and only the socket holding it gives it up, so an old tab closing after a newer one opened changes
 * nothing. Everything addressed to a pirate rather than to a room goes through here (a board's
 * result, a crew notice, a summary re-sent), and rooms (ADR 0005) keep their own members but send
 * to each through here as well. Nothing is queued: a message to a pirate who is offline is dropped.
 */
export class Presence {
  private readonly lines = new Map<string, Line>();

  /**
   * The pirate's newest socket takes their seat. Returns the call that gives it up when the socket
   * closes: true when the pirate went offline with it, false, changing nothing, once a newer socket
   * holds the seat.
   */
  attach(pirateId: string, line: Line): () => boolean {
    this.lines.set(pirateId, line);
    return () => {
      if (this.lines.get(pirateId) !== line) return false;
      this.lines.delete(pirateId);
      return true;
    };
  }

  online(pirateId: string): boolean {
    return this.lines.has(pirateId);
  }

  /** Say something to the pirate on their newest socket. */
  send(pirateId: string, message: ServerMessage): void {
    this.lines.get(pirateId)?.send(message);
  }
}
