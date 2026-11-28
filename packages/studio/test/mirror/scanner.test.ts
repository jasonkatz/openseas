// The Scanner page on the new engine is the prototype's page with another engine behind it (ADR 0097, ADR 0099).
// This holds what that engine hands the board, the whole state and the report of every move, to what the
// prototype's engine hands it on the same seed.
import { DEFAULT_SCANNER_CONFIG, SCANNER_DEF, scannerHint, scannerLockIllegalReason, scannerPingIllegalReason, type ScannerConfig, type ScannerMove, type ScannerState } from "@openseas/engine";
import { describe, expect, it } from "vitest";
import { SCANNER_MIRROR } from "../../src/rungs/mirror/scanner.js";
import { beside } from "./beside.js";

const CONFIGS: Record<string, ScannerConfig> = {
  "as shipped": DEFAULT_SCANNER_CONFIG,
  "a tight par and dear mistakes": { ...DEFAULT_SCANNER_CONFIG, width: 5, height: 5, startContacts: 2, growEvery: 1, maxContacts: 4, parPerContact: 1, overPenalty: 15, wrongPenalty: 25, spookPenalty: 35 },
};

/**
 * The points are compared by themselves: the prototype rounds a contact's points and a sector's savings down one
 * by one, and the new engine rounds a move's once, so a move that finds the last contact can pay a point more.
 */
const apart = (s: ScannerState): unknown => ({ ...s, score: 0, lastMove: s.lastMove && { ...s.lastMove, points: 0 } });

/** The hint most of the time, else any ping or lock the prototype allows. */
function pickMove(s: ScannerState, pick: (n: number) => number): ScannerMove {
  const hint = scannerHint(s);
  if (pick(10) < 6 && hint) return { type: hint.type, cell: hint.cell };
  for (;;) {
    const cell = pick(s.config.width * s.config.height);
    if (pick(3) === 0 ? scannerLockIllegalReason(s, cell) === null : false) return { type: "lock", cell };
    if (scannerPingIllegalReason(s, cell) === null) return { type: "ping", cell };
  }
}

describe("the Scanner board's state from the new engine, beside the prototype's", () => {
  for (const [name, config] of Object.entries(CONFIGS)) {
    it(`is the same state and the same report after every move: ${name}`, () => {
      const seen = { clean: 0, cleared: 0, wrong: 0, spooked: 0, resound: 0, apart: 0 };
      for (let seed = 1; seed <= 6; seed++) {
        beside({
          def: SCANNER_DEF, mirror: SCANNER_MIRROR, seed: `seed-${seed}`, config, pickMove, apart, steps: 200,
          also: (theirs, ours, at) => {
            const d = ours.score - theirs.score;
            expect(d, at).toBeGreaterThanOrEqual(0);
            expect(d, at).toBeLessThanOrEqual(theirs.sectorsCleared);
            if (d > 0) seen.apart++;
            const r = theirs.lastMove!;
            if (r.cleared) seen[r.cleared.clean ? "clean" : "cleared"]++;
            if (r.wrong) seen.wrong++;
            if (r.spooked) seen.spooked++;
            seen.resound += r.resound.length;
          },
        });
      }
      expect(seen.clean).toBeGreaterThan(0);
      expect(seen.cleared).toBeGreaterThan(0);
      expect(seen.wrong).toBeGreaterThan(0);
      expect(seen.spooked).toBeGreaterThan(0);
      expect(seen.resound).toBeGreaterThan(0);
    });
  }
});
