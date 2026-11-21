/**
 * Scanner for the bots: a choice is one ping or one lock, on any cell the engine takes it on. The
 * sector holds contacts the player cannot see, so the game is not open: the one-move and rollout
 * bots would read them by trying a move, and are not run. Every bot here decides from what a player
 * sees: the pings and what they say now and whether each is lit, the misses, the contacts known, and
 * how many are left.
 */
import {
  SCANNER_DEF,
  scannerClearCells,
  scannerContactsLeft,
  scannerDistance,
  scannerHint,
  scannerKnownContacts,
  scannerLockIllegalReason,
  scannerMarkOpen,
  scannerPingAt,
  scannerPingCandidates,
  scannerPingIllegalReason,
  scannerProvenCells,
  scannerPingsLeft,
  type ScannerConfig,
  type ScannerMove,
  type ScannerState,
} from "@openseas/engine";
import type { Bot, BotGame, Choice } from "../core.js";

/** A person's pace, from the tuning notes: 2.6 s a ping (a ring read first) and 1.4 s a lock. */
const SECONDS_PER_PING = 2.6;
const SECONDS_PER_LOCK = 1.4;
/** The most placements the splitter lists before it falls back on the plain player's ping. */
const PLACEMENT_LIMIT = 40_000;

const ping = (cell: number): Choice<ScannerMove> => ({ moves: [{ type: "ping", cell }] });
const lock = (cell: number): Choice<ScannerMove> => ({ moves: [{ type: "lock", cell }] });
const cellCount = (s: ScannerState): number => s.config.width * s.config.height;

/** Every ping and every lock the engine would take now. */
function allChoices(s: ScannerState): Choice<ScannerMove>[] {
  if (s.finished || scannerContactsLeft(s) === 0) return [];
  const out: Choice<ScannerMove>[] = [];
  for (let c = 0; c < cellCount(s); c++) {
    if (scannerPingIllegalReason(s, c) === null) out.push(ping(c));
    if (scannerLockIllegalReason(s, c) === null) out.push(lock(c));
  }
  return out;
}

/** The cells a hidden contact could be in: neither proven empty nor a contact already known. */
function fogCells(s: ScannerState): number[] {
  const clear = scannerClearCells(s);
  const known = new Set(scannerKnownContacts(s));
  const out: number[] = [];
  for (let c = 0; c < clear.length; c++) if (!clear[c] && !known.has(c)) out.push(c);
  return out;
}

/** When the hint has nothing to say (rare): lock the likeliest cell of the ring with fewest left. */
function lastResort(s: ScannerState, ctx: { rng: { pick<T>(xs: readonly T[]): T } }): Choice<ScannerMove> | null {
  let tightest: number[] | null = null;
  for (const p of s.pings) {
    const cand = scannerPingCandidates(s, p);
    if (cand.length > 0 && (tightest === null || cand.length < tightest.length)) tightest = cand;
  }
  const pool = tightest ?? fogCells(s);
  return pool.length ? lock(ctx.rng.pick(pool)) : null;
}

/**
 * Every way the hidden contacts could lie that agrees with what the player sees: `left` fog cells
 * such that each ping's ring holds one of them (the clear cells already say none lies nearer).
 * Null when there are more than `limit`.
 */
function placements(s: ScannerState, limit: number): number[][] | null {
  const fog = fogCells(s);
  const left = scannerContactsLeft(s);
  const rings = s.pings.map((p) => new Set(scannerPingCandidates(s, p)));
  // For each ping, the last fog index on its ring: past it the ring can no longer be met.
  const lastOn = rings.map((ring) => {
    let last = -1;
    fog.forEach((c, i) => {
      if (ring.has(c)) last = i;
    });
    return last;
  });
  const out: number[][] = [];
  const chosen: number[] = [];
  const met = rings.map(() => 0);
  let over = false;
  const walk = (from: number): void => {
    if (over) return;
    if (chosen.length === left) {
      if (met.every((m) => m > 0)) {
        out.push(chosen.slice());
        if (out.length > limit) over = true;
      }
      return;
    }
    for (let i = from; i <= fog.length - (left - chosen.length); i++) {
      // A ring not yet met whose last fog cell is behind us can never be met now.
      if (met.some((m, r) => m === 0 && lastOn[r]! < i)) return;
      const c = fog[i]!;
      rings.forEach((ring, r) => {
        if (ring.has(c)) met[r]!++;
      });
      chosen.push(c);
      walk(i + 1);
      chosen.pop();
      rings.forEach((ring, r) => {
        if (ring.has(c)) met[r]!--;
      });
      if (over) return;
    }
  };
  walk(0);
  return over ? null : out;
}

/** The cell a ping would split the placements over most evenly: the least expected placements left. */
function bestSplit(s: ScannerState, places: readonly number[][], rng: { pick<T>(xs: readonly T[]): T }): number | null {
  const cfg = s.config;
  const inAny = new Set<number>();
  for (const p of places) for (const c of p) inAny.add(c);
  const safe: number[] = [];
  for (let c = 0; c < cellCount(s); c++) if (!inAny.has(c) && scannerPingIllegalReason(s, c) === null) safe.push(c);
  if (safe.length === 0) return null;
  let bestCells: number[] = [];
  let bestCost = Infinity;
  for (const c of safe) {
    const groups = new Map<number, number>();
    for (const p of places) {
      let d = Infinity;
      for (const k of p) d = Math.min(d, scannerDistance(cfg, c, k));
      groups.set(d, (groups.get(d) ?? 0) + 1);
    }
    let cost = 0;
    for (const n of groups.values()) cost += n * n;
    if (cost < bestCost) {
      bestCost = cost;
      bestCells = [c];
    } else if (cost === bestCost) bestCells.push(c);
  }
  return rng.pick(bestCells);
}

/** How often each fog cell holds a contact across the placements. */
function shares(places: readonly number[][]): Map<number, number> {
  const count = new Map<number, number>();
  for (const p of places) for (const c of p) count.set(c, (count.get(c) ?? 0) + 1);
  return count;
}

/** The plain player: the idle hint and nothing else, a lock on a proven cell or a ping on a safe one. */
function plainBot(): Bot<ScannerState, ScannerMove> {
  return {
    name: "plain player",
    about: "Follows the idle hint: locks a cell one ring or the fog count proves, else pings the clear cell with most fog near it.",
    choose(state, ctx) {
      const h = scannerHint(state);
      if (h) return h.type === "lock" ? lock(h.cell) : ping(h.cell);
      return lastResort(state, ctx);
    },
  };
}

/** The tuning notes' sweeper: pings the fog in reading order, blind to the numbers. */
function sweeperBot(): Bot<ScannerState, ScannerMove> {
  return {
    name: "sweeper",
    about: "Pings the fog cell by cell in reading order and never locks (at the person's pace, not the notes' 0.4 s a tap).",
    choose(state) {
      const clear = scannerClearCells(state);
      for (let c = 0; c < cellCount(state); c++) if (!clear[c] && scannerPingIllegalReason(state, c) === null) return ping(c);
      for (let c = 0; c < cellCount(state); c++) if (scannerPingIllegalReason(state, c) === null) return ping(c);
      return null;
    },
  };
}

/** The tuning notes' random pinger that still spots every proven cell. */
function randomPingerBot(): Bot<ScannerState, ScannerMove> {
  return {
    name: "random pinger",
    about: "Locks any cell the plain arguments prove, else pings any cell not yet pinged, fog included, at random.",
    choose(state, ctx) {
      const proven = scannerProvenCells(state);
      if (proven.length) return lock(proven[0]!);
      const open: number[] = [];
      for (let c = 0; c < cellCount(state); c++) if (scannerPingIllegalReason(state, c) === null && scannerPingAt(state, c) === null) open.push(c);
      return open.length ? ping(ctx.rng.pick(open)) : null;
    },
  };
}

/**
 * The splitter, or with `nerve` under 1 the gambler: lists every placement the numbers allow, locks
 * the cell held in the most of them when that share reaches `nerve`, else pings the safe cell that
 * splits them most evenly.
 */
function placementBot(name: string, about: string, nerve: number): Bot<ScannerState, ScannerMove> {
  const plain = plainBot();
  return {
    name,
    about,
    choose(state, ctx) {
      if (state.finished || scannerContactsLeft(state) === 0) return null;
      const places = placements(state, PLACEMENT_LIMIT);
      if (places === null || places.length === 0) return plain.choose(state, ctx);
      let top = 0;
      const share = shares(places);
      for (const n of share.values()) top = Math.max(top, n);
      if (top === places.length || top >= nerve * places.length) {
        const cells = [...share.entries()].filter(([, n]) => n === top).map(([c]) => c);
        return lock(ctx.rng.pick(cells));
      }
      const cell = bestSplit(state, places, ctx.rng);
      if (cell !== null) return ping(cell);
      // No safe cell left to ping: the likeliest cell is the best a player can do.
      const cells = [...share.entries()].filter(([, n]) => n === top).map(([c]) => c);
      return lock(ctx.rng.pick(cells));
    },
  };
}

/**
 * Every (placement, marked contact) pair that agrees with what the board shows: a lit ping hears
 * the mark among its nearest, an unlit one does not. Null past the limit.
 */
function markPairs(s: ScannerState, limit: number): { place: number[]; mark: number }[] | null {
  const places = placements(s, limit);
  if (places === null) return null;
  const cfg = s.config;
  const out: { place: number[]; mark: number }[] = [];
  for (const place of places) for (const m of place) if (s.pings.every((p) => (scannerDistance(cfg, p.cell, m) === p.distance) === p.lit)) out.push({ place, mark: m });
  return out;
}

/**
 * The mark hunter, or with `nerve` under 1 the mark gambler. While the mark can still be paid it
 * holds every proven contact, pings the safe cell that best splits where the mark can be, and locks
 * the mark once it is proven (the gambler: once it holds it in `nerve` of the pairs). With no safe
 * ping left, or once a ping would leave `reserve` or fewer of par (the thrifty hunter, which gives
 * the chase up rather than lose the clean sector), it plays the splitter.
 */
function markBot(name: string, about: string, nerve: number, reserve = -Infinity): Bot<ScannerState, ScannerMove> {
  const splitter = placementBot("splitter", "", 1);
  return {
    name,
    about,
    choose(state, ctx) {
      if (state.finished || scannerContactsLeft(state) === 0) return null;
      if (!scannerMarkOpen(state) || scannerPingsLeft(state) <= reserve) return splitter.choose(state, ctx);
      const pairs = markPairs(state, PLACEMENT_LIMIT);
      if (pairs === null || pairs.length === 0) return splitter.choose(state, ctx);
      const markCount = new Map<number, number>();
      for (const p of pairs) markCount.set(p.mark, (markCount.get(p.mark) ?? 0) + 1);
      let top = 0;
      for (const n of markCount.values()) top = Math.max(top, n);
      const topCells = [...markCount.entries()].filter(([, n]) => n === top).map(([c]) => c);
      if (top === pairs.length || top >= nerve * pairs.length) return lock(ctx.rng.pick(topCells));
      // Ping the safe cell that splits the mark's cell most evenly: answers grouped by number and light.
      const cfg = state.config;
      const inAny = new Set<number>();
      for (const p of pairs) for (const c of p.place) inAny.add(c);
      let best: number[] = [];
      let bestCost = Infinity;
      for (let c = 0; c < cellCount(state); c++) {
        if (inAny.has(c) || scannerPingIllegalReason(state, c) !== null) continue;
        const groups = new Map<string, Map<number, number>>();
        for (const p of pairs) {
          let d = Infinity;
          for (const k of p.place) d = Math.min(d, scannerDistance(cfg, c, k));
          const key = `${d}:${scannerDistance(cfg, c, p.mark) === d ? 1 : 0}`;
          const g = groups.get(key) ?? new Map<number, number>();
          g.set(p.mark, (g.get(p.mark) ?? 0) + 1);
          groups.set(key, g);
        }
        // The expected number of cells the mark could still be in after the answer, then the pairs left as a tie-break.
        let cost = 0;
        let spread = 0;
        for (const g of groups.values()) {
          let n = 0;
          for (const v of g.values()) n += v;
          cost += n * g.size;
          spread += n * n;
        }
        cost = cost * pairs.length * pairs.length + spread;
        if (cost < bestCost) {
          bestCost = cost;
          best = [c];
        } else if (cost === bestCost) best.push(c);
      }
      if (best.length > 0) return ping(ctx.rng.pick(best));
      return splitter.choose(state, ctx);
    },
  };
}

export const SCANNER_BOTS: BotGame<ScannerState, ScannerMove, ScannerConfig> = {
  id: "scanner",
  def: SCANNER_DEF,
  pace: "2.6 s a ping and 1.4 s a lock",
  elapsed: (s) => s.pingsMade * SECONDS_PER_PING + (s.moveCount - s.pingsMade) * SECONDS_PER_LOCK,
  choices: allChoices,
  end: () => ({ type: "end" }),
  open: false,
  bots: [
    plainBot(),
    sweeperBot(),
    randomPingerBot(),
    placementBot("splitter", "Knows every placement the numbers allow, locks only a cell held in all, and pings the safe cell that splits them most evenly.", 1),
    placementBot("gambler", "The splitter, but locks the likeliest cell once it holds a contact in six placements of ten (the bait).", 0.6),
    markBot("mark hunter", "While the mark can be paid, holds proven contacts and pings to pin the mark down, then locks it first; never gives the chase up.", 1),
    markBot("thrifty hunter", "The mark hunter, but gives the mark up once a ping would leave fewer than two of par, to keep the sector clean.", 1, 2),
    markBot("mark gambler", "The mark hunter, but locks the likeliest cell for the mark at even odds (the bait).", 0.5),
  ],
  slow: ["splitter", "gambler", "mark hunter", "thrifty hunter", "mark gambler"],
  baits: [
    { bait: "gambler", beats: "splitter" },
    { bait: "mark gambler", beats: "thrifty hunter" },
  ],
};
