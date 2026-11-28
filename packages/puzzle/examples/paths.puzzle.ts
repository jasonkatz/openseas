// Paths, written on rung 4: six parts, each a layer, switched on over a ladder of four stages. Draw a path
// through touching pieces of one kind to clear them. The whole puzzle adds a streak, prizes that sink, loops
// that net every prize at once, a bounty on one kind, and timed pieces that ruin their neighbours.
//
// The tests play it beside Salvage, the engine the game ships for this puzzle, move for move, at every stage.
import { bestRound, budget, clock, grid, part, puzzle, stage, type Board, type Cell, type Changes, type Ctx, type NewPiece, type Piece, type SettingNeed, type View } from "../src/index.js";

export type TraceMove = { readonly move: "trace"; readonly path: readonly Cell[]; readonly closed: boolean };

const key = (p: Cell): string => `${p.x},${p.y}`;
const is = (board: Board, piece: string) => (p: Cell): boolean => board.at(p)?.piece === piece;
/** A path runs through plain pieces and timed ones. A prize and a ruined piece are never on one. */
const joinable = (p: Piece | null): p is Piece => p?.piece === "kind" || p?.piece === "timed";
const joins = (a: Piece | null, b: Piece | null): boolean => joinable(a) && joinable(b) && a.kind === b.kind;
const touches = (a: Cell, b: Cell): boolean => key(a) !== key(b) && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
const full = (board: Board): boolean => board.places().every((p) => board.at(p));
const numbers = (view: View): Record<string, number> => view.settings as Record<string, number>;
const whole = (id: string, value: number, min: number, max: number, description: string, group: SettingNeed["group"], unit?: string): SettingNeed => ({ id, type: "whole", default: value, min, max, description, group, ...(unit ? { unit } : {}) });

/**
 * The cells strictly inside a closed path, by the even-odd rule on the line through its cells' centres: a ray
 * cast right from a cell crosses an edge when the edge steps between that row and the row below it.
 */
function insideOf(board: Board, path: readonly Cell[]): Cell[] {
  const on = new Set(path.map(key));
  return board.places().filter((c) => {
    if (on.has(key(c))) return false;
    let crossings = 0;
    path.forEach((a, i) => {
      const b = path[(i + 1) % path.length]!;
      if (a.y > c.y !== b.y > c.y && (a.y === c.y ? a.x : b.x) > c.x) crossings++;
    });
    return crossings % 2 === 1;
  });
}
/** What a trace takes off the board: its path, and when it closes, whatever is inside it and every prize there is. */
function taken(view: View, move: TraceMove): { path: readonly Cell[]; inside: Cell[]; prizes: Cell[] } {
  if (!move.closed) return { path: move.path, inside: [], prizes: [] };
  const prize = is(view.board, "prize");
  return { path: move.path, inside: insideOf(view.board, move.path).filter((p) => !prize(p)), prizes: view.board.places().filter(prize) };
}
/** Every trace counts among the stats, closed or not. */
const counted = (ctx: Ctx, e: Changes, length: number): Changes => e.set("paths", ctx.value("paths") + 1).set("longest", Math.max(ctx.value("longest"), length));

/**
 * `luck: "one"` takes every draw from the one stream `debris`, as the shipped engine does, so the two can be
 * played side by side. Left out, each draw has a stream of its own.
 */
export function pathsWith(opts: { luck?: "one" } = {}) {
  const from = (draw: string): string => (opts.luck === "one" ? "debris" : draw);
  const own = <T>(draws: T[]): T[] => (opts.luck === "one" ? [] : draws);

  /** The verb, and the board that answers it: trace a path, the pieces above fall, new ones come in at the top. */
  const paths = part<TraceMove>({
    name: "paths",
    rule: "draw a path through touching pieces of one kind to clear them: a path of n scores n × n",
    settings: [whole("pathMin", 3, 2, 5, "the shortest path that clears", "scoring", "pieces"), whole("pathPoints", 1, 0, 1000, "points a path earns, times its length squared", "scoring", "points")],
    moves: [{ id: "trace", description: "draw a path through touching pieces of one kind", gesture: "draw", fields: { path: "places", closed: "flag" } }],
    events: [
      { id: "fill", description: "a fresh board was dealt", fields: {}, changes: ["leave", "arrive"] },
      { id: "clear", description: "a path cleared", fields: { path: "places", points: "points" }, changes: ["leave"], step: true },
      { id: "refill", description: "pieces fell and new ones came in at the top", fields: {}, changes: ["travel", "arrive"] },
      { id: "reshuffle", description: "no path was left, so the plain pieces were dealt again where they stood", fields: {}, changes: ["leave", "arrive"] },
    ],
    draws: [{ id: "debris", description: "the kind of each new piece", gives: "kind", by: "even", when: "refill", reads: ["kinds"] }],
    checks: [{ id: "path", description: "a path can be drawn", draws: ["debris"], tries: 50, fallback: "makes every plain piece one kind, so a path can always be drawn", during: "reshuffle" }],
    payouts: [{ id: "path", description: "a path's length squared", on: ["clear", "loop"], counts: "path", growth: "superlinear", reads: ["pathPoints"] }],
    stats: [{ id: "paths", description: "paths traced" }, { id: "longest", description: "the longest path traced" }],
    texts: ["reason.too_short", "reason.twice", "reason.not_joinable", "reason.not_touching", "reason.not_same_kind", "reason.cannot_close"],
    hooks: {
      canMove: {
        trace(view, { path, closed }: TraceMove) {
          const n = numbers(view);
          if (path.length < n.pathMin!) return "reason.too_short";
          if (new Set(path.map(key)).size < path.length) return "reason.twice";
          const pieces = path.map((p) => view.board.at(p));
          if (!pieces.every(joinable)) return "reason.not_joinable";
          for (let i = 1; i < path.length; i++) {
            if (!touches(path[i - 1]!, path[i]!)) return "reason.not_touching";
            if (!joins(pieces[i - 1]!, pieces[i]!)) return "reason.not_same_kind";
          }
          // Closing is the loops layer's: a stage that has not reached it draws open paths only.
          if (closed && !(view.on("loops") && path.length >= n.loopMin! && touches(path.at(-1)!, path[0]!))) return "reason.cannot_close";
          return null;
        },
      },
      onMove: {
        trace(ctx, _seat, { path, closed }: TraceMove) {
          if (!closed) ctx.emit("clear", { path }, (e) => counted(ctx, path.reduce((c, p) => c.leave(p), e), path.length));
        },
      },
      onStart(ctx) {
        const { board } = ctx;
        const n = numbers(ctx);
        const piece = (): NewPiece => ({ piece: "kind", kind: 1 + ctx.draw("debris").even(n.kinds!) });
        // Dealt again during play, the plain pieces alone change: a prize, a timed piece and a ruined one stay as they are.
        if (board.places().some((p) => board.at(p))) return ctx.emit("fill", {}, (e) => board.places().filter(is(board, "kind")).forEach((p) => e.leave(p).arrive(p, piece(), "in place")));
        // Prizes open in the upper rows, so each has pieces under it to be dug out or ringed.
        const free = board.places().filter((p) => p.y < Math.max(1, board.height - 2));
        const prizes = new Set<string>();
        if (ctx.on("prizes")) for (let i = 0; i < n.startPrizes! && free.length > 0; i++) prizes.add(key(free.splice(ctx.draw(from("prize")).even(free.length), 1)[0]!));
        ctx.emit("fill", {}, (e) => board.places().forEach((p) => e.arrive(p, prizes.has(key(p)) ? { piece: "prize" } : piece())));
      },
      onFallback(ctx) {
        const { board } = ctx;
        const empty = !board.places().some((p) => board.at(p));
        ctx.emit("fill", {}, (e) => board.places().filter((p) => empty || is(board, "kind")(p)).forEach((p) => (empty ? e : e.leave(p)).arrive(p, { piece: "kind", kind: 1 }, "in place")));
      },
      onCascade(ctx) {
        const { board } = ctx;
        if (full(board)) return;
        const n = numbers(ctx);
        let prizes = board.places().filter(is(board, "prize")).length;
        ctx.emit("refill", {}, (e) => {
          for (let x = 0; x < board.width; x++) {
            let floor = board.height - 1; // pieces fall to the bottom of their column...
            for (let y = board.height - 1; y >= 0; y--) {
              if (!board.at({ x, y })) continue;
              if (y !== floor) e.travel({ x, y }, { x, y: floor });
              floor--;
            }
            // ...and new ones come in above them, the deepest first. A prize never comes in onto the floor: it has to be worked for.
            for (let y = floor; y >= 0; y--) {
              const prize = ctx.on("prizes") && prizes < n.maxPrizes! && y < board.height - 1 && ctx.draw(from("prize")).chance(n.prizePermille!);
              if (prize) prizes++;
              e.arrive({ x, y }, prize ? { piece: "prize" } : { piece: "kind", kind: 1 + ctx.draw("debris").even(n.kinds!) });
            }
          }
        });
      },
      // Every open path of the shortest length: enough for the loop to tell whether a path is left.
      listMoves(view) {
        const { board } = view;
        const min = numbers(view).pathMin!;
        const out: TraceMove[] = [];
        const walk = (path: Cell[]): void => {
          if (path.length === min) return void out.push({ move: "trace", path, closed: false });
          const last = path.at(-1)!;
          for (const next of board.touching(last)) if (!path.some((p) => key(p) === key(next)) && joins(board.at(last), board.at(next))) walk([...path, next]);
        };
        for (const p of board.places()) if (joinable(board.at(p))) walk([p]);
        return out;
      },
    },
  });

  /** Long paths in a row multiply everything a move banks. One short path is forgiven, and a blowup breaks it. */
  const streak = part({
    name: "streak",
    rule: "long paths in a row multiply",
    settings: [
      whole("streakMin", 5, 2, 20, "a path this long builds the streak", "scoring", "pieces"),
      { id: "streakPercent", type: "list", default: [100, 115, 130, 145, 160, 180, 200], min: 100, max: 1000, description: "what the streak multiplies by, an entry for each long path in a row", group: "scoring", entries: { least: 1, most: 16 } },
    ],
    streak: { builds: { event: "clear or loop", when: "path >= streakMin" }, grace: 1, breaksOn: ["blowup"] },
    multipliers: [{ id: "streak", description: "the streak multiplies everything a move banks", scales: ["path", "inside", "prize_loop", "prize_floor", "bounty", "defuse"], on: "every", by: { table: "streakPercent", index: "streak" } }],
    gauges: [{ id: "streak", description: "long paths in a row" }],
    stats: [{ id: "best_streak", description: "the longest streak" }],
    hooks: {},
  });

  /** Prizes sink as the pieces under them clear, and one that reaches the floor is taken for a little. So is whatever else no path can take. */
  const prizes = part({
    name: "prizes",
    rule: "prizes sink as you clear beneath them, and pay a little at the floor",
    pieces: [{ id: "prize" }],
    settings: [
      whole("startPrizes", 2, 0, 12, "prizes on the opening board", "deal", "pieces"),
      whole("prizePermille", 35, 0, 500, "chance in a thousand that a new piece is a prize, below the most", "deal"),
      whole("maxPrizes", 3, 1, 12, "the most prizes on the board at once", "deal", "pieces"),
      whole("prizeFloorPoints", 30, 0, 100_000, "points for a prize that sinks to the floor", "scoring", "points"),
    ],
    draws: own([{ id: "prize", description: "where the opening prizes lie, and whether a new piece is a prize while there are fewer than the most", gives: "piece" as const, by: "weighted" as const, when: "refill" as const, reads: ["startPrizes", "prizePermille", "maxPrizes"] }]),
    events: [
      { id: "prize_floor", description: "prizes reached the floor and were taken", fields: { prizes: "places", points: "points" }, changes: ["leave"] },
      { id: "swept", description: "ruined pieces reached the floor and were swept off", fields: { pieces: "places" }, changes: ["leave"] },
    ],
    payouts: [{ id: "prize_floor", description: "each prize that reaches the floor", on: ["prize_floor"], counts: "prizes", growth: "linear", reads: ["prizeFloorPoints"] }],
    stats: [{ id: "prizes_floor", description: "prizes taken at the floor" }],
    hooks: {
      // Asked only once the board is full again, so what stands on the floor has come to rest there.
      onCascade(ctx) {
        const floor = ctx.board.places().filter((p) => p.y === ctx.board.height - 1);
        const [sunk, ruined] = [floor.filter(is(ctx.board, "prize")), floor.filter(is(ctx.board, "ruined"))];
        if (sunk.length > 0) ctx.emit("prize_floor", { prizes: sunk }, (e) => sunk.reduce((c, p) => c.leave(p), e).set("prizes_floor", ctx.value("prizes_floor") + sunk.length));
        if (ruined.length > 0) ctx.emit("swept", { pieces: ruined }, (e) => ruined.forEach((p) => e.leave(p)));
      },
    },
  });

  /** A path that ends beside where it began can close. A loop takes what is inside it, and every prize on the board. */
  const loops = part({
    name: "loops",
    rule: "a closed path takes whatever is inside it and every prize at once",
    settings: [
      whole("loopMin", 4, 3, 12, "the shortest path that can close", "scoring", "pieces"),
      whole("loopPercent", 200, 100, 1000, "what closing multiplies a path's own points by", "scoring"),
      whole("insidePoints", 10, 0, 10_000, "points for each piece inside a loop", "scoring", "points"),
      whole("prizeLoopPoints", 50, 0, 100_000, "points a loop earns for its prizes, times their number squared", "scoring", "points"),
    ],
    events: [{ id: "loop", description: "a path closed, and took what was inside it and every prize", fields: { path: "places", inside: "places", prizes: "places", points: "points" }, changes: ["leave"], step: true }],
    payouts: [
      { id: "inside", description: "each piece inside a loop", on: ["loop"], counts: "inside", growth: "linear", reads: ["insidePoints"] },
      { id: "prize_loop", description: "the prizes a loop takes, squared", on: ["loop"], counts: "prizes", growth: "superlinear", reads: ["prizeLoopPoints"] },
    ],
    multipliers: [{ id: "loop", description: "closing multiplies a path's own points", scales: ["path"], on: "loop", by: { percent: "loopPercent" } }],
    stats: [{ id: "loops", description: "loops closed" }, { id: "prizes_netted", description: "prizes taken by a loop" }],
    hooks: {
      onMove: {
        trace(ctx, _seat, move: TraceMove) {
          if (!move.closed) return;
          const { path, inside, prizes } = taken(ctx, move);
          ctx.emit("loop", { path, inside, prizes }, (e) =>
            counted(ctx, [...path, ...inside, ...prizes].reduce((c, p) => c.leave(p), e), path.length).set("loops", ctx.value("loops") + 1).set("prizes_netted", ctx.value("prizes_netted") + prizes.length),
          );
        },
      },
    },
  });

  /** One kind is posted. A long path of it pays a bonus, and another kind is posted. */
  const bounty = part<never, { last: number }>({
    name: "bounty",
    rule: "a posted kind pays a bonus for a long path of it",
    settings: [whole("bountyLength", 7, 2, 144, "the shortest path of the posted kind that fills the bounty", "scoring", "pieces"), whole("bountyBonus", 200, 0, 100_000, "points for filling the bounty", "scoring", "points")],
    draws: own([{ id: "posted", description: "the kind the bounty names, never the one it named last", gives: "kind" as const, by: "even" as const, when: "task" as const, reads: ["kinds"] }]),
    tasks: [{ id: "bounty", description: "a long path of the posted kind", open: 1, ends: ["done"], graded: "none", grades: [] }],
    events: [
      { id: "bounty", description: "the bounty was filled", fields: { kind: "number", points: "points" } },
      { id: "posted", description: "a bounty was posted", fields: { kind: "number" } },
    ],
    payouts: [{ id: "bounty", description: "filling the bounty", on: ["bounty"], growth: "flat", reads: ["bountyBonus"] }],
    stats: [{ id: "bounties", description: "bounties filled" }],
    hooks: {
      onMove: {
        trace(ctx, _seat, { path }: TraceMove) {
          const kind = ctx.board.at(path[0]!)!.kind!;
          if (ctx.task("bounty")?.holds.kind !== kind || path.length < numbers(ctx).bountyLength!) return;
          ctx.emit("bounty", { kind }, (e) => e.done("bounty").set("bounties", ctx.value("bounties") + 1));
          return { last: kind };
        },
      },
      onTaskNeeded(ctx) {
        const kinds = numbers(ctx).kinds!;
        const last = ctx.state?.last;
        const pick = 1 + ctx.draw(from("posted")).even(last === undefined ? kinds : kinds - 1);
        const kind = last !== undefined && pick >= last ? pick + 1 : pick;
        ctx.emit("posted", { kind }, (e) => e.open("bounty", { kind }));
      },
    },
  });

  /**
   * Every few moves one new piece comes in timed. It counts down with each move that leaves it on the board, and
   * clearing it pays more the later it is left. At nothing it blows: it and the pieces round it are ruined.
   */
  const timers = part<never, { moves: number; burnt: boolean; before: readonly number[] | null }>({
    name: "timers",
    rule: "a timed piece pays more the later it is cleared, and ruins its neighbours if it runs out",
    pieces: [{ id: "timed", of: "kind", states: { count: "timerFuse" } }, { id: "ruined" }],
    settings: [
      whole("timerEvery", 8, 1, 1000, "moves between one timed piece and the next", "deal", "moves"),
      whole("timerFuse", 6, 1, 100, "moves a timed piece lasts", "tempo", "moves"),
      whole("timerPoints", 60, 0, 100_000, "points for clearing a timed piece, for every move it has counted and one more", "scoring", "points"),
    ],
    draws: own([{ id: "timer", description: "which new piece comes in timed", gives: "place" as const, by: "even" as const, when: { every: "timerEvery" }, reads: ["timerEvery"] }]),
    events: [
      { id: "defuse", description: "a timed piece was cleared in time", fields: { place: "place", late: "number", points: "points" } },
      { id: "burn", description: "the timed pieces left on the board counted down", fields: { pieces: "places" }, changes: ["change"] },
      { id: "blowup", description: "a timed piece ran out and ruined the pieces round it", fields: { place: "place", ruined: "places" }, changes: ["change"], mistake: true },
      { id: "arm", description: "a new piece came in timed", fields: { place: "place" }, changes: ["change"] },
    ],
    payouts: [{ id: "defuse", description: "a timed piece cleared, for every move it had counted and one more", on: ["defuse"], counts: "late", growth: "linear", reads: ["timerPoints"] }],
    stats: [{ id: "defused", description: "timed pieces cleared in time" }, { id: "blowups", description: "timed pieces that ran out" }],
    hooks: {
      onMove: {
        // Asked before the path leaves, so it can see the timed pieces the move takes.
        trace(ctx, _seat, move: TraceMove) {
          const { board } = ctx;
          const n = numbers(ctx);
          const { path, inside } = taken(ctx, move);
          for (const place of [...path, ...inside].filter(is(board, "timed")).sort((a, b) => a.y - b.y || a.x - b.x)) {
            ctx.emit("defuse", { place, late: n.timerFuse! - (board.at(place)!.state as number) + 1 }, (e) => e.set("defused", ctx.value("defused") + 1));
          }
          const moves = (ctx.state?.moves ?? 0) + 1;
          // When one is due, what is on the board now is remembered, so the pieces that come in can be told from it.
          return { moves, burnt: false, before: moves % n.timerEvery! === 0 ? board.places().map((p) => board.at(p)!.id) : null };
        },
      },
      onCascade(ctx) {
        const { board, state } = ctx;
        if (!state) return;
        // First, before anything falls: every timed piece still on the board counts down, and those at nothing blow.
        if (!state.burnt) {
          const left = board.places().filter(is(board, "timed"));
          const [burning, blowing] = [left.filter((p) => (board.at(p)!.state as number) > 1), left.filter((p) => (board.at(p)!.state as number) <= 1)];
          if (burning.length > 0) ctx.emit("burn", { pieces: burning }, (e) => burning.forEach((p) => e.change(p, { state: (board.at(p)!.state as number) - 1 })));
          for (const place of blowing) {
            const ruined = [place, ...board.touching(place)].filter((p) => joinable(board.at(p))).sort((a, b) => a.y - b.y || a.x - b.x);
            ctx.emit("blowup", { place, ruined }, (e) => ruined.reduce((c, p) => c.change(p, { piece: "ruined" }), e).set("blowups", ctx.value("blowups") + 1));
          }
          return { ...state, burnt: true };
        }
        // Then, once the board has filled: one of the plain pieces that came in is timed.
        if (!state.before || !full(board)) return;
        const fresh: Cell[] = [];
        for (let x = 0; x < board.width; x++) for (let y = board.height - 1; y >= 0; y--) if (board.at({ x, y })!.piece === "kind" && !state.before.includes(board.at({ x, y })!.id)) fresh.push({ x, y });
        if (fresh.length > 0) {
          const place = fresh[ctx.draw(from("timer")).even(fresh.length)]!;
          ctx.emit("arm", { place }, (e) => e.change(place, { piece: "timed", kind: board.at(place)!.kind!, state: numbers(ctx).timerFuse! }));
        }
        return { ...state, before: null };
      },
    },
  });

  return puzzle("paths", {
    board: grid("width", "height", { touch: 8 }),
    pieces: "kinds",
    stages: [
      stage("paths", [paths], { advance: bestRound(120) }),
      stage("streak", [streak, prizes], { advance: bestRound(280) }),
      stage("loops", [loops, bounty], { advance: bestRound(780) }),
      stage("full", [timers]),
    ],
    // The timers and the bounty are asked about a move before its path leaves the board.
    order: ["timers", "bounty"],
    ends: [clock("roundSeconds"), budget("maxMoves")],
    settings: { width: 7, height: 8, kinds: 5, roundSeconds: 120, maxMoves: 600 },
    // What a ready puzzle adds: where its tiers start, and its biggest event, a loop that takes prizes.
    evaluation: { tierStarts: { steady: 850, sharp: 2450, masterful: 4800, legendary: 8400 }, paceWindowSeconds: 10 },
    moment: { event: "loop", when: "prizes > 0", size: "prizes", most: "maxPrizes" },
  });
}

export default pathsWith();
