// Scanner, played beside the engine the studio deals. Both are dealt from the same luck, and are held to the same
// sector, numbers, score and streak after every ping and lock.
import { createScannerGame, DEFAULT_SCANNER_CONFIG, reduceScanner, scannerHint, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import scanner, { type LockMove, type PingMove, type Sector } from "../examples/scanner.puzzle.js";
import { expand, explain, nextInt, play, read, replay, seedFromString, start, view, type Round, type Setting } from "../src/index.js";

type Move = PingMove | LockMove;
const SEEDS = Number(process.env.SEEDS ?? 6);
const MOVES = Number(process.env.MOVES ?? 200);
/** Hands the event loop back for a moment. */
const breathe = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/** The shipped table starts with what no streak multiplies by, always 100 here; the puzzle's starts at one clean sector. */
const settingsOf = (c: ScannerConfig): Record<string, Setting> => ({
  width: c.width,
  height: c.height,
  startContacts: c.startContacts,
  growEvery: c.growEvery,
  maxContacts: c.maxContacts,
  parBase: c.parBase,
  parPerContact: c.parPerContact,
  openingMin: c.openingMin,
  dealTries: c.dealTries,
  contactPoints: c.contactPoints,
  savePoints: c.savePoints,
  overPoints: -c.overPenalty,
  wrongPoints: -c.wrongPenalty,
  spookPoints: -c.spookPenalty,
  streakPercent: c.streakPercent.slice(1),
  maxMoves: c.maxMoves,
});
const CONFIGS: Record<string, ScannerConfig> = {
  "as shipped": DEFAULT_SCANNER_CONFIG,
  // A tight allowance and harsh costs: pings go past par, the score is driven to nothing, and clean sectors are rare.
  "a tight allowance": { ...DEFAULT_SCANNER_CONFIG, parBase: 1, parPerContact: 1, overPenalty: 25, wrongPenalty: 35, spookPenalty: 90, savePoints: 33, streakPercent: [100, 133, 177] },
  "a wide sector that grows": { ...DEFAULT_SCANNER_CONFIG, width: 8, height: 7, startContacts: 2, growEvery: 1, maxContacts: 6, openingMin: 4, dealTries: 3, parPerContact: 3, contactPoints: 55 },
};

describe("Scanner on the new engine, beside the engine the studio deals", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`holds the same sector, numbers, score and streak after every move: ${name}`, async () => {
      const seen = { found: 0, spooked: 0, wrong: 0, over: 0, clean: 0, unclean: 0, streak: 0, floored: 0 };
      for (let seed = 1; seed <= SEEDS; seed++) {
        await breathe();
        let shipped = createScannerGame(`seed-${seed}`, config);
        let round: Round<Move> = start(scanner, { seed, settings: settingsOf(config), streams: { sector: seedFromString(`scanner:seed-${seed}`) } });
        let picks = seedFromString(`picks-${seed}`);
        const pick = (n: number): number => {
          const r = nextInt(picks, n);
          picks = r.state;
          return r.value;
        };
        const level = (where: string): void => {
          const now = read(round);
          const s = (now.state as { sector: Sector }).sector;
          expect(s.contacts, where).toEqual(shipped.contacts);
          expect(s.found, where).toEqual(shipped.found);
          expect(s.spooked, where).toEqual(shipped.spooked);
          expect(s.pings, where).toEqual(shipped.pings);
          expect(s.misses, where).toEqual(shipped.misses);
          expect([s.spent, s.par], where).toEqual([shipped.spent, shipped.par]);
          expect(now.score, where).toBe(shipped.score);
          expect(now.streak, where).toBe(shipped.combo);
          expect(now.stats, where).toMatchObject({ sectors: shipped.sectorsCleared, found: shipped.contactsFound, pings: shipped.pingsMade });
        };
        level(`seed ${seed}, the deal`);
        for (let m = 0; m < MOVES && !shipped.finished; m++) {
          // Mostly a move the plain arguments make safe, now and then a guess.
          const safe = scannerHint(shipped);
          const kind = pick(10);
          let move: ScannerMove;
          if (safe && kind > 1) move = { type: safe.type, cell: safe.cell };
          else {
            const legal = (scanner.rules.listMoves!(view(round) as never) as Move[]).map((x) => ({ type: x.move, cell: x.at.y * config.width + x.at.x }) as ScannerMove);
            move = legal[pick(legal.length)]!;
          }
          const before = shipped.score;
          shipped = reduceScanner(shipped, move);
          const c = (move as { cell: number }).cell;
          round = play(round, { move: move.type as "ping", at: { x: c % config.width, y: Math.floor(c / config.width) } });
          const where = `seed ${seed}, move ${m + 1}`;
          expect(round.last.refused, where).toBeNull();
          const r = shipped.lastMove!;
          if (r.found) seen.found++;
          if (r.spooked) seen.spooked++;
          if (r.wrong) seen.wrong++;
          if (r.cost < 0 && r.wrong === false && r.spooked === false) seen.over++;
          if (r.cleared) r.cleared.clean ? seen.clean++ : seen.unclean++;
          if (r.cost < 0 && before + r.cost < 0) seen.floored++;
          seen.streak = Math.max(seen.streak, shipped.combo);
          level(where);
        }
      }
      // The comparison means something only if the rounds reached every rule.
      expect(seen.found, "contacts found").toBeGreaterThan(5);
      expect(seen.spooked + seen.wrong, "mistakes").toBeGreaterThan(0);
      expect(seen.clean, "clean sectors").toBeGreaterThan(0);
      expect(seen.unclean, "sectors cleared over par or with a mistake").toBeGreaterThan(0);
      if (name === "a tight allowance") expect(seen.over, "pings past par").toBeGreaterThan(0), expect(seen.floored, "costs the score could not cover").toBeGreaterThan(0);
      if (name === "as shipped") expect(seen.streak, "clean sectors in a row").toBeGreaterThan(1);
    }, 180_000);
  }
});

describe("Scanner as a puzzle of its own", () => {
  it("deals, plays and replays from its seed, settings and log", () => {
    for (let seed = 1; seed <= 3; seed++) {
      let round = start(scanner, { seed });
      for (let m = 0; m < 60; m++) {
        const moves = scanner.rules.listMoves!(view(round) as never) as Move[];
        round = play(round, moves[(m * 7) % moves.length]!);
        expect(round.last.refused).toBeNull();
      }
      expect(replay(scanner, String(seed), {}, round.log).state).toEqual(round.state);
    }
  });

  it("refuses a lock the numbers prove empty, and a second ping on one cell", () => {
    const round = start(scanner, { seed: 1 });
    const s = (view(round).state as { sector: Sector }).sector;
    const at = { x: s.pings[0]!.cell % 6, y: Math.floor(s.pings[0]!.cell / 6) };
    expect(play(round, { move: "lock", at }).last.refused).toBe("reason.proven_empty");
    expect(play(round, { move: "ping", at }).last.refused).toBe("reason.pinged");
  });

  it("is all there to read: its scoring declared, each hook explained", () => {
    const doc = JSON.parse(expand(scanner)) as { payouts: { id: string }[]; streak: unknown };
    expect(doc.payouts.map((p) => p.id)).toEqual(["find", "saved", "spook", "wrong", "over"]);
    expect(doc.streak).toEqual({ builds: { event: "clean" }, counts: "events", grace: 0, breaksOn: ["spook", "wrong", "cleared"] });
    expect(explain(scanner)).toMatchInlineSnapshot(`
      "onStart    sector
      canMove    sector (ping, lock)
      onMove     sector (ping, lock)
      listMoves  sector
      pointsFor  sector"
    `);
  });
});
