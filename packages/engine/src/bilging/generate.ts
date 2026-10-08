import { nextInt, type PrngState } from "../prng.js";
import { idx } from "./board.js";
import { Special, type BilgingConfig, type Piece } from "./types.js";

export interface SpawnResult {
  readonly rng: PrngState;
  readonly piece: Piece;
  readonly nextId: number;
}

/** Spawn one new piece, possibly special, at the configured odds. */
export function spawnPiece(cfg: BilgingConfig, rng: PrngState, nextId: number): SpawnResult {
  const { keg, ink, barnacle } = cfg.specialChancePerMille;
  const roll = nextInt(rng, 1000);
  let kind: number;
  let state = roll.state;
  if (roll.value < keg) kind = Special.Keg;
  else if (roll.value < keg + ink) kind = Special.Ink;
  else if (roll.value < keg + ink + barnacle) kind = Special.Barnacle;
  else {
    const k = nextInt(state, cfg.pieceKinds);
    state = k.state;
    kind = k.value;
  }
  return { rng: state, piece: { id: nextId, kind }, nextId: nextId + 1 };
}

/**
 * Fill an empty board so that no run of 3 exists at the start. Specials are allowed but a cell
 * never takes a kind that would complete a run with the two pieces left of it or below it.
 */
export function generateBoard(
  cfg: BilgingConfig,
  rng: PrngState,
): { cells: Piece[]; rng: PrngState; nextId: number } {
  const cells: Piece[] = new Array<Piece>(cfg.width * cfg.height);
  let state = rng;
  let nextId = 1;
  for (let r = 0; r < cfg.height; r++) {
    for (let c = 0; c < cfg.width; c++) {
      for (;;) {
        const s = spawnPiece(cfg, state, nextId);
        state = s.rng;
        const k = s.piece.kind;
        const left1 = c >= 1 ? cells[idx(cfg, c - 1, r)]!.kind : -1;
        const left2 = c >= 2 ? cells[idx(cfg, c - 2, r)]!.kind : -2;
        const down1 = r >= 1 ? cells[idx(cfg, c, r - 1)]!.kind : -1;
        const down2 = r >= 2 ? cells[idx(cfg, c, r - 2)]!.kind : -2;
        const makesRun = (k === left1 && k === left2) || (k === down1 && k === down2);
        // Also keep barnacles out of the opening board; they are a mid-game pressure piece.
        if (makesRun || k === Special.Barnacle) continue;
        cells[idx(cfg, c, r)] = s.piece;
        nextId = s.nextId;
        break;
      }
    }
  }
  return { cells, rng: state, nextId };
}
