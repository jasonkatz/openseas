// Pouring, played beside the engine the studio deals. Both are dealt from the same luck, the rivals take their turns
// from it in both, and the two are held to the same bar, rings, hands, seats and score after every move.
import { createPouringGame, DEFAULT_POURING_CONFIG, pouringHint, reducePouring, type PouringConfig, type PouringMove, type PouringPiece, type PouringState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import pouring, { barOf, type DrinkMove, type PourMove, type Tavern } from "../examples/pouring.puzzle.js";
import { expand, explain, listMoves, nextInt, play, read, replay, seedFromString, start, type Round, type Setting } from "../src/index.js";

const SEEDS = Number(process.env.SEEDS ?? 30);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

const settingsOf = (c: PouringConfig): Record<string, Setting> => ({ ...c } as unknown as Record<string, Setting>);
const CONFIGS: Record<string, PouringConfig> = {
  "as shipped": DEFAULT_POURING_CONFIG,
  // Alone at a small bar, many rags and ice: lines served often, wipes and tosses.
  "alone, a small bar": { ...DEFAULT_POURING_CONFIG, size: 5, rivals: 0, ragsPerBag: 4, icePerBag: 4, glasses: 2, brews: 3, lastCall: 60, maxMoves: 200 },
  // Three careless rivals, a low tolerance, wide hands: pirates out cold, turns lost.
  "three rivals, low tolerance": { ...DEFAULT_POURING_CONFIG, size: 7, rivals: 3, rivalSkill: 20, tolerance: 1, soberAfter: 5, offer: 3, glasses: 6, brews: 6, cleanPercent: 150, lastCall: 15 },
};

const strip = (p: PouringPiece | null) => (p ? { kind: p.kind, glass: p.glass, brew: p.brew } : null);

describe("Pouring on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same bar, rings, hands, seats and score, move for move: ${name}`, async () => {
      const seen = { served: 0, clean: 0, double: 0, wipes: 0, drinks: 0, sleeps: 0, tosses: 0, rounds: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped: PouringState = createPouringGame(`seed-${seed}`, config);
        let round: Round<PourMove | DrinkMove> = start(pouring, { seed, settings: settingsOf(config), streams: { bag: seedFromString(`seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const t = (now.state as { tavern: Tavern }).tavern;
          expect(now.board.flat().map((p) => (p ? (p.piece === "ice" ? "ice" : p.state) : null)), where).toEqual(shipped.cells.map((p) => (p ? (p.kind === "ice" ? "ice" : p.glass * 6 + p.brew) : null)));
          expect(t.rings, where).toEqual(shipped.rings);
          expect(t.bag, where).toEqual(shipped.bag.map(strip));
          expect(t.seats.map((s) => ({ ...s, hand: s.hand.map((h) => ({ piece: h.piece, age: h.age })) })), where).toEqual(shipped.seats.map((s) => ({ ...s, hand: s.hand.map((h) => ({ piece: strip(h.piece), age: h.age })) })));
          expect(now.score, where).toBe(shipped.score);
          expect(now.stats.bestCombo, where).toBe(shipped.bestCombo);
        };
        level(`seed ${seed}, the deal`);
        while (!shipped.finished) {
          const where = `seed ${seed}, move ${shipped.moveCount + 1}`;
          // Mostly the careful rating's best, now and then any pour that fits, or a drink downed.
          const hint = pouringHint(shipped);
          const listed = listMoves(round);
          const pours = listed.filter((m): m is PourMove => m.move === "pour");
          const kind = pick(10);
          const move: PouringMove = hint && kind < 6 ? { type: "pour", ...hint } : pours.length > 0 && kind < 9 ? (() => { const p = pours[pick(pours.length)]!; return { type: "pour" as const, slot: p.slot, cell: p.at.y * config.size + p.at.x }; })() : { type: "drink", slot: pick(config.offer) };
          shipped = reducePouring(shipped, move);
          round = play(round, move.type === "pour" ? { move: "pour", slot: move.slot, at: { x: move.cell % config.size, y: Math.floor(move.cell / config.size) } } : { move: "drink", slot: (move as { slot: number }).slot });
          expect(round.last.refused, where).toBeNull();
          for (const a of shipped.lastMove!.acts) {
            if (a.lines.length > 0) seen.served++, a.clean && seen.clean++, a.lines.length > 1 && seen.double++;
            if (a.type === "wipe") seen.wipes++;
            if (a.type === "drink") seen.drinks++;
            if (a.type === "sleep") seen.sleeps++;
            if (a.type === "toss") seen.tosses++;
          }
          level(where);
        }
        if (shipped.moveCount < config.maxMoves) seen.rounds++, expect(listMoves(round), `seed ${seed}, last call`).toEqual([]);
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.served, "lines served").toBeGreaterThan(0);
      expect(seen.clean, "lines served on a clean square").toBeGreaterThan(0);
      expect(seen.drinks, "drinks downed").toBeGreaterThan(0);
      expect(seen.rounds, "rounds to last call").toBe(SEEDS);
      if (name === "as shipped") expect(seen.double, "two lines at once").toBeGreaterThan(0);
      if (name === "alone, a small bar") expect(seen.wipes + seen.tosses, "rags used").toBeGreaterThan(0);
      if (name === "three rivals, low tolerance") expect(seen.sleeps, "turns lost out cold").toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("Pouring as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(pouring, { seed });
      for (let m = 0; m < 30 && listMoves(round).length > 0; m++) {
        const moves = listMoves(round);
        round = play(round, moves[(m * 13) % moves.length]!);
      }
      expect(read(round).score).toBeGreaterThan(0);
      expect(replay(pouring, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a slot not in hand", () => {
    const round = start(pouring, { seed: 1 });
    expect(play(round, { move: "drink", slot: 5 }).last.refused).toBe("reason.no_slot");
    expect(play(round, { move: "pour", slot: 5, at: { x: 0, y: 0 } }).last.refused).toBe("reason.no_slot");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(pouring)) as { payouts: { id: string }[] };
    expect(doc.payouts.map((p) => p.id)).toEqual(["drink", "age", "ring", "lines"]);
    expect(explain(pouring)).toMatchInlineSnapshot(`
      "onStart    tavern
      canMove    tavern (drink, pour)
      onMove     tavern (pour, drink)
      listMoves  tavern
      pointsFor  tavern"
    `);
  });
});
