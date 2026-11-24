import type { RefiningKind } from "@openseas/engine";
import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Refining's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The tower holds fractions
 * of a refinery's feed, and each is drawn by how it behaves: vapour a plume pointing up, oil a round
 * drop, tar a heavy square block, smoke a cloud, and a catalyst a hexagonal crystal with its core
 * cut out. Five outlines, so the kinds read apart in one colour; the colours (ice, sand, rust,
 * slate, lilac) are a second cue. None is amber, which is the player's own pick, and none cream,
 * which is the board's advice. Each is drawn from its layers in `data/pieces/refining.json` (ADR 0065).
 */

export interface RefiningKindLook {
  /** The message key's suffix: the legend reads `refining.kind.<id>`, and its drawing is the piece of that name. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const look = (id: string, color: Token): RefiningKindLook => ({ id, color, paint: piecePaint("refining", id) });

/** The kinds, in the order the engine numbers them: vapour, oil, tar, smoke, catalyst. */
export const REFINING_KINDS: readonly RefiningKindLook[] = [look("vapour", "ice"), look("oil", "sand"), look("tar", "rust"), look("smoke", "slate"), look("catalyst", "lilac")];

export const refiningKind = (kind: RefiningKind): RefiningKindLook => REFINING_KINDS[kind] ?? REFINING_KINDS[0]!;
