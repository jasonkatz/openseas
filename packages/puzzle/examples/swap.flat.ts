// The top rung, written by hand: one flat object of hooks, with no parts anywhere. The tests hold
// it to the seven-line Swap, event for event, which is what "the lower rungs expand to the top one" means.
import { defineRules, groupsOf, touching, type Cell, type Puzzle } from "../src/index.js";
import composed from "./swap.puzzle.js";

type Swap = { readonly move: "swap"; readonly a: Cell; readonly b: Cell };

const rules = defineRules<Swap>({
  // Start: deal a board. The loop holds it to the document's "playable" check.
  onStart(ctx) {
    ctx.emit("fill", {}, (e) => {
      for (const p of ctx.board.places()) e.arrive(p, { piece: "kind", kind: 1 + ctx.draw("fill").even(ctx.settings.kinds as number) });
    });
  },

  canMove(view, { a, b }) {
    if (!touching(a, b)) return "pick two pieces side by side";
    const pa = view.board.at(a), pb = view.board.at(b);
    if (!pa || !pb) return "there is no piece there";
    if (pa.kind === pb.kind) return "those two are the same kind";
    return null;
  },

  onMove(ctx, _seat, { a, b }) {
    ctx.emit("swap", { a, b }, (e) => e.travel(a, b).travel(b, a));
  },

  // Cascade: asked again and again until it reports nothing.
  onCascade(ctx) {
    const groups = groupsOf(ctx.board, ctx.settings.lineMin as number);
    if (groups.length > 0) {
      for (const g of groups) ctx.emit("clear", { pieces: g, size: g.length }, (e) => g.forEach((p) => e.leave(p)));
      return;
    }
    if (ctx.board.places().every((p) => ctx.board.at(p))) return;
    ctx.emit("rise", {}, (e) => {
      for (let x = 0; x < ctx.board.width; x++) {
        let top = 0;
        for (let y = 0; y < ctx.board.height; y++) {
          if (!ctx.board.at({ x, y })) continue;
          if (y !== top) e.travel({ x, y }, { x, y: top });
          top++;
        }
        for (let y = top; y < ctx.board.height; y++) e.arrive({ x, y }, { piece: "kind", kind: 1 + ctx.draw("rise").even(ctx.settings.kinds as number) }, "below");
      }
    });
  },

  listMoves(view) {
    const out: Swap[] = [];
    for (const a of view.board.places()) {
      for (const b of [{ x: a.x + 1, y: a.y }, { x: a.x, y: a.y + 1 }]) {
        const m: Swap = { move: "swap", a, b };
        if (view.board.has(b) && rules.canMove(view, m) === null) out.push(m);
      }
    }
    return out;
  },
});

/** The same document, since the document is not what is in question, and the rules written flat. */
const flat: Puzzle<Swap> = { document: composed.document, rules };
export default flat;
