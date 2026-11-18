import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Scanner's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The sector is a sheet of fog
 * plates. A cell is told from every other by what stands on it, with the colour taken away: fog is
 * a solid plate, a clear cell is bare ground with a dot, a ping is its number, a found contact is a
 * dot held in four brackets, a spooked one is a disc struck through, and a miss is a cross. A lock
 * is four brackets, bare until they hold something; a ping is a hollow diamond, the shape of its
 * ring. Each is drawn from its layers in `data/pieces/scanner.json` (ADR 0065), by its id here.
 */

export interface ScannerPiece {
  readonly color: Token;
  readonly paint: Paint;
}

export const SCANNER_PIECES = {
  /** Fog: a flat plate over a cell nothing is known of. */
  fog: { color: "raised", paint: piecePaint("scanner", "fog") },
  /** A contact found by a lock: the contact, held in the lock's brackets. Good news is cream. */
  found: { color: "cream", paint: piecePaint("scanner", "found") },
  /** A contact a ping spooked: the contact, struck through. */
  spooked: { color: "danger", paint: piecePaint("scanner", "spooked") },
  /** A lock on empty space: a cross. */
  miss: { color: "danger", paint: piecePaint("scanner", "miss") },
  /** A lock that holds nothing yet: the brackets closing under a held finger, and a hint to lock. */
  brackets: { color: "cream", paint: piecePaint("scanner", "brackets") },
  /** A ping: a hollow diamond, the shape of the ring it sounds. The switch's glyph and a hint to ping. */
  ping: { color: "cream", paint: piecePaint("scanner", "ping") },
} as const satisfies Record<string, ScannerPiece>;

export type ScannerPieceId = keyof typeof SCANNER_PIECES;
