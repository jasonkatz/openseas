import { PiecesFileSchema, type Drawing } from "@openseas/protocol";
import stock from "../../data/stock.json" with { type: "json" };
import type { Token } from "./tokens.js";

/**
 * The stock skin's pieces (ADR 0092): what a puzzle on the new engine is dressed in until it has a
 * skin of its own. Eight outlines, `kind-1` to `kind-8`, each a silhouette no other has, so a board
 * reads with every piece in one colour (docs/BRAND.md section 3). They are data, as every piece is.
 */
export const STOCK_PIECES = PiecesFileSchema.parse(stock);

/** How many kinds the stock skin can dress. */
export const STOCK_KINDS = Object.keys(STOCK_PIECES).length;

/** The outline and the palette token of one kind, numbered from 1. A kind past the last wears the last. */
export function stockPiece(kind: number): { drawing: Drawing; color: Token } {
  const drawing = STOCK_PIECES[`kind-${Math.min(Math.max(kind, 1), STOCK_KINDS)}`]!;
  return { drawing, color: (drawing.tint ?? "cream") as Token };
}
