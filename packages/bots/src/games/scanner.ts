/**
 * Scanner for the bots: a choice is one ping or one lock, on any cell the engine takes it on. The
 * sector holds contacts the player cannot see, so the game is not open: the one-move and rollout
 * bots would read them by trying a move, and are not run. Every bot here decides from what a player
 * sees: the pings and what they say now, the misses, the contacts known, and how many are left.
 */
import {
  SCANNER_DEF,
  scannerClearCells,
  scannerContactsLeft,
  scannerDistance,
  scannerHint,
  scannerKnownContacts,
  scannerLockIllegalReason,
  scannerPingAt,
  scannerPingCandidates,
  scannerPingIllegalReason,
  scannerProvenCells,
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
  ],
  slow: ["splitter", "gambler"],
  baits: [{ bait: "gambler", beats: "splitter" }],
};
