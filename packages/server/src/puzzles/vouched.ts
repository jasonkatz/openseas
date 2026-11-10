import type { AnyPuzzleDef, VouchedKind } from "@openseas/engine";

/**
 * The moves on one board that are not its pirate's (ADR 0022, ADR 0042): what the server has said the
 * board may log, named and compared by the puzzle's engine. The ship and the harness's lone ship say
 * what to vouch for; the session manager checks every vouched move a board logs against it, and a
 * hand-back sends the board whatever is still pending.
 */
export class VouchedMoves {
  /** What the server said and the board may still log, oldest first. */
  private readonly said: Array<{ readonly kind: string; readonly move: unknown }> = [];

  constructor(private readonly def: AnyPuzzleDef) {}

  /**
   * Vouch for a move the board may log. A standing or latest word replaces the last of its kind; a
   * queued word joins the back. Returns false when it is no news to the board: the standing word it
   * already has. Throws for a move the engine does not vouch for, or one the server writes itself.
   */
  vouch(move: unknown): boolean {
    const kind = this.kindOf(move);
    if (!kind || kind.rule === "server") throw new Error(`the server does not vouch for ${JSON.stringify(move)} on a ${this.def.id} board`);
    if (kind.rule !== "queue") {
      const i = this.said.findIndex((s) => s.kind === kind.kind);
      if (i >= 0) {
        if (kind.rule === "standing" && kind.same(this.said[i]!.move, move)) return false;
        this.said.splice(i, 1);
      }
    }
    this.said.push({ kind: kind.kind, move });
    return true;
  }

  /** Every vouched move the board may still log, in the order the server said them. */
  pending(): unknown[] {
    return this.said.map((s) => s.move);
  }

  /**
   * Whether the board may log `move`. Its pirate's own moves, always. A vouched move only as the
   * server said it: the word that stands, the latest deal, the oldest of a queue. Never the server's own.
   */
  admits(move: unknown): boolean {
    const kind = this.kindOf(move);
    if (!kind) return true;
    if (kind.rule === "server") return false;
    const said = this.said.find((s) => s.kind === kind.kind);
    return said !== undefined && kind.same(said.move, move);
  }

  /** The board logged `move`, which it was admitted to: a latest deal or a queued word is used up, a standing word stands. */
  logged(move: unknown): void {
    const kind = this.kindOf(move);
    if (!kind || kind.rule === "standing" || kind.rule === "server") return;
    const i = this.said.findIndex((s) => s.kind === kind.kind);
    if (i >= 0) this.said.splice(i, 1);
  }

  private kindOf(move: unknown): VouchedKind<unknown> | null {
    return this.def.vouched?.(move) ?? null;
  }
}
