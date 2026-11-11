import type { MarkName } from "@openseas/content";
import { useSprites } from "../sprites/useSprites.js";
import { MarkGlyph } from "../marks/MarkGlyph.jsx";
import { starPath, starSpriteUrl, type StarShapeName } from "./stars.js";

/** A star for legends and the HUD, drawn as inline SVG with the same silhouettes as the chart. */
export function StarIcon(props: { shape: StarShapeName; color: string; mark?: MarkName | null; hollow?: boolean; size?: number }) {
  useSprites("navigation");
  const size = props.size ?? 22;
  const r = size * 0.42;
  const c = size / 2;
  const d = starPath(props.shape, c, c, r);
  const src = props.hollow ? undefined : starSpriteUrl(props.shape, parseInt(props.color.slice(1), 16), size);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="tile-icon">
      {src ? <image href={src} x={0} y={0} width={size} height={size} /> : props.hollow ? (
        <path d={d} fill={props.color} fillOpacity={0.12} stroke={props.color} strokeWidth={Math.max(1.5, r * 0.14)} strokeLinejoin="round" />
      ) : (
        <>
          <path d={d} fill={props.color} stroke="rgba(255,255,255,0.55)" strokeWidth={Math.max(1, r * 0.08)} strokeLinejoin="round" />
          <circle cx={c} cy={c} r={r * 0.22} fill="rgba(255,255,255,0.75)" />
        </>
      )}
      {props.mark && <MarkGlyph mark={props.mark} x={c} y={c} half={r * 0.3} fill={props.hollow ? props.color : "#0b1526"} />}
    </svg>
  );
}
