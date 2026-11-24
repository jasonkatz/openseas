import type { PuzzleId } from "@openseas/engine";
import { PiecesFileSchema, type Drawing, type PiecesFile } from "@openseas/protocol";
import type { Paint } from "../kit/pictogram.js";
import { paintDrawing } from "../kit/drawing.js";
import cooling from "../../data/pieces/cooling.json" with { type: "json" };
import engines from "../../data/pieces/engines.json" with { type: "json" };
import plating from "../../data/pieces/plating.json" with { type: "json" };
import gunnery from "../../data/pieces/gunnery.json" with { type: "json" };
import navigation from "../../data/pieces/navigation.json" with { type: "json" };
import battle from "../../data/pieces/battle.json" with { type: "json" };
import swordfight from "../../data/pieces/swordfight.json" with { type: "json" };
import salvage from "../../data/pieces/salvage.json" with { type: "json" };
import overload from "../../data/pieces/overload.json" with { type: "json" };
import deflectors from "../../data/pieces/deflectors.json" with { type: "json" };
import reactor from "../../data/pieces/reactor.json" with { type: "json" };
import scanner from "../../data/pieces/scanner.json" with { type: "json" };
import tug from "../../data/pieces/tug.json" with { type: "json" };
import racks from "../../data/pieces/racks.json" with { type: "json" };
import cutting from "../../data/pieces/cutting.json" with { type: "json" };
import tractor from "../../data/pieces/tractor.json" with { type: "json" };
import refining from "../../data/pieces/refining.json" with { type: "json" };
import freefall from "../../data/pieces/freefall.json" with { type: "json" };
import pouring from "../../data/pieces/pouring.json" with { type: "json" };

/**
 * Every puzzle's pieces as data (ADR 0065, docs/BRAND.md section 3): `data/pieces/<puzzle>.json`,
 * a drawing by the name the puzzle's board asks for it by, checked as it loads. A puzzle's
 * `pieces.ts` paints from here, composing a drawing with what only code can say (a plate's
 * footprint, a rod's numeral). The studio's draft may lay its own drawings over these.
 */
const FILES: Record<PuzzleId, unknown> = { cooling, engines, plating, gunnery, navigation, battle, swordfight, salvage, overload, deflectors, reactor, scanner, tug, racks, cutting, tractor, refining, freefall, pouring };

export const SHIPPED_PIECES: Readonly<Record<PuzzleId, PiecesFile>> = Object.fromEntries(Object.entries(FILES).map(([id, file]) => [id, PiecesFileSchema.parse(file)])) as Record<PuzzleId, PiecesFile>;

let over: Readonly<Partial<Record<PuzzleId, PiecesFile>>> = {};
let revision = 0;
const listeners = new Set<() => void>();

/**
 * Lay a draft's drawings over one puzzle's shipped pieces, in place of whatever was laid before;
 * an empty set puts them back. Presentation only, as a draft's words are; the game never sets one.
 * A drawing the puzzle has no piece of that name for is ignored.
 */
export function overridePieces(puzzle: PuzzleId, next: Readonly<Record<string, Drawing>>): void {
  const known = Object.fromEntries(Object.entries(next).filter(([name]) => name in SHIPPED_PIECES[puzzle]));
  if (JSON.stringify(known) === JSON.stringify(over[puzzle] ?? {})) return;
  over = { ...over, [puzzle]: known };
  revision++;
  for (const l of listeners) l();
}

/** Counts each change to the drawings laid over the shipped: a board bakes its pieces once, so it is made again, and a cached legend icon is drawn again. */
export const pieceOverrideRevision = (): number => revision;
export function subscribePieces(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A piece's drawing as this page draws it: the draft's where it redraws it, else the shipped. */
export function drawingOf(puzzle: PuzzleId, name: string): Drawing {
  const d = over[puzzle]?.[name] ?? SHIPPED_PIECES[puzzle][name];
  if (!d) throw new Error(`${puzzle} has no piece called ${name} in data/pieces/${puzzle}.json`);
  return d;
}

/** A piece as a `Paint`: its drawing is looked up when it is painted, so a redrawn piece is baked as it now is. */
export const piecePaint =
  (puzzle: PuzzleId, name: string): Paint =>
  (ctx) =>
    paintDrawing(ctx, drawingOf(puzzle, name));
