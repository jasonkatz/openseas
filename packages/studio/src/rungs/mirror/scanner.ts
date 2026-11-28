// Scanner on the new engine, shown as the state the prototype's board draws (ADR 0097, ADR 0099). The round is
// played by `@openseas/puzzle`: every sector dealt and its opening ping, every ping and lock, what each ping says as
// contacts become known, the costs, the savings and the streak. This file only turns what that round reports into
// the old shape, so the board, its sounds and its page are the prototype's, unchanged.
import { InvalidMoveError, SCANNER_DEF, scannerStreakPercentAt, type PuzzleDef, type ScannerClear, type ScannerConfig, type ScannerMove, type ScannerMoveReport, type ScannerResound, type ScannerState } from "@openseas/engine";
import { play, read, seedFromString, start, type AnyMove, type Cell, type Round, type Setting } from "@openseas/puzzle";
import scanner, { type Sector } from "@openseas/puzzle/examples/scanner";
import { held, roundOf } from "./held.js";

/** The prototype's numbers under the names the new puzzle gives them. Costs are negative points, and the streak's table starts at a streak of one. */
export function scannerSettings(c: ScannerConfig): Record<string, Setting> {
  return {
    width: c.width, height: c.height, startContacts: c.startContacts, growEvery: c.growEvery, maxContacts: c.maxContacts, parBase: c.parBase, parPerContact: c.parPerContact,
    openingMin: c.openingMin, dealTries: c.dealTries, contactPoints: c.contactPoints, savePoints: c.savePoints, overPoints: -c.overPenalty, wrongPoints: -c.wrongPenalty,
    spookPoints: -c.spookPenalty, streakPercent: c.streakPercent.slice(1), maxMoves: c.maxMoves,
  };
}

type Kept = Pick<ScannerState, "bestCombo" | "cleanSectors" | "pingsSaved" | "wrongLocks" | "contactsSpooked">;
const KEPT = new WeakMap<object, Kept>();

function shown(round: Round<AnyMove>, config: ScannerConfig, kept: Kept, lastMove: ScannerMoveReport | null, ended = false): ScannerState {
  const now = read(round);
  const s = (now.state as { sector: Sector }).sector;
  const stat = (id: string): number => (now.stats as Record<string, number>)[id] ?? 0;
  const state: ScannerState = {
    config,
    rng: round.state.streams.sector!,
    sector: s.cleared,
    contacts: s.contacts,
    found: s.found,
    spooked: s.spooked,
    pings: s.pings,
    spent: s.spent,
    misses: s.misses,
    par: s.par,
    score: now.score,
    moveCount: now.movesMade,
    combo: now.streak,
    sectorsCleared: stat("sectors"),
    contactsFound: stat("found"),
    pingsMade: stat("pings"),
    ...kept,
    lastMove,
    finished: ended || now.movesMade >= config.maxMoves,
  };
  KEPT.set(state, kept);
  return held(state, round);
}

const deal = (seed: string, config: ScannerConfig): Round<AnyMove> =>
  start(scanner, { seed, settings: scannerSettings(config), streams: { sector: seedFromString(`scanner:${seed}`) } }) as unknown as Round<AnyMove>;

export const SCANNER_MIRROR: PuzzleDef<ScannerState, ScannerMove, ScannerConfig> = {
  ...SCANNER_DEF,
  create: (seed, config) => {
    SCANNER_DEF.validateConfig(config);
    return shown(deal(seed, config), config, { bestCombo: 0, cleanSectors: 0, pingsSaved: 0, wrongLocks: 0, contactsSpooked: 0 }, null);
  },
  reduce: (state, move) => {
    if (state.finished) throw new InvalidMoveError("game is finished", move);
    const round = roundOf(state);
    const c = state.config;
    const kept = { ...KEPT.get(state)! };
    // Ending early is the host's.
    if (move.type === "end") return shown(round, c, kept, null, true);
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= c.width * c.height) throw new InvalidMoveError("no such cell", move);
    const at: Cell = { x: move.cell % c.width, y: Math.floor(move.cell / c.width) };
    const next = play(round, { move: move.type, at });
    if (next.last.refused) throw new InvalidMoveError(next.last.refused, move);
    const events = next.last.events;
    const has = (id: string): boolean => events.some((e) => e.event === id);
    const percent = scannerStreakPercentAt(c, state.combo);
    const [found, wrong, spooked, over] = [has("find"), has("wrong"), has("spook"), has("over")];
    const ping = events.find((e) => e.event === "ping");
    // What every ping said before, to tell what it says now.
    const said = new Map(state.pings.map((p) => [p.cell, p.distance]));
    const resound: ScannerResound[] = events.flatMap((e) => {
      if (e.event !== "resound") return [];
      const p = e.fields.at as Cell;
      const cell = p.y * c.width + p.x;
      return [{ cell, from: said.get(cell)!, to: e.fields.distance as number }];
    });
    const ended = events.find((e) => e.event === "clean" || e.event === "cleared");
    let cleared: ScannerClear | null = null;
    let combo = wrong || spooked ? 0 : state.combo;
    if (ended) {
      const clean = ended.event === "clean";
      const saved = (events.find((e) => e.event === "saved")?.fields.saved as number | undefined) ?? 0;
      combo = clean ? combo + 1 : 0;
      cleared = { sector: state.sector, contacts: state.contacts, pings: ended.fields.pings as number, par: state.par, saved, bonus: Math.floor((saved * c.savePoints * percent) / 100), clean, streak: combo };
      kept.cleanSectors += clean ? 1 : 0;
      kept.pingsSaved += saved;
    }
    kept.bestCombo = Math.max(kept.bestCombo, combo);
    kept.wrongLocks += wrong ? 1 : 0;
    kept.contactsSpooked += spooked ? 1 : 0;
    const report: ScannerMoveReport = {
      move,
      cell: move.cell,
      distance: move.type === "lock" ? null : spooked ? 0 : (ping!.fields.distance as number),
      found,
      wrong,
      spooked,
      resound: ended ? [] : resound,
      findPoints: found ? Math.floor((c.contactPoints * percent) / 100) : 0,
      cost: 0 - (wrong ? c.wrongPenalty : 0) - (spooked ? c.spookPenalty : 0) - (over ? c.overPenalty : 0),
      streakPercent: percent,
      cleared,
      points: read(next).score - state.score,
    };
    return shown(next, c, kept, report);
  },
};
