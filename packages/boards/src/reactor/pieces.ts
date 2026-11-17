import { FONT, css, type Token } from "../look/tokens.js";
import { bar, cut, disc, rounded, soft, type Ctx, type Paint } from "../kit/pictogram.js";

/**
 * Reactor's pieces, drawn in code as pictograms (docs/BRAND.md section 3, ADR 0062). A fuel rod is
 * seen from its end: a rounded casing. Its grade is the rule that matters, so the grade is part of
 * the drawing: a bold mono numeral cut out of the casing, with the ground showing through. The
 * colour steps with the grade as a second cue and is never the only one.
 *
 * A hot rod has an outline of its own, a casing that has burst into eight blunt points, so it is
 * told from a cool rod of any grade by its silhouette alone. It still carries its grade's numeral,
 * and it is the one rod drawn in danger: heat is what scrams the core.
 */

/** The piece colour of each cool grade, from grade 1. No rod is amber, and only a hot rod is danger. */
export const REACTOR_GRADE_COLORS: readonly Token[] = ["sky", "teal", "moss", "sand", "lilac", "rose", "rust", "slate"];

/** The colour a rod of `grade` is drawn in. */
export const reactorRodColor = (grade: number, hot: boolean): Token => (hot ? "danger" : REACTOR_GRADE_COLORS[(((grade - 1) % REACTOR_GRADE_COLORS.length) + REACTOR_GRADE_COLORS.length) % REACTOR_GRADE_COLORS.length]!);

/** The grade as a numeral, cut out of whatever is drawn. */
function numeral(ctx: Ctx, grade: number, size: number): void {
  cut(ctx, () => {
    ctx.font = `700 ${grade > 9 ? size * 0.8 : size}px ${FONT.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(grade), 12, 12.7);
  });
  // The ground itself is put behind the numeral, so it reads the same over an empty cell's dot.
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = css("ground");
  disc(ctx, 12, 12, 6.5);
  ctx.restore();
}

/** The eight blunt points of a hot rod, as a polygon round the middle of the square. */
const BURST: readonly number[] = (() => {
  const pts: number[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? 9 : 6.8;
    const a = -Math.PI / 2 + (i * Math.PI) / 8;
    pts.push(12 + r * Math.cos(a), 12 + r * Math.sin(a));
  }
  return pts;
})();

/** The drawing of a rod of `grade`, cool or hot, on the 24 unit square. */
export function reactorRodPaint(grade: number, hot: boolean): Paint {
  if (hot) {
    return (ctx) => {
      soft(ctx, BURST, 2);
      numeral(ctx, grade, 11.5);
    };
  }
  return (ctx) => {
    rounded(ctx, 2, 2, 20, 20, 5);
    numeral(ctx, grade, 14);
  };
}

export type ReactorPortMark = "idle" | "ready" | "blocked";

/** The colour a port's mark is drawn in: cream when a swipe would discharge, dim otherwise. */
export const reactorPortColor = (status: ReactorPortMark): Token => (status === "ready" ? "cream" : "dim");

/**
 * A port for the legend: the wall with a gap in it, and over the gap what the board draws there.
 * Nothing when it is idle, a chevron pointing out when a hot rod is first in its lane, a bar across
 * when a hot rod is in the lane behind another rod.
 */
export function reactorPortPaint(status: ReactorPortMark): Paint {
  return (ctx) => {
    bar(ctx, 3, 17, 6, 17, 3);
    bar(ctx, 18, 17, 21, 17, 3);
    if (status === "ready") {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(8, 14);
      ctx.lineTo(12, 9);
      ctx.lineTo(16, 14);
      ctx.stroke();
    } else if (status === "blocked") bar(ctx, 10.5, 17, 13.5, 17, 5.5);
  };
}
