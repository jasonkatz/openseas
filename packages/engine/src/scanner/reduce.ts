import { InvalidMoveError } from "../errors.js";
import { Hasher } from "../hash.js";
import { nextInt, seedFromString, type PrngState } from "../prng.js";
import {
  DEFAULT_SCANNER_CONFIG,
  type ScannerClear,
  type ScannerConfig,
  type ScannerMove,
  type ScannerMoveReport,
  type ScannerPing,
  type ScannerResound,
  type ScannerState,
} from "./types.js";

export const idx = (cfg: ScannerConfig, col: number, row: number): number => row * cfg.width + col;
export const colOf = (cfg: ScannerConfig, cell: number): number => cell % cfg.width;
export const rowOf = (cfg: ScannerConfig, cell: number): number => Math.floor(cell / cfg.width);

/** Steps between two cells, counting up, down, left and right. */
export function distance(cfg: ScannerConfig, a: number, b: number): number {
  return Math.abs(colOf(cfg, a) - colOf(cfg, b)) + Math.abs(rowOf(cfg, a) - rowOf(cfg, b));
}

export function validateConfig(cfg: ScannerConfig): void {
  const int = (n: number, lo: number, hi: number): boolean => Number.isInteger(n) && n >= lo && n <= hi;
  const ok =
    int(cfg.width, 3, 10) &&
    int(cfg.height, 3, 10) &&
    int(cfg.startContacts, 1, 12) &&
    int(cfg.maxContacts, cfg.startContacts, 12) &&
    // A sector keeps room to reason in: contacts fill a third of it at most.
    cfg.maxContacts * 3 <= cfg.width * cfg.height &&
    int(cfg.growEvery, 1, 100) &&
    int(cfg.parBase, 0, 100) &&
    int(cfg.parPerContact, 0, 20) &&
    cfg.parBase + cfg.parPerContact * cfg.startContacts >= 1 &&
    int(cfg.openingMin, 0, 6) &&
    int(cfg.dealTries, 1, 50) &&
    int(cfg.contactPoints, 0, 100_000) &&
    int(cfg.savePoints, 0, 100_000) &&
    int(cfg.overPenalty, 0, 100_000) &&
    int(cfg.wrongPenalty, 0, 100_000) &&
    int(cfg.spookPenalty, 0, 100_000) &&
    Array.isArray(cfg.streakPercent) &&
    cfg.streakPercent.length >= 1 &&
    cfg.streakPercent.length <= 16 &&
    cfg.streakPercent.every((p) => Number.isInteger(p) && p >= 100 && p <= 1000) &&
    int(cfg.maxMoves, 1, 1_000_000);
  if (!ok) throw new Error("invalid scanner config");
}

/** Contacts in a sector dealt after `cleared` sectors. */
export function contactsFor(cfg: ScannerConfig, cleared: number): number {
  return Math.min(cfg.maxContacts, cfg.startContacts + Math.floor(cleared / cfg.growEvery));
}

/** Pings a sector of `contacts` allows before each further one costs. */
export function parFor(cfg: ScannerConfig, contacts: number): number {
  return cfg.parBase + cfg.parPerContact * contacts;
}

/** What the streak multiplies by, in percent, at a streak of `streak` clean sectors. */
export function streakPercentAt(cfg: ScannerConfig, streak: number): number {
  return cfg.streakPercent[Math.max(0, Math.min(streak, cfg.streakPercent.length - 1))]!;
}

/** What a lock on a contact scores now, the streak included. */
export function lockValue(state: ScannerState): number {
  return Math.floor((state.config.contactPoints * streakPercentAt(state.config, state.combo)) / 100);
}

/** What each ping left over would pay if the sector were cleared now, the streak included. */
export function saveValue(state: ScannerState): number {
  return Math.floor((state.config.savePoints * streakPercentAt(state.config, state.combo)) / 100);
}

/** Pings left of the sector's allowance; below zero once the player is past par. */
export function pingsLeft(state: ScannerState): number {
  return state.par - state.spent;
}

/** Contacts still hidden this sector. */
export function contactsLeft(state: ScannerState): number {
  return state.contacts.length - state.found.length - state.spooked.length;
}

/** The contacts the player knows of: found by a lock or spooked by a ping. */
export function knownContacts(state: ScannerState): number[] {
  return [...state.found, ...state.spooked];
}

/** The ping made on `cell` this sector, or null. */
export function pingAt(state: ScannerState, cell: number): ScannerPing | null {
  return state.pings.find((p) => p.cell === cell) ?? null;
}

const nearest = (cfg: ScannerConfig, contacts: readonly number[], cell: number): number => Math.min(...contacts.map((c) => distance(cfg, cell, c)));

/** The cells exactly `d` steps from `cell`: the diamond a ping's number points at. In index order. */
export function ringCells(cfg: ScannerConfig, cell: number, d: number): number[] {
  const out: number[] = [];
  if (d <= 0) return out;
  for (let c = 0; c < cfg.width * cfg.height; c++) if (distance(cfg, cell, c) === d) out.push(c);
  return out;
}

// ---- what the numbers say. Every argument is made from what the player can see, never from the hidden contacts.

/** What the player can see of a sector. */
interface Sight {
  readonly pings: readonly ScannerPing[];
  /** Contacts found or spooked. */
  readonly known: readonly number[];
  readonly misses: readonly number[];
  /** Contacts still hidden. */
  readonly left: number;
}

const sightOf = (state: ScannerState): Sight => ({ pings: state.pings, known: knownContacts(state), misses: state.misses, left: contactsLeft(state) });

function clearOf(cfg: ScannerConfig, sight: Sight): boolean[] {
  const clear = new Array<boolean>(cfg.width * cfg.height).fill(false);
  for (const m of sight.misses) clear[m] = true;
  // A ping's own cell is 0 steps from it, so it is among these.
  for (const p of sight.pings) for (let c = 0; c < clear.length; c++) if (distance(cfg, p.cell, c) < p.distance) clear[c] = true;
  for (const k of sight.known) clear[k] = false;
  return clear;
}

function provenOf(cfg: ScannerConfig, sight: Sight): number[] {
  if (sight.left === 0) return [];
  const clear = clearOf(cfg, sight);
  const known = new Set(sight.known);
  const out = new Set<number>();
  for (const p of sight.pings) {
    const ring = ringCells(cfg, p.cell, p.distance).filter((c) => !clear[c] && !known.has(c));
    if (ring.length === 1) out.add(ring[0]!);
  }
  const fog: number[] = [];
  for (let c = 0; c < clear.length; c++) if (!clear[c] && !known.has(c)) fog.push(c);
  if (fog.length === sight.left) for (const c of fog) out.add(c);
  return [...out].sort((a, b) => a - b);
}

/**
 * Which cells the numbers prove empty: a pinged cell, a cell wrongly locked, and every cell nearer
 * to a ping than its number. One flag a cell; a known contact's cell is never flagged.
 */
export function clearCells(state: ScannerState): boolean[] {
  return clearOf(state.config, sightOf(state));
}

/** The cells on a ping's ring that could hold the contact it hears: not proven empty and not a contact already known. In index order. */
export function pingCandidates(state: ScannerState, ping: ScannerPing): number[] {
  const clear = clearCells(state);
  const known = new Set(knownContacts(state));
  return ringCells(state.config, ping.cell, ping.distance).filter((c) => !clear[c] && !known.has(c));
}

/**
 * Cells that must hold a hidden contact, by the two plainest arguments: a ping has one cell left on
 * its ring, or as many cells are left in fog as contacts are left to find. For the idle hint; a
 * player crossing two rings will often know more.
 */
export function provenCells(state: ScannerState): number[] {
  return provenOf(state.config, sightOf(state));
}

/**
 * A cell worth pinging next, for the idle hint when nothing is proven yet: a cell proven empty and
 * not yet pinged, the one with the most fog within two steps. Null when no such cell is left.
 */
export function safePing(state: ScannerState): number | null {
  const cfg = state.config;
  if (contactsLeft(state) === 0) return null;
  const clear = clearCells(state);
  const known = new Set(knownContacts(state));
  const pinged = new Set(state.pings.map((p) => p.cell));
  let best: number | null = null;
  let bestFog = 0;
  for (let c = 0; c < clear.length; c++) {
    if (!clear[c] || pinged.has(c)) continue;
    let fog = 0;
    for (let o = 0; o < clear.length; o++) if (!clear[o] && !known.has(o) && distance(cfg, c, o) <= 2) fog++;
    if (fog > bestFog) {
      bestFog = fog;
      best = c;
    }
  }
  return best;
}

export interface ScannerHint {
  readonly type: "ping" | "lock";
  readonly cell: number;
}

/** A move no one could regret, for the idle hint: a lock on a cell the plain arguments prove, else a ping on a cell proven empty. Null when neither is to be had. */
export function hint(state: ScannerState): ScannerHint | null {
  if (state.finished) return null;
  const proven = provenCells(state);
  if (proven.length > 0) return { type: "lock", cell: proven[0]! };
  const safe = safePing(state);
  return safe === null ? null : { type: "ping", cell: safe };
}

/**
 * True when the plain arguments alone clear a sector with these contacts from pings on `pinged`:
 * ping every cell proven empty, lock every cell proven taken, and go round again. It asks whether a
 * sector can be cleared with no guess, not whether it can be within par.
 */
function solvableFrom(cfg: ScannerConfig, contacts: readonly number[], knownIn: readonly number[], pingedIn: readonly number[], misses: readonly number[]): boolean {
  const known = [...knownIn];
  const pinged = [...pingedIn];
  let hidden = contacts.filter((c) => !known.includes(c));
  for (;;) {
    if (hidden.length === 0) return true;
    const sight: Sight = { pings: pinged.map((cell) => ({ cell, distance: nearest(cfg, hidden, cell), opening: false })), known, misses, left: hidden.length };
    const proven = provenOf(cfg, sight);
    if (proven.length > 0) {
      known.push(...proven);
      hidden = hidden.filter((c) => !proven.includes(c));
      continue;
    }
    const clear = clearOf(cfg, sight);
    const more: number[] = [];
    for (let c = 0; c < clear.length; c++) if (clear[c] && !pinged.includes(c)) more.push(c);
    if (more.length === 0) return false;
    pinged.push(...more);
  }
}

/** True when the sector in play can still be cleared with no guess, by the plain arguments alone (as `provenCells` makes them). Reads the hidden contacts: for tests and the bench, never for the board. */
export function plainlySolvable(state: ScannerState): boolean {
  return solvableFrom(
    state.config,
    state.contacts,
    knownContacts(state),
    state.pings.map((p) => p.cell),
    state.misses,
  );
}

interface Dealt {
  contacts: number[];
  pings: ScannerPing[];
  rng: PrngState;
}

/**
 * Deal a sector: its contacts, then the ping it opens with, on empty space at least openingMin from
 * every contact (or as far as there is). A deal the plain arguments cannot clear from its opening
 * ping is thrown back, until dealTries deals have been made; the last is kept whatever it is.
 */
function dealSector(cfg: ScannerConfig, rngIn: PrngState, count: number): Dealt {
  let rng = rngIn;
  for (let attempt = 1; ; attempt++) {
    const free: number[] = [];
    for (let c = 0; c < cfg.width * cfg.height; c++) free.push(c);
    const contacts: number[] = [];
    for (let n = 0; n < count; n++) {
      const pick = nextInt(rng, free.length);
      rng = pick.state;
      contacts.push(free.splice(pick.value, 1)[0]!);
    }
    contacts.sort((a, b) => a - b);
    const pings: ScannerPing[] = [];
    if (cfg.openingMin > 0) {
      const far = free.map((c) => nearest(cfg, contacts, c));
      const want = Math.min(cfg.openingMin, Math.max(...far));
      const spots = free.filter((_, i) => far[i]! >= want);
      const pick = nextInt(rng, spots.length);
      rng = pick.state;
      const cell = spots[pick.value]!;
      pings.push({ cell, distance: nearest(cfg, contacts, cell), opening: true });
    }
    // With no opening ping there is nothing to reason from, and no deal is better than another.
    if (cfg.openingMin === 0 || attempt >= cfg.dealTries || solvableFrom(cfg, contacts, [], [pings[0]!.cell], [])) return { contacts, pings, rng };
  }
}

export function createScannerGame(seed: string, config: ScannerConfig = DEFAULT_SCANNER_CONFIG): ScannerState {
  validateConfig(config);
  const count = contactsFor(config, 0);
  const dealt = dealSector(config, seedFromString(`scanner:${seed}`), count);
  return {
    config,
    rng: dealt.rng,
    sector: 0,
    contacts: dealt.contacts,
    found: [],
    spooked: [],
    pings: dealt.pings,
    spent: 0,
    misses: [],
    par: parFor(config, count),
    score: 0,
    moveCount: 0,
    combo: 0,
    bestCombo: 0,
    sectorsCleared: 0,
    cleanSectors: 0,
    contactsFound: 0,
    pingsMade: 0,
    pingsSaved: 0,
    wrongLocks: 0,
    contactsSpooked: 0,
    lastMove: null,
    finished: false,
  };
}

const inField = (state: ScannerState, cell: number): boolean => Number.isInteger(cell) && cell >= 0 && cell < state.config.width * state.config.height;

export function pingIllegalReason(state: ScannerState, cell: number): string | null {
  if (state.finished) return "game is finished";
  if (!inField(state, cell)) return "no such cell";
  if (state.found.includes(cell) || state.spooked.includes(cell)) return "a contact is already known there";
  if (state.pings.some((p) => p.cell === cell)) return "already pinged";
  return null;
}

export function lockIllegalReason(state: ScannerState, cell: number): string | null {
  if (state.finished) return "game is finished";
  if (!inField(state, cell)) return "no such cell";
  if (state.found.includes(cell) || state.spooked.includes(cell)) return "a contact is already known there";
  // A cell the numbers prove empty takes no lock: a slip of the finger should not cost the streak.
  if (clearCells(state)[cell]) return "nothing can be there";
  return null;
}

export function reduceScanner(state: ScannerState, move: ScannerMove): ScannerState {
  if (state.finished) throw new InvalidMoveError("game is finished", move);
  switch (move.type) {
    case "end":
      return { ...state, lastMove: null, finished: true };
    case "ping": {
      const reason = pingIllegalReason(state, move.cell);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      return act(state, move, move.cell, true);
    }
    case "lock": {
      const reason = lockIllegalReason(state, move.cell);
      if (reason !== null) throw new InvalidMoveError(reason, move);
      return act(state, move, move.cell, false);
    }
    default: {
      const never: never = move;
      throw new InvalidMoveError(`unknown move ${JSON.stringify(never)}`, move);
    }
  }
}

function act(state: ScannerState, move: ScannerMove, cell: number, ping: boolean): ScannerState {
  const cfg = state.config;
  const percent = streakPercentAt(cfg, state.combo);
  const isContact = state.contacts.includes(cell);
  const hit = !ping && isContact;
  const spook = ping && isContact;
  const wrong = !ping && !isContact;
  const spent = state.spent + (ping ? 1 : 0);
  const found = hit ? [...state.found, cell] : state.found;
  const spooked = spook ? [...state.spooked, cell] : state.spooked;
  const misses = wrong ? [...state.misses, cell] : state.misses;
  const hidden = state.contacts.filter((c) => !found.includes(c) && !spooked.includes(c));
  const answer = !ping ? null : isContact ? 0 : nearest(cfg, hidden, cell);

  const findPoints = hit ? Math.floor((cfg.contactPoints * percent) / 100) : 0;
  const cost = 0 - (wrong ? cfg.wrongPenalty : 0) - (spook ? cfg.spookPenalty : 0) - (ping && spent > state.par ? cfg.overPenalty : 0);
  // Either mistake breaks the streak at once.
  let combo = wrong || spook ? 0 : state.combo;

  let cleared: ScannerClear | null = null;
  let bonus = 0;
  let saved = 0;
  const resound: ScannerResound[] = [];
  let sector: Pick<ScannerState, "rng" | "sector" | "contacts" | "found" | "spooked" | "pings" | "spent" | "misses" | "par">;
  if (hidden.length === 0) {
    const clean = spent <= state.par && misses.length === 0 && spooked.length === 0;
    // Only a clean sector pays for the pings it left: a contact spooked early must not look like a ping saved.
    saved = clean ? state.par - spent : 0;
    bonus = Math.floor((saved * cfg.savePoints * percent) / 100);
    combo = clean ? combo + 1 : 0;
    cleared = { sector: state.sector, contacts: state.contacts, pings: spent, par: state.par, saved, bonus, clean, streak: combo };
    const count = contactsFor(cfg, state.sectorsCleared + 1);
    const dealt = dealSector(cfg, state.rng, count);
    sector = { rng: dealt.rng, sector: state.sector + 1, contacts: dealt.contacts, found: [], spooked: [], pings: dealt.pings, spent: 0, misses: [], par: parFor(cfg, count) };
  } else {
    // A contact that became known is heard no longer: every ping says how far the nearest hidden one is.
    let pings: readonly ScannerPing[] = state.pings;
    if (hit || spook) {
      pings = state.pings.map((p) => {
        const d = nearest(cfg, hidden, p.cell);
        if (d === p.distance) return p;
        resound.push({ cell: p.cell, from: p.distance, to: d });
        return { ...p, distance: d };
      });
    } else if (ping) {
      pings = [...state.pings, { cell, distance: answer!, opening: false }];
    }
    sector = { rng: state.rng, sector: state.sector, contacts: state.contacts, found, spooked, pings, spent, misses, par: state.par };
  }

  const score = Math.max(0, state.score + findPoints + cost + bonus);
  const report: ScannerMoveReport = { move, cell, distance: answer, found: hit, wrong, spooked: spook, resound, findPoints, cost, streakPercent: percent, cleared, points: score - state.score };
  const moveCount = state.moveCount + 1;
  return {
    config: cfg,
    ...sector,
    score,
    moveCount,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    sectorsCleared: state.sectorsCleared + (cleared ? 1 : 0),
    cleanSectors: state.cleanSectors + (cleared?.clean ? 1 : 0),
    contactsFound: state.contactsFound + (hit ? 1 : 0),
    pingsMade: state.pingsMade + (ping ? 1 : 0),
    pingsSaved: state.pingsSaved + saved,
    wrongLocks: state.wrongLocks + (wrong ? 1 : 0),
    contactsSpooked: state.contactsSpooked + (spook ? 1 : 0),
    lastMove: report,
    finished: moveCount >= cfg.maxMoves,
  };
}

export function replayScanner(seed: string, config: ScannerConfig, moves: readonly ScannerMove[]): ScannerState {
  let s = createScannerGame(seed, config);
  for (const m of moves) s = reduceScanner(s, m);
  return s;
}

export function hashScannerState(state: ScannerState): string {
  const h = new Hasher();
  h.int(state.sector).int(state.par).int(state.spent);
  h.int(state.contacts.length);
  for (const c of state.contacts) h.int(c);
  h.int(state.found.length);
  for (const c of state.found) h.int(c);
  h.int(state.spooked.length);
  for (const c of state.spooked) h.int(c);
  h.int(state.pings.length);
  for (const p of state.pings) h.int(p.cell).int(p.distance).int(p.opening ? 1 : 0);
  h.int(state.misses.length);
  for (const c of state.misses) h.int(c);
  h.int(state.rng.a).int(state.rng.b).int(state.rng.c).int(state.rng.d);
  h.int(state.score).int(state.moveCount).int(state.combo).int(state.bestCombo);
  h.int(state.sectorsCleared).int(state.cleanSectors).int(state.contactsFound).int(state.pingsMade).int(state.pingsSaved).int(state.wrongLocks).int(state.contactsSpooked);
  h.int(state.finished ? 1 : 0);
  return h.digest();
}

export interface ScannerSummary {
  readonly score: number;
  readonly moves: number;
  readonly bestCombo: number;
}

export function summarizeScanner(state: ScannerState): ScannerSummary {
  return { score: state.score, moves: state.moveCount, bestCombo: state.bestCombo };
}

/**
 * The sector as the player sees it, one character a cell, row by row: `X` a found contact, `S` a
 * spooked one, a digit or letter (base 36) what a ping says now, `!` a wrong lock, `-` a cell proven
 * empty, `.` fog. It never says where a hidden contact is. What the board draws must match it.
 */
export function viewString(state: ScannerState): string {
  const chars: string[] = clearCells(state).map((clear) => (clear ? "-" : "."));
  for (const m of state.misses) chars[m] = "!";
  for (const p of state.pings) chars[p.cell] = p.distance.toString(36);
  for (const f of state.found) chars[f] = "X";
  for (const f of state.spooked) chars[f] = "S";
  return chars.join("");
}
