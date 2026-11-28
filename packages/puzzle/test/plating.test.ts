// Plating, played beside the engine the game ships. Both are dealt from the same luck, and are held to the same
// tray, breaches, plates, score and streak after every weld.
import { createPlatingGame, DEFAULT_PLATING_CONFIG, platingCheckPlacement, reducePlating, type PlatingConfig, type PlatingState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import plating, { weldOf, type Hull, type PlaceMove } from "../examples/plating.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting, type View } from "../src/index.js";

const settingsOf = (c: PlatingConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  maxMoves: c.maxMoves,
  metals: c.pieceKinds,
  breachesAtOnce: c.breachesAtOnce,
  breachLeast: c.minBreachPieces,
  breachMost: c.maxBreachPieces,
  widenAfter: c.growAfterMoves,
  basePerCell: c.basePerCell,
  flawlessPercent: c.multiplierPercent.flawless,
  solidPercent: c.multiplierPercent.solid,
  holdsPercent: c.multiplierPercent.holds,
  tapePercent: c.multiplierPercent.tape,
  gumPercent: c.multiplierPercent.gum,
  acrossPercent: 100 + c.brushBonusPercent,
  streakPercent: c.streakPercent,
});
const SEEDS = Number(process.env.SEEDS ?? 5);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
const WELDS = Number(process.env.WELDS ?? 120);
const CONFIGS: Record<string, PlatingConfig> = {
  "as shipped": DEFAULT_PLATING_CONFIG,
  // Breaches that widen after two plates elsewhere, crowded onto a small hull, so widening and the crowded deal both run.
  "a small hull that widens fast": { ...DEFAULT_PLATING_CONFIG, width: 7, height: 8, breachesAtOnce: 3, minBreachPieces: 1, maxBreachPieces: 2, growAfterMoves: 2, brushBonusPercent: 40, streakPercent: [100, 150, 210] },
  "one big breach at a time": { ...DEFAULT_PLATING_CONFIG, breachesAtOnce: 1, minBreachPieces: 2, maxBreachPieces: 4, basePerCell: 3, multiplierPercent: { flawless: 333, solid: 211, holds: 157, tape: 99, gum: 41 } },
};

/** What the shipped hull shows, cell by cell: whether a plate covers it, and whether it is breach. */
const shippedHull = (s: PlatingState): { covered: boolean[]; breach: boolean[] } => {
  const breach = s.covered.map(() => false);
  for (const b of s.breaches) for (const c of b.cells) breach[c] = true;
  return { covered: s.covered.map((n) => n > 0), breach };
};

describe("Plating on the new engine, beside the engine the game ships", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same tray, breaches, plates, score and streak after every weld: ${name}`, async () => {
      const seen = { welds: 0, flawless: 0, seals: 0, widened: 0, streak: 0, roundedApart: 0, across: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        // Each seed is seconds of work: let the worker answer its runner between them, or the runner times out.
        await breathe();
        let shipped = createPlatingGame(`seed-${seed}`, config);
        let round: Round<PlaceMove> = start(plating, { seed, settings: settingsOf(config), streams: { hull: seedFromString(`carpentry:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        let banked = 0;
        const level = (where: string): void => {
          const now = read(round);
          const hull = now.state as { hull: Hull };
          expect(hull.hull.tray.map((p) => ({ shape: p.shape, brush: p.brush === "across" ? "h" : "v", kind: p.kind })), where).toEqual(shipped.slots);
          expect(hull.hull.breaches.map((b) => b.cells), where).toEqual(shipped.breaches.map((b) => b.cells));
          const { covered, breach } = shippedHull(shipped);
          expect(now.board.flat().map(Boolean), where).toEqual(covered);
          expect(now.ground.flat().map((g) => g?.terrain === "breach"), where).toEqual(breach);
          expect(now.streak, where).toBe(shipped.combo);
          expect(now.score, where).toBe(banked);
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < WELDS && !shipped.finished; m++) {
          if (m % 10 === 9) await breathe();
          // Every weld the hull takes. Most moves take one that wastes least on the breach it works; the rest any at all.
          const legal: { slot: number; rot: number; flip: boolean; col: number; row: number; waste: number; laid: number }[] = [];
          for (let slot = 0; slot < 3; slot++)
            for (let rot = 0; rot < 4; rot++)
              for (const flip of [false, true])
                for (let row = -2; row < config.height; row++)
                  for (let col = -2; col < config.width; col++) {
                    const c = platingCheckPlacement(shipped, slot, rot, flip, col, row);
                    if (c.legal) legal.push({ slot, rot, flip, col, row, waste: c.wasteCells.length + c.overhang, laid: c.cells.length });
                  }
          const least = Math.min(...legal.map((l) => l.waste));
          const tidy = legal.filter((l) => l.waste === least);
          const chosen = pick(5) > 0 ? tidy[pick(tidy.length)]! : legal[pick(legal.length)]!;
          const before = shipped.score;
          shipped = reducePlating(shipped, { type: "place", slot: chosen.slot, rot: chosen.rot, flip: chosen.flip, col: chosen.col, row: chosen.row });
          round = play(round, { move: "place", slot: chosen.slot, rot: chosen.rot, flip: chosen.flip, x: chosen.col, y: chosen.row });
          const where = `seed ${seed}, weld ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          // The shipped engine rounds each seal to the nearest point. The loop rounds down once a move.
          const report = shipped.lastMove!;
          expect(shipped.score - before, where).toBe(report.points);
          expect(report.points - round.last.banked, where).toBeGreaterThanOrEqual(0);
          expect(report.points - round.last.banked, where).toBeLessThanOrEqual(1);
          if (report.points !== round.last.banked) seen.roundedApart++;
          banked += round.last.banked;
          level(where);
          seen.welds++;
          if (report.sealed?.rating === "flawless") seen.flawless++;
          else if (report.sealed) seen.seals++;
          if (report.sealed?.brushBonus) seen.across++;
          if (report.grown) seen.widened++;
          seen.streak = Math.max(seen.streak, shipped.combo);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.flawless, "flawless seals").toBeGreaterThan(1);
      expect(seen.seals, "lesser seals").toBeGreaterThan(5);
      // A breach widens only while another is worked, so a hull with one at a time never widens.
      if (config.breachesAtOnce > 1) expect(seen.widened, "breaches widened").toBeGreaterThan(0);
      expect(seen.across, "seals brushed across").toBeGreaterThan(0);
      if (name !== "one big breach at a time") expect(seen.streak, "flawless seals in a row").toBeGreaterThan(1);
    }, 120_000);
  }
});

describe("Plating as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 4; seed++) {
      let round = start(plating, { seed, settings: { maxMoves: 20 } });
      for (let m = 0; !read(round).ended; m++) {
        const hull = (read(round).state as { hull: Hull }).hull;
        const asked = Object.create(view(round), { state: { value: hull } }) as View<Hull>;
        const tries = Array.from({ length: 13 * 16 }, (_, i) => ({ move: "place" as const, slot: m % 3, rot: m % 4, flip: m % 2 === 0, x: ((i + m * 7) % 13) - 2, y: Math.floor(i / 13) - 2 }));
        round = play(round, tries.find((t) => weldOf(asked, t) !== null)!, { at: m * 1000 });
        expect(round.last.refused).toBeNull();
      }
      expect(read(round).ended).toBe("moves");
      expect(replay(plating, String(seed), { maxMoves: 20 }, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a weld that covers no open cell of a breach, and a slot the tray does not have", () => {
    const round = start(plating, { seed: 3 });
    const hull = (read(round).state as { hull: Hull }).hull;
    const asked = Object.create(view(round), { state: { value: hull } }) as View<Hull>;
    const places = Array.from({ length: 13 * 16 }, (_, i) => ({ move: "place" as const, slot: 0, rot: 0, flip: false, x: (i % 13) - 2, y: Math.floor(i / 13) - 2 }));
    const off = places.find((m) => weldOf(asked, m) === null)!;
    const on = places.find((m) => weldOf(asked, m) !== null)!;
    expect(play(round, off).last.refused).toBe("reason.no_breach");
    expect(play(round, on).last.refused).toBeNull();
    expect(play(round, { ...on, slot: 7 }).last.refused).toBe("reason.no_slot");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(plating)) as { payouts: { id: string }[]; multipliers: { id: string; on: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["flawless", "seal"]);
    expect(doc.multipliers.map((m) => m.id)).toEqual(["flawless", "solid", "holds", "tape", "gum", "across", "streak"]);
    expect(doc.streak).toEqual({ builds: { event: "flawless" }, counts: "events", grace: 0, breaksOn: ["seal"] });
    expect(explain(plating)).toMatchInlineSnapshot(`
      "onStart    hull
      canMove    hull (place)
      onMove     hull (place)
      onMoveEnd  hull"
    `);
  });
});
