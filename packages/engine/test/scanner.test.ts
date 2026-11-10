import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_SCANNER_CONFIG,
  InvalidMoveError,
  createScannerGame,
  hashScannerState,
  reduceScanner,
  SCANNER_DEF,
  replayLog,
  scannerClearCells,
  scannerContactsFor,
  scannerContactsLeft,
  scannerDistance,
  scannerHint,
  scannerLockIllegalReason,
  scannerLockValue,
  scannerParFor,
  scannerPingCandidates,
  scannerPingIllegalReason,
  scannerPingsLeft,
  scannerPlainlySolvable,
  scannerProvenCells,
  scannerRingCells,
  scannerSaveValue,
  scannerViewString,
  type ScannerConfig,
  type ScannerMove,
  type ScannerState,
} from "../src/index.js";

const cfg = DEFAULT_SCANNER_CONFIG;

/** A legal move picked by two numbers: a ping or a lock on the first cell from a picked start that takes it. Careless of what is hidden, so it spooks and misses. */
function randomMove(state: ScannerState, a: number, b: number): ScannerMove | null {
  const n = state.config.width * state.config.height;
  const lock = a % 4 === 0;
  for (let k = 0; k < n; k++) {
    const cell = (b + k) % n;
    if (lock ? scannerLockIllegalReason(state, cell) === null : scannerPingIllegalReason(state, cell) === null) return { type: lock ? "lock" : "ping", cell };
  }
  return null;
}

function playRandom(seed: string, picks: readonly number[], config: ScannerConfig = cfg): { moves: ScannerMove[]; state: ScannerState } {
  let state = createScannerGame(seed, config);
  const moves: ScannerMove[] = [];
  for (let i = 0; i + 2 <= picks.length && !state.finished; i += 2) {
    const m = randomMove(state, picks[i]!, picks[i + 1]!);
    if (!m) break;
    moves.push(m);
    state = reduceScanner(state, m);
  }
  return { moves, state };
}

const picksArb = fc.array(fc.nat({ max: 10_000 }), { minLength: 0, maxLength: 160 });

/** A sector from rows of characters: `C` a hidden contact, `p` the opening ping, `.` nothing. */
function sector(rows: readonly string[], over: Partial<ScannerConfig> = {}): ScannerState {
  const text = rows.join("");
  const contacts = [...text].flatMap((ch, i) => (ch === "C" ? [i] : []));
  const config: ScannerConfig = { ...cfg, width: rows[0]!.length, height: rows.length, startContacts: contacts.length, maxContacts: contacts.length, ...over };
  const base = createScannerGame("t", config);
  const pings = [...text].flatMap((ch, i) => (ch === "p" ? [{ cell: i, distance: Math.min(...contacts.map((c) => scannerDistance(config, i, c))), opening: true }] : []));
  return { ...base, contacts, pings };
}

const hidden = (s: ScannerState): number[] => s.contacts.filter((c) => !s.found.includes(c) && !s.spooked.includes(c));
const nearestHidden = (s: ScannerState, cell: number): number => Math.min(...hidden(s).map((c) => scannerDistance(s.config, cell, c)));

/** The idle hint, played until `sectors` are cleared: the plain arguments and nothing else. */
function playHints(seed: string, sectors: number, config: ScannerConfig = cfg): ScannerState {
  let s = createScannerGame(seed, config);
  while (s.sectorsCleared < sectors) {
    const h = scannerHint(s);
    if (!h) throw new Error(`stuck in sector ${s.sector} of ${seed}`);
    s = reduceScanner(s, h);
  }
  return s;
}

describe("scanner sector", () => {
  it("opens with its contacts hidden and one ping made on empty space, away from all of them", () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const s = createScannerGame(seed);
        expect(s.contacts.length).toBe(cfg.startContacts);
        expect(new Set(s.contacts).size).toBe(s.contacts.length);
        expect([...s.contacts].sort((a, b) => a - b)).toEqual(s.contacts);
        expect(s.pings.length).toBe(1);
        const open = s.pings[0]!;
        expect(open.opening).toBe(true);
        expect(s.contacts).not.toContain(open.cell);
        expect(open.distance).toBe(nearestHidden(s, open.cell));
        // As far as asked, or as far as the sector has.
        const farthest = Math.max(...Array.from({ length: cfg.width * cfg.height }, (_, c) => nearestHidden(s, c)));
        expect(open.distance).toBeGreaterThanOrEqual(Math.min(cfg.openingMin, farthest));
        expect(s.par).toBe(scannerParFor(cfg, cfg.startContacts));
        expect({ score: s.score, spent: s.spent, found: s.found, spooked: s.spooked, misses: s.misses, finished: s.finished }).toEqual({ score: 0, spent: 0, found: [], spooked: [], misses: [], finished: false });
      }),
    );
  });

  it("rejects an invalid config", () => {
    expect(() => createScannerGame("x", { ...cfg, width: 2 })).toThrow();
    expect(() => createScannerGame("x", { ...cfg, startContacts: 6, maxContacts: 5 })).toThrow();
    expect(() => createScannerGame("x", { ...cfg, maxContacts: 13 })).toThrow();
    expect(() => createScannerGame("x", { ...cfg, width: 3, height: 3, maxContacts: 4 })).toThrow();
    expect(() => createScannerGame("x", { ...cfg, parBase: 0, parPerContact: 0 })).toThrow();
    expect(() => createScannerGame("x", { ...cfg, dealTries: 0 })).toThrow();
    expect(() => createScannerGame("x", { ...cfg, streakPercent: [] })).toThrow();
  });
});

describe("scanner determinism (ADR 0003)", () => {
  it("same seed and same move log give the same state and hash", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        const { moves, state } = playRandom(seed, picks);
        const replayed = replayLog(SCANNER_DEF, seed, cfg, moves).final;
        expect(hashScannerState(replayed)).toBe(hashScannerState(state));
        expect(replayed).toEqual(state);
      }),
      { numRuns: 60 },
    );
  });

  it("different seeds deal different openings", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 50; i++) hashes.add(hashScannerState(createScannerGame(`seed-${i}`)));
    expect(hashes.size).toBe(50);
  });

  it("reduce never mutates its input", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, fc.nat(), fc.nat(), (seed, picks, a, b) => {
        const { state } = playRandom(seed, picks.slice(0, 40));
        const before = JSON.stringify(state);
        const m = randomMove(state, a, b);
        if (m) reduceScanner(state, m);
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it("an end move finishes an untouched round at zero", () => {
    const s = reduceScanner(createScannerGame("x"), { type: "end" });
    expect(s.finished).toBe(true);
    expect({ score: s.score, moves: s.moveCount, bestCombo: s.bestCombo }).toEqual({ score: 0, moves: 0, bestCombo: 0 });
    expect(() => reduceScanner(s, { type: "end" })).toThrow(InvalidMoveError);
  });
});

describe("scanner rules", () => {
  it("keeps the sector's invariants after every move, and what it shows never gives a hidden contact away", () => {
    fc.assert(
      fc.property(fc.string(), picksArb, (seed, picks) => {
        let state = createScannerGame(seed);
        for (let i = 0; i + 2 <= picks.length; i += 2) {
          const m = randomMove(state, picks[i]!, picks[i + 1]!);
          if (!m) break;
          const next = reduceScanner(state, m);
          const r = next.lastMove!;
          // The score is what the report says, and never negative.
          expect(next.score).toBe(state.score + r.points);
          expect(next.score).toBeGreaterThanOrEqual(0);
          expect(r.cost).toBeLessThanOrEqual(0);
          expect([r.found, r.wrong, r.spooked].filter(Boolean).length).toBeLessThanOrEqual(1);
          // Every number on the board is true of what is still hidden.
          const left = hidden(next);
          expect(left.length).toBeGreaterThan(0);
          expect(scannerContactsLeft(next)).toBe(left.length);
          for (const p of next.pings) {
            expect(next.contacts).not.toContain(p.cell);
            expect(p.distance).toBe(nearestHidden(next, p.cell));
          }
          // A cell proven empty holds nothing, a cell proven taken holds a hidden contact, and the hint is a move no one could regret.
          const clear = scannerClearCells(next);
          for (const c of left) expect(clear[c]).toBe(false);
          for (const c of scannerProvenCells(next)) expect(left).toContain(c);
          const h = scannerHint(next);
          if (h?.type === "lock") expect(left).toContain(h.cell);
          if (h?.type === "ping") {
            expect(next.contacts).not.toContain(h.cell);
            expect(scannerPingIllegalReason(next, h.cell)).toBeNull();
          }
          // The view shows fog over every hidden contact, whatever else it shows.
          const view = scannerViewString(next);
          expect(view.length).toBe(cfg.width * cfg.height);
          for (const c of left) expect(view[c]).toBe(".");
          state = next;
        }
      }),
      { numRuns: 80 },
    );
  });

  it("a ping answers with the steps to the nearest hidden contact, and shades what that proves empty", () => {
    const s0 = sector([".C...", ".....", ".....", "...p.", "....C"]);
    expect(s0.pings[0]).toEqual({ cell: 18, distance: 2, opening: true });
    expect(scannerRingCells(s0.config, 18, 2)).toEqual([8, 12, 14, 16, 22, 24]);
    // Everything nearer than two steps is empty, the pinged cell included.
    expect(scannerClearCells(s0).flatMap((c, i) => (c ? [i] : []))).toEqual([13, 17, 18, 19, 23]);
    expect(scannerViewString(s0)).toBe("....." + "....." + "...-." + "..-2-" + "...-.");
    const s1 = reduceScanner(s0, { type: "ping", cell: 19 });
    expect(s1.lastMove).toMatchObject({ distance: 1, found: false, wrong: false, spooked: false, cost: 0, points: 0, resound: [], cleared: null });
    expect(s1.pings[1]).toEqual({ cell: 19, distance: 1, opening: false });
    expect(s1.spent).toBe(1);
    expect(scannerPingsLeft(s1)).toBe(3);
    // Two cells of its ring could still hold the contact it hears: nothing is proven yet.
    expect(scannerPingCandidates(s1, s1.pings[1]!)).toEqual([14, 24]);
    expect(scannerProvenCells(s1)).toEqual([]);
    // A ping on one of them leaves a single cell.
    const s2 = reduceScanner(s1, { type: "ping", cell: 14 });
    expect(s2.lastMove!.distance).toBe(2);
    expect(scannerPingCandidates(s2, s2.pings[1]!)).toEqual([24]);
    expect(scannerProvenCells(s2)).toEqual([24]);
    expect(scannerHint(s2)).toEqual({ type: "lock", cell: 24 });
  });

  it("a lock on a contact finds it for the bounty, and every ping that heard it sounds again", () => {
    let s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    s = reduceScanner(s, { type: "ping", cell: 19 });
    s = reduceScanner(s, { type: "ping", cell: 14 });
    expect(scannerLockValue(s)).toBe(cfg.contactPoints);
    s = reduceScanner(s, { type: "lock", cell: 24 });
    const r = s.lastMove!;
    expect(r).toMatchObject({ found: true, wrong: false, spooked: false, distance: null, findPoints: cfg.contactPoints, cost: 0, points: cfg.contactPoints, cleared: null });
    // All three pings were hearing the contact at 24; the one left is at cell 1.
    expect(r.resound).toEqual([
      { cell: 18, from: 2, to: 5 },
      { cell: 19, from: 1, to: 6 },
      { cell: 14, from: 2, to: 5 },
    ]);
    expect(s.pings.map((p) => p.distance)).toEqual([5, 6, 5]);
    expect(s.found).toEqual([24]);
    expect(s.spent).toBe(2);
    expect(scannerViewString(s)[24]).toBe("X");
    // The found contact is no candidate any more, and no ping or lock goes on it.
    expect(scannerPingIllegalReason(s, 24)).toBe("a contact is already known there");
    expect(scannerLockIllegalReason(s, 24)).toBe("a contact is already known there");
    // Cells 1 and 5 lie as far from every ping as each other: one more ping tells them apart.
    expect(scannerPingCandidates(s, s.pings[0]!)).toEqual([1, 5]);
    expect(scannerProvenCells(s)).toEqual([]);
    s = reduceScanner(s, { type: "ping", cell: 2 });
    expect(scannerProvenCells(s)).toEqual([1]);
  });

  it("a clean sector pays for the pings left over, builds the streak, and the next is dealt", () => {
    let s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    for (const m of [
      { type: "ping", cell: 19 },
      { type: "ping", cell: 14 },
      { type: "lock", cell: 24 },
      { type: "ping", cell: 2 },
    ] as const)
      s = reduceScanner(s, m);
    expect(scannerSaveValue(s)).toBe(cfg.savePoints);
    const before = s;
    s = reduceScanner(s, { type: "lock", cell: 1 });
    const r = s.lastMove!;
    // Three pings of a par of four: one saved.
    expect(r.cleared).toEqual({ sector: 0, contacts: [1, 24], pings: 3, par: 4, saved: 1, bonus: cfg.savePoints, clean: true, streak: 1 });
    expect(r.resound).toEqual([]);
    expect(r.points).toBe(cfg.contactPoints + cfg.savePoints);
    expect(s.score).toBe(2 * cfg.contactPoints + cfg.savePoints);
    expect({ combo: s.combo, bestCombo: s.bestCombo, sectorsCleared: s.sectorsCleared, cleanSectors: s.cleanSectors, pingsSaved: s.pingsSaved, contactsFound: s.contactsFound }).toEqual({ combo: 1, bestCombo: 1, sectorsCleared: 1, cleanSectors: 1, pingsSaved: 1, contactsFound: 2 });
    // A new sector: new contacts, one opening ping, nothing spent.
    expect(s.sector).toBe(1);
    expect(s.contacts.length).toBe(2);
    expect({ found: s.found, spooked: s.spooked, misses: s.misses, spent: s.spent }).toEqual({ found: [], spooked: [], misses: [], spent: 0 });
    expect(s.pings.length).toBe(1);
    expect(s.pings[0]!.opening).toBe(true);
    expect(s.rng).not.toEqual(before.rng);
    // The streak multiplies the next bounty and the next saving.
    expect(scannerLockValue(s)).toBe(Math.floor((cfg.contactPoints * cfg.streakPercent[1]!) / 100));
    expect(scannerSaveValue(s)).toBe(Math.floor((cfg.savePoints * cfg.streakPercent[1]!) / 100));
    const next = reduceScanner(s, { type: "lock", cell: s.contacts[0]! });
    expect(next.lastMove!.findPoints).toBe(Math.floor((cfg.contactPoints * cfg.streakPercent[1]!) / 100));
    expect(next.lastMove!.streakPercent).toBe(cfg.streakPercent[1]);
  });

  it("a lock on empty space costs points and the streak, and marks the cell empty", () => {
    let s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    s = { ...s, score: 100, combo: 3, bestCombo: 3 };
    s = reduceScanner(s, { type: "lock", cell: 0 });
    expect(s.lastMove).toMatchObject({ wrong: true, found: false, cost: -cfg.wrongPenalty, points: -cfg.wrongPenalty, findPoints: 0 });
    expect({ score: s.score, combo: s.combo, bestCombo: s.bestCombo, wrongLocks: s.wrongLocks, misses: s.misses }).toEqual({ score: 100 - cfg.wrongPenalty, combo: 0, bestCombo: 3, wrongLocks: 1, misses: [0] });
    expect(scannerClearCells(s)[0]).toBe(true);
    expect(scannerViewString(s)[0]).toBe("!");
    // No second lock there, though a ping is still to be had.
    expect(scannerLockIllegalReason(s, 0)).toBe("nothing can be there");
    expect(scannerPingIllegalReason(s, 0)).toBeNull();
    // The sector is no longer clean: it pays nothing for the pings left and builds no streak.
    s = reduceScanner(s, { type: "lock", cell: 1 });
    s = reduceScanner(s, { type: "lock", cell: 24 });
    expect(s.lastMove!.cleared).toMatchObject({ clean: false, saved: 0, bonus: 0, streak: 0, pings: 0 });
    expect(s.combo).toBe(0);
    // The score never goes below zero.
    const poor = reduceScanner(sector(["C.p", "...", "..."]), { type: "lock", cell: 4 });
    expect(poor.score).toBe(0);
    expect(poor.lastMove).toMatchObject({ cost: -cfg.wrongPenalty, points: 0 });
  });

  it("a ping that lands on a contact spooks it: no bounty, a cost, the streak gone, and the pings that heard it sound again", () => {
    let s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    s = { ...s, score: 200, combo: 2, bestCombo: 2 };
    s = reduceScanner(s, { type: "ping", cell: 24 });
    const r = s.lastMove!;
    expect(r).toMatchObject({ spooked: true, found: false, wrong: false, distance: 0, findPoints: 0, cost: -cfg.spookPenalty, points: -cfg.spookPenalty });
    expect(r.resound).toEqual([{ cell: 18, from: 2, to: 5 }]);
    expect({ spooked: s.spooked, found: s.found, spent: s.spent, combo: s.combo, contactsSpooked: s.contactsSpooked, pings: s.pings.length }).toEqual({ spooked: [24], found: [], spent: 1, combo: 0, contactsSpooked: 1, pings: 1 });
    expect(scannerViewString(s)[24]).toBe("S");
    expect(scannerContactsLeft(s)).toBe(1);
    s = reduceScanner(s, { type: "lock", cell: 1 });
    expect(s.lastMove!.cleared).toMatchObject({ clean: false, saved: 0, bonus: 0, streak: 0 });
    expect(s.contactsFound).toBe(1);
  });

  it("each ping past par costs, and a sector cleared past par is not clean", () => {
    let s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    s = { ...s, score: 100, combo: 1, bestCombo: 1 };
    for (const cell of [19, 23, 17, 13]) {
      s = reduceScanner(s, { type: "ping", cell });
      expect(s.lastMove!.cost).toBe(0);
    }
    expect(scannerPingsLeft(s)).toBe(0);
    s = reduceScanner(s, { type: "ping", cell: 14 });
    expect(s.lastMove).toMatchObject({ cost: -cfg.overPenalty, points: -cfg.overPenalty });
    expect(scannerPingsLeft(s)).toBe(-1);
    // Going past par is no mistake: the streak holds until the sector is cleared without being clean.
    expect(s.combo).toBe(1);
    s = reduceScanner(s, { type: "lock", cell: 24 });
    expect(s.lastMove!.findPoints).toBe(Math.floor((cfg.contactPoints * cfg.streakPercent[1]!) / 100));
    s = reduceScanner(s, { type: "lock", cell: 1 });
    expect(s.lastMove!.cleared).toMatchObject({ clean: false, pings: 5, par: 4, saved: 0, bonus: 0, streak: 0 });
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(1);
  });

  it("refuses moves that are off the field, repeated or of no kind", () => {
    const s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    const bad = (m: ScannerMove): void => {
      expect(() => reduceScanner(s, m)).toThrow(InvalidMoveError);
    };
    bad({ type: "ping", cell: -1 });
    bad({ type: "ping", cell: 25 });
    bad({ type: "ping", cell: 1.5 });
    bad({ type: "ping", cell: 18 });
    bad({ type: "lock", cell: 99 });
    // A lock on a cell the numbers prove empty is refused, not punished.
    bad({ type: "lock", cell: 18 });
    bad({ type: "lock", cell: 19 });
    bad({ type: "bogus" } as unknown as ScannerMove);
  });

  it("sectors grow by a contact every few cleared, up to the cap, and par grows with them", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 40].map((n) => scannerContactsFor(cfg, n))).toEqual([3, 3, 4, 4, 5, 5, 5, 5]);
    expect([3, 4, 5].map((k) => scannerParFor(cfg, k))).toEqual([6, 8, 10]);
    const s = playHints("grow", 5);
    expect(s.sector).toBe(5);
    expect(s.contacts.length).toBe(5);
    expect(s.par).toBe(10);
  });

  it("every sector dealt can be cleared by the plain arguments alone, with no guess", () => {
    for (let i = 0; i < 12; i++) {
      // The hint only ever pings a cell proven empty and locks a cell proven taken; it is never stuck.
      let s = createScannerGame(`plain-${i}`);
      for (let n = 0; n < 300; n++) {
        if (s.lastMove === null || s.lastMove.cleared !== null) expect(scannerPlainlySolvable(s)).toBe(true);
        const h = scannerHint(s);
        expect(h).not.toBeNull();
        s = reduceScanner(s, h!);
      }
      expect(s.sectorsCleared).toBeGreaterThan(15);
      expect({ wrong: s.wrongLocks, spooked: s.contactsSpooked }).toEqual({ wrong: 0, spooked: 0 });
      expect(s.contactsFound).toBeGreaterThan(60);
    }
  });

  it("deals again when the plain arguments cannot clear a sector, and takes the first deal when told to", () => {
    const dense: ScannerConfig = { ...cfg, startContacts: 6, maxContacts: 6 };
    let stuck = 0;
    for (let i = 0; i < 200; i++) {
      if (!scannerPlainlySolvable(createScannerGame(`deal-${i}`, { ...dense, dealTries: 1 }))) stuck++;
      expect(scannerPlainlySolvable(createScannerGame(`deal-${i}`, { ...dense, dealTries: 50 }))).toBe(true);
    }
    // Six contacts in a sector of thirty-six: a first deal needs a guess often enough to matter.
    expect(stuck).toBeGreaterThan(5);
    // With no opening ping there is nothing to reason from, and the first deal stands.
    const blind = createScannerGame("blind", { ...cfg, openingMin: 0 });
    expect(blind.pings).toEqual([]);
    expect(scannerHint(blind)).toBeNull();
  });

  it("stops at the move cap", () => {
    const config: ScannerConfig = { ...cfg, maxMoves: 2 };
    let s = createScannerGame("cap", config);
    s = reduceScanner(s, scannerHint(s)!);
    expect(s.finished).toBe(false);
    s = reduceScanner(s, scannerHint(s)!);
    expect(s.finished).toBe(true);
    expect(scannerHint(s)).toBeNull();
    expect(() => reduceScanner(s, { type: "ping", cell: 0 })).toThrow(InvalidMoveError);
  });

  it("the view string names every cell the player can see", () => {
    let s = sector([".C...", ".....", ".....", "...p.", "....C"]);
    s = reduceScanner(s, { type: "lock", cell: 0 });
    s = reduceScanner(s, { type: "ping", cell: 19 });
    s = reduceScanner(s, { type: "lock", cell: 24 });
    // A wrong lock, the two pings saying how far the contact left is, the cells they prove empty, and the found contact.
    expect(scannerViewString(s)).toBe("!.---" + ".----" + "-----" + "---56" + "----X");
  });
});
