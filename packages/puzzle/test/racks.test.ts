// Racks, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// racks, crate, score and chain after every move and call.
import { createRacksGame, DEFAULT_RACKS_CONFIG, racksHint, racksMovable, reduceRacks, type RacksConfig, type RacksMove, type RacksState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import racks, { rackOf, type CallMove, type ShiftMove, type Yard } from "../examples/racks.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

type Move = ShiftMove | CallMove;
const SEEDS = Number(process.env.SEEDS ?? 6);
const MOVES = Number(process.env.MOVES ?? 200);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: RacksConfig): Record<string, Setting> => ({
  racks: c.racks,
  height: c.height,
  kinds: c.kinds,
  startCells: c.startCells,
  crateLeast: c.crateMin,
  crateMost: c.crateMax,
  mixPercent: c.crateMixPercent,
  landEvery: c.landEvery,
  bagCopies: c.bagCopies,
  markRoom: c.markRoom,
  chainWindow: c.chainWindow,
  shipPoints: c.shipPoints,
  chainPercent: c.chainPercent,
  spillPoints: -c.spillPenalty,
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, RacksConfig> = {
  "as shipped": DEFAULT_RACKS_CONFIG,
  // Short racks of few kinds and quick crates: shipments chain, crates ship racks, and racks are smashed.
  "short racks and quick crates": { ...DEFAULT_RACKS_CONFIG, racks: 4, height: 3, kinds: 2, startCells: 6, crateMin: 1, crateMax: 3, crateMixPercent: 20, landEvery: 2, chainWindow: 2, chainPercent: [100, 150, 175], spillPenalty: 30 },
  "a long row with room marked": { ...DEFAULT_RACKS_CONFIG, racks: 7, height: 6, kinds: 5, startCells: 20, crateMixPercent: 100, landEvery: 6, markRoom: true, bagCopies: 2 },
};

const shippedBoard = (s: RacksState): (number | null)[][] =>
  Array.from({ length: s.config.height }, (_, y) => s.racks.map((rack) => { const c = rack[s.config.height - 1 - y]; return c ? c.kind + 1 : null; }));

describe("Racks on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same racks, crate, score and chain after every move: ${name}`, async () => {
      const seen = { ships: 0, byCrate: 0, spills: 0, chain: 0, calls: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createRacksGame(`seed-${seed}`, config);
        let round: Round<Move> = start(racks, { seed, settings: settingsOf(config), streams: { racks: seedFromString(`racks:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const yard = (now.state as { yard: Yard }).yard;
          expect(now.board.map((r) => r.map((p) => p?.kind ?? null)), where).toEqual(shippedBoard(shipped));
          expect(yard.crate, where).toEqual({ kinds: shipped.crate.cells.map((c) => c.kind + 1), rack: shipped.crate.rack, lands: shipped.crate.lands });
          expect(yard.bag, where).toEqual(shipped.bag.map((k) => k + 1));
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.combo);
          expect(now.stats, where).toMatchObject({ shipped: shipped.shipped, spills: shipped.spills, calls: shipped.calls });
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          // Mostly the move a tidy sorter makes, now and then any move, and a call now and then.
          const tidy = racksHint(shipped);
          const kind = pick(10);
          let move: RacksMove;
          if (kind === 0) move = { type: "call" };
          else if (tidy && kind > 3) move = tidy;
          else {
            const legal: RacksMove[] = [];
            for (let f = 0; f < config.racks; f++) for (let t = 0; t < config.racks; t++) if (racksMovable(shipped, f, t) > 0) legal.push({ type: "move", from: f, to: t });
            move = legal.length > 0 ? legal[pick(legal.length)]! : { type: "call" };
          }
          shipped = reduceRacks(shipped, move);
          round = play(round, move.type === "call" ? { move: "call" } : { move: "shift", from: (move as { from: number }).from, to: (move as { to: number }).to });
          const where = `seed ${seed}, move ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          for (const e of shipped.lastMove!.events) {
            if (e.type === "ship") (seen.ships++, (seen.chain = Math.max(seen.chain, e.chain))), e.byCrate && seen.byCrate++;
            if (e.type === "spill") seen.spills++;
          }
          if (move.type === "call") seen.calls++;
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.ships, "shipments").toBeGreaterThan(3);
      expect(seen.spills, "spills").toBeGreaterThan(0);
      expect(seen.calls, "calls").toBeGreaterThan(0);
      if (name === "short racks and quick crates") expect(seen.chain, "shipments in a row").toBeGreaterThan(1), expect(seen.byCrate, "racks a crate shipped").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Racks as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(racks, { seed });
      for (let m = 0; m < 60; m++) {
        const b = view(round).board;
        const legal: Move[] = [];
        for (let f = 0; f < b.width; f++) for (let t = 0; t < b.width; t++) if (f !== t && rackOf(b, f).length > 0 && rackOf(b, t).length < b.height) legal.push({ move: "shift", from: f, to: t });
        round = play(round, m % 9 === 8 || legal.length === 0 ? { move: "call" } : legal[m % legal.length]!);
        expect(round.last.refused).toBeNull();
      }
      expect(replay(racks, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a rack that is not there, an empty one to lift from, and a full one to set on", () => {
    const round = start(racks, { seed: 1, settings: { startCells: 0 } });
    expect(play(round, { move: "shift", from: 0, to: 9 }).last.refused).toBe("reason.no_rack");
    expect(play(round, { move: "shift", from: 0, to: 1 }).last.refused).toBe("reason.empty");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(racks)) as { payouts: { id: string }[]; multipliers: { id: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["ship", "spill"]);
    expect(doc.multipliers.map((m) => m.id)).toEqual(["chain"]);
    expect(doc.streak).toEqual({ builds: { event: "ship" }, counts: "events", grace: 0, breaksOn: ["spill", "lapse"] });
    expect(explain(racks)).toMatchInlineSnapshot(`
      "onStart    yard
      canMove    yard (shift)
      onMove     yard (shift, call)
      onMoveEnd  yard
      pointsFor  yard"
    `);
  });
});
