import type { ClientMsg, LogEntry, Pirate, PuzzleConfig, PuzzleId } from '@tidebound/shared';
import { getPuzzle, randomSeed, STATIONS } from '@tidebound/shared';
import type { Session } from './session';
import type { World } from './world';
import { uid } from './ids';

interface PuzzleSession {
  id: string;
  pirateId: string;
  puzzle: PuzzleId;
  seed: number;
  config: PuzzleConfig;
  state: any;
  elapsed: number;
  practice: boolean;
  shipId: string | null;
  startedAt: number;
  lastPoints: number;
  lastLoaded: number;
  mismatches: number;
}

const DUTY_DURATION = 150000;
const PRACTICE_DURATION = 120000;

/** Server-side puzzle sessions: issues seeds, replays client logs, applies ship effects. */
export class PuzzleManager {
  sessions = new Map<string, PuzzleSession>();

  constructor(private world: World) {}

  start(s: Session, p: Pirate, puzzle: PuzzleId, practice: boolean): void {
    if (s.puzzleSessionId) this.end(s, s.puzzleSessionId, true);
    const ship = this.world.shipOf(p);
    let onDuty = false;
    if (!practice) {
      if (!ship || p.location.kind !== 'ship') return s.send({ t: 'toast', text: 'Board a ship and take a station to work a duty puzzle.', kind: 'bad' });
      if (puzzle === 'swordfight') return s.send({ t: 'toast', text: 'Swordfights happen when you board an enemy.', kind: 'bad' });
      if (!STATIONS.includes(puzzle) || ship.stations[puzzle] !== p.id) return s.send({ t: 'toast', text: 'Take that station first.', kind: 'bad' });
      onDuty = true;
    }
    const def = getPuzzle(puzzle);
    const difficulty = Math.min(0.9, 0.3 + (p.stats[puzzle]?.rating ?? 0) * 0.5);
    const config: PuzzleConfig = { difficulty, durationMs: onDuty ? DUTY_DURATION : PRACTICE_DURATION };
    const seed = randomSeed();
    const ps: PuzzleSession = {
      id: uid('q'), pirateId: p.id, puzzle, seed, config, state: def.init(seed, config), elapsed: 0,
      practice: !onDuty, shipId: onDuty && ship ? ship.id : null, startedAt: Date.now(), lastPoints: 0, lastLoaded: 0, mismatches: 0,
    };
    this.sessions.set(ps.id, ps);
    s.puzzleSessionId = ps.id;
    s.send({ t: 'puzzleSeed', sessionId: ps.id, puzzle, seed, config });
  }

  checkpoint(s: Session, p: Pirate, m: Extract<ClientMsg, { t: 'puzzleCheckpoint' }>): void {
    const ps = this.sessions.get(m.sessionId);
    if (!ps || ps.pirateId !== p.id) return;
    const def = getPuzzle(ps.puzzle);
    // Replay incrementally from the last verified elapsed time.
    let st = ps.state;
    let t = ps.elapsed;
    for (const e of m.entries as LogEntry[]) {
      const at = Math.max(t, Math.floor(e.at));
      if (at > t) { st = def.tick(st, at - t); t = at; }
      st = def.reduce(st, e.a);
    }
    const end = Math.max(t, Math.floor(m.elapsedMs));
    if (end > t) { st = def.tick(st, end - t); t = end; }
    ps.state = st;
    ps.elapsed = t;
    const sc = def.score(st);
    const ok = Math.abs(sc.points - m.points) <= Math.max(2, sc.points * 0.02);
    if (!ok) ps.mismatches++;
    s.send({ t: 'puzzleVerified', sessionId: ps.id, points: sc.points, performance: sc.performance, ok });
    // Ship effects for duty puzzles.
    if (ps.shipId) {
      const ship = this.world.data.ships[ps.shipId];
      if (ship && ship.stations[ps.puzzle] === p.id) {
        this.world.reportStation(ship, p.id, ps.puzzle, sc.performance);
        if (ps.puzzle === 'gunnery') {
          const loaded = Number((st as { cannonsLoaded?: number }).cannonsLoaded ?? 0);
          const delta = Math.max(0, loaded - ps.lastLoaded);
          ps.lastLoaded = loaded;
          if (delta > 0) {
            const cap = this.world.battles.cannonCap(ship);
            ship.stats.loaded = Math.min(cap, ship.stats.loaded + delta);
            this.world.battles.syncLoaded(ship);
          }
        }
      }
    }
    ps.lastPoints = sc.points;
    if (def.isOver(st)) this.end(s, ps.id, false);
  }

  end(s: Session, sessionId: string, abandoned: boolean): void {
    const ps = this.sessions.get(sessionId);
    if (!ps) return;
    this.sessions.delete(sessionId);
    if (s.puzzleSessionId === sessionId) s.puzzleSessionId = null;
    const p = this.world.data.pirates[ps.pirateId];
    if (!p) return;
    const def = getPuzzle(ps.puzzle);
    const sc = def.score(ps.state);
    if (sc.points > 0 && (!abandoned || ps.elapsed > 20000)) {
      this.world.reward(p, ps.puzzle, sc.points, sc.performance, ps.practice);
    }
  }
}
