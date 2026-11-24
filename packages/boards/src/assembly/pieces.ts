import { ASSEMBLY_CORE } from "@openseas/engine";
import type { Token } from "../look/tokens.js";
import type { Paint } from "../kit/pictogram.js";
import { piecePaint } from "../look/pieces.js";

/**
 * Assembly's pieces, as pictograms (docs/BRAND.md section 3, ADR 0062). The bay is a shipyard's
 * parts, and each kind's outline is the way it moves: the girder a long beam lying flat, pointed at
 * both ends, the strut the same beam standing up, the cable a beam laid corner to corner with its
 * strands showing, and the panel a square plate with four rivets, which has no way of its own. The
 * core is a hex nut with its eye cut through, the one part that never moves. Each is drawn from its
 * layers in `data/pieces/assembly.json` (ADR 0065), by its id. Colour is a second cue, never the
 * only one: no kind is amber, which is the player's own hand, and only the core is cream.
 */

export interface AssemblyKind {
  /** The message key's suffix: the legend reads `assembly.kind.<id>`, and its drawing is the piece of that name. */
  readonly id: string;
  readonly color: Token;
  readonly paint: Paint;
}

const kind = (id: string, color: Token): AssemblyKind => ({ id, color, paint: piecePaint("assembly", id) });

/** The parts, in the order the engine numbers them. */
export const ASSEMBLY_KINDS: readonly AssemblyKind[] = [kind("panel", "sand"), kind("girder", "sky"), kind("strut", "moss"), kind("cable", "lilac")];

/** The core: the bay's one fixed piece, and its prize. */
export const ASSEMBLY_CORE_KIND: AssemblyKind = kind("core", "cream");

/** A kind as the board draws it, the core included. */
export const assemblyKind = (k: number): AssemblyKind => (k === ASSEMBLY_CORE ? ASSEMBLY_CORE_KIND : ASSEMBLY_KINDS[((k % 4) + 4) % 4]!);
