import type { SpritePuzzle } from "../sprites/atlas.js";
import { INK, KINDS, PIPS, ROUND, hex, kindStyle, shapePoints } from "./art.js";
import { SpriteIcon } from "./SpriteIcon.jsx";

export interface KindIconProps {
  kind: number;
  size?: number;
  /** Draw the kind's pips, as the board does with marks on. */
  marks?: boolean;
  hollow?: boolean;
  /** Override the kind's color. */
  color?: number;
  /** The board's atlas frame for this kind. The vector piece stands in until it loads, and for a kind the sheet lacks. */
  sprite?: { puzzle: SpritePuzzle; name: string; fill?: boolean };
}

/**
 * A placeholder piece as an inline SVG, for legends and HUD rows: the same flat silhouette and
 * colour the board draws (ADR 0036). For a board not restyled yet; a restyled one shows its own
 * pictograms with `PictogramIcon`.
 */
export function KindIcon({ kind, size = 22, marks = false, hollow = false, color, sprite }: KindIconProps) {
  const style = kindStyle(kind);
  const fill = hex(color ?? style.color);
  const r = 10;
  // Corners are rounded as the board rounds them: the outline drawn smaller and stroked in its own colour.
  const pts = shapePoints(style.shape, 12, 12, r * (1 - ROUND));
  const d = pts ? `M${pts.map((v, i) => (i % 2 === 0 ? `${v.toFixed(2)},` : `${v.toFixed(2)} `)).join("")}Z` : null;
  const common = hollow ? { fill: "none", stroke: fill, strokeWidth: r * 0.2 } : { fill, stroke: fill, strokeWidth: d ? r * ROUND * 2 : 0 };
  const pips = PIPS[kind % KINDS.length]!;
  const vector = (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      {d ? <path d={d} strokeLinejoin="round" {...common} /> : <circle cx="12" cy="12" r={hollow ? r * 0.9 : r} {...common} />}
      {marks && !hollow && pips.map(([dx, dy], i) => <circle key={i} cx={12 + dx * 3.2} cy={12 + dy * 3.2} r="1.15" fill={hex(INK.ground)} />)}
    </svg>
  );
  if (!sprite) return vector;
  // Over a sprite the pips sit on a ground plate, as `drawMark` puts them on the board.
  return (
    <SpriteIcon puzzle={sprite.puzzle} name={sprite.name} size={size} fill={sprite.fill ?? false} fallback={vector}>
      {marks && !hollow && (
        <>
          <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="1.9" fill={hex(INK.ground)} />
          {pips.map(([dx, dy], i) => (
            <circle key={i} cx={12 + dx * 3.2} cy={12 + dy * 3.2} r="1.15" fill={hex(INK.cream)} />
          ))}
        </>
      )}
    </SpriteIcon>
  );
}
