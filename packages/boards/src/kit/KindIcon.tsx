import type { SpritePuzzle } from "../sprites/atlas.js";
import { INK, KINDS, PIPS, hex, kindStyle, mix, shapePoints } from "./art.js";
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

/** A placeholder piece as an inline SVG, for legends and HUD rows: the same silhouette and color the board draws (ADR 0036). */
export function KindIcon({ kind, size = 22, marks = false, hollow = false, color, sprite }: KindIconProps) {
  const style = kindStyle(kind);
  const fill = color ?? style.color;
  const r = 9;
  const pts = shapePoints(style.shape, 12, 12, r);
  const d = pts ? `M${pts.map((v, i) => (i % 2 === 0 ? `${v.toFixed(2)},` : `${v.toFixed(2)} `)).join("")}Z` : null;
  const common = hollow
    ? { fill: hex(fill), fillOpacity: 0.12, stroke: hex(fill), strokeWidth: 1.6 }
    : { fill: hex(fill), stroke: hex(mix(fill, INK.black, 0.45)), strokeWidth: 1.2 };
  const pips = PIPS[kind % KINDS.length]!;
  const vector = (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      {d ? <path d={d} strokeLinejoin="round" {...common} /> : <circle cx="12" cy="12" r={r} {...common} />}
      {marks && !hollow && pips.map(([dx, dy], i) => <circle key={i} cx={12 + dx * 3.2} cy={12 + dy * 3.2} r="1.15" fill="#000" fillOpacity="0.78" />)}
    </svg>
  );
  if (!sprite) return vector;
  // Over a sprite the pips sit on a dark plate, as `drawMark` puts them on the board.
  return (
    <SpriteIcon puzzle={sprite.puzzle} name={sprite.name} size={size} fill={sprite.fill ?? false} fallback={vector}>
      {marks && !hollow && (
        <>
          <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="1.9" fill={hex(INK.bg)} fillOpacity="0.86" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.5" />
          {pips.map(([dx, dy], i) => (
            <circle key={i} cx={12 + dx * 3.2} cy={12 + dy * 3.2} r="1.15" fill="#fff" />
          ))}
        </>
      )}
    </SpriteIcon>
  );
}
