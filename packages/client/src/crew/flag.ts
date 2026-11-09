import type { CrewFlagWire } from "@openseas/protocol";
import { content, t } from "@openseas/boards";

/**
 * A crew's flag, painted once with Canvas 2D and shared by everything that shows it: the chips in
 * the cards, the editor's preview, and the textures on ships in the world (DESIGN.md 3.7). A flag
 * is a field color, a pattern and an emblem in the accent color. Every pattern and emblem is its
 * own shape, outlined in the field color, so two flags tell apart without color (rule 6).
 */

const rules = content.world.crews;
const hexOf = (id: string): string => rules.colors.find((c) => c.id === id)?.hex ?? "#777777";

/** A flag is three units wide for every two tall. */
export const FLAG_ASPECT = 1.5;

type Shape = { kind: "fill"; path: Path2D } | { kind: "line"; path: Path2D; width: number } | { kind: "cut"; path: Path2D };

const fill = (d: string | Path2D): Shape => ({ kind: "fill", path: typeof d === "string" ? new Path2D(d) : d });
const line = (d: string | Path2D, width: number): Shape => ({ kind: "line", path: typeof d === "string" ? new Path2D(d) : d, width });
const cut = (d: string | Path2D): Shape => ({ kind: "cut", path: typeof d === "string" ? new Path2D(d) : d });

function circle(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}

/** Part of an ellipse about (cx, cy), turned by `turn`, from angle `from` round to `to`. */
function arc(cx: number, cy: number, rx: number, ry: number, turn: number, from: number, to: number): Path2D {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, turn, from, to);
  return p;
}

/** A star polygon of `points` tips about (cx, cy), the first tip at `turn` radians from east. */
function star(cx: number, cy: number, points: number, outer: number, inner: number, turn: number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = turn + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

/** Emblems in a 100 by 100 box, drawn in order: each shape is haloed in the field color, then filled. */
const EMBLEMS: Record<string, () => Shape[]> = {
  skull: () => [
    line("M16 16 L84 84 M84 16 L16 84", 7),
    fill(circle(14, 14, 6)),
    fill(circle(86, 14, 6)),
    fill(circle(14, 86, 6)),
    fill(circle(86, 86, 6)),
    fill("M50 14 C30 14 20 28 20 45 C20 57 25 64 33 68 L33 80 L67 80 L67 68 C75 64 80 57 80 45 C80 28 70 14 50 14 Z"),
    cut(circle(39, 46, 7.5)),
    cut(circle(61, 46, 7.5)),
    cut("M50 56 L45 65 L55 65 Z"),
    cut("M41 71 h4 v9 h-4 Z M48 71 h4 v9 h-4 Z M55 71 h4 v9 h-4 Z"),
  ],
  rocket: () => [
    // Fins, the body with a porthole, and its flame.
    fill("M36 48 L16 74 L36 68 Z"),
    fill("M64 48 L84 74 L64 68 Z"),
    fill("M50 6 C64 20 66 40 66 64 L34 64 C34 40 36 20 50 6 Z"),
    cut(circle(50, 36, 7.5)),
    fill("M42 72 L58 72 L50 95 Z"),
  ],
  planet: () => [
    // The ring's far side, the planet over it, then the near side of the ring over the planet.
    line(arc(50, 50, 45, 13, -0.4, Math.PI, Math.PI * 2), 6),
    fill(circle(50, 50, 25)),
    line(arc(50, 50, 45, 13, -0.4, 0, Math.PI), 6),
  ],
  satellite: () => [
    // A body between two panels, an aerial with a ball on it.
    line("M34 52 L66 52", 5),
    fill("M6 38 H30 V66 H6 Z"),
    fill("M70 38 H94 V66 H70 Z"),
    cut("M17 38 h2.5 v28 h-2.5 Z M81 38 h2.5 v28 h-2.5 Z"),
    cut("M6 50.5 h24 v2.5 h-24 Z M70 50.5 h24 v2.5 h-24 Z"),
    fill("M38 36 H62 V68 H38 Z"),
    line("M50 36 L50 20", 5),
    fill(circle(50, 14, 7)),
    cut(circle(50, 52, 6)),
  ],
  star: () => [fill(star(50, 53, 5, 44, 18, -Math.PI / 2))],
  swords: () => [
    line("M20 82 L82 18 M80 82 L18 18", 6),
    line("M20 66 L36 82 M64 82 L80 66", 7),
    fill(circle(14, 88, 5.5)),
    fill(circle(86, 88, 5.5)),
  ],
  moon: () => [fill(circle(46, 50, 38)), cut(circle(62, 42, 31))],
  gear: () => {
    // Eight square teeth round a wheel, with a hole through its middle.
    const p = new Path2D();
    const teeth = 8;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const step = Math.PI / teeth;
      const corners: [number, number][] = [
        [a - step * 0.82, 31],
        [a - step * 0.5, 45],
        [a + step * 0.5, 45],
        [a + step * 0.82, 31],
      ];
      for (const [k, [at, r]] of corners.entries()) {
        const x = 50 + Math.cos(at) * r;
        const y = 50 + Math.sin(at) * r;
        if (i === 0 && k === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
    }
    p.closePath();
    return [fill(p), cut(circle(50, 50, 13))];
  },
  crown: () => [
    fill("M16 70 L11 30 L32 47 L50 20 L68 47 L89 30 L84 70 Z"),
    fill("M16 75 H84 V87 H16 Z"),
    fill(circle(11, 27, 5.5)),
    fill(circle(50, 17, 5.5)),
    fill(circle(89, 27, 5.5)),
    cut(circle(50, 57, 5.5)),
    cut(circle(31, 61, 4)),
    cut(circle(69, 61, 4)),
  ],
  flame: () => [
    fill("M50 6 C57 25 77 36 77 60 C77 79 64 92 50 92 C36 92 23 79 23 60 C23 46 33 39 37 26 C42 39 46 43 50 46 C54 36 50 21 50 6 Z"),
    cut("M50 52 C54 62 63 67 63 75 C63 83 57 88 50 88 C43 88 37 83 37 75 C37 67 46 62 50 52 Z"),
  ],
};

const shapeCache = new Map<string, Shape[]>();
function emblemShapes(id: string): Shape[] {
  let s = shapeCache.get(id);
  if (!s) {
    s = (EMBLEMS[id] ?? EMBLEMS.star!)();
    shapeCache.set(id, s);
  }
  return s;
}

/** Draw an emblem centered on (cx, cy), `size` across, in `ink`, haloed and cut in `ground`. */
export function drawEmblem(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, size: number, ink: string, ground: string): void {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const halo = 10;
  for (const s of emblemShapes(id)) {
    if (s.kind === "cut") {
      ctx.fillStyle = ground;
      ctx.fill(s.path);
      continue;
    }
    ctx.strokeStyle = ground;
    ctx.lineWidth = s.kind === "line" ? s.width + halo : halo;
    ctx.stroke(s.path);
    if (s.kind === "line") {
      ctx.strokeStyle = ink;
      ctx.lineWidth = s.width;
      ctx.stroke(s.path);
    } else {
      ctx.fillStyle = ink;
      ctx.fill(s.path);
    }
  }
  ctx.restore();
}

function drawPattern(ctx: CanvasRenderingContext2D, pattern: string, w: number, h: number): void {
  switch (pattern) {
    case "band":
      ctx.fillRect(0, h * 0.34, w, h * 0.32);
      return;
    case "pale":
      ctx.fillRect(w * 0.36, 0, w * 0.28, h);
      return;
    case "cross":
      ctx.fillRect(0, h * 0.4, w, h * 0.2);
      ctx.fillRect(w * 0.43, 0, w * 0.14, h);
      return;
    case "saltire":
      ctx.save();
      ctx.lineWidth = h * 0.2;
      ctx.lineCap = "square";
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.moveTo(w, 0);
      ctx.lineTo(0, h);
      ctx.stroke();
      ctx.restore();
      return;
    case "quarters":
      ctx.fillRect(0, 0, w / 2, h / 2);
      ctx.fillRect(w / 2, h / 2, w / 2, h / 2);
      return;
    case "border": {
      const b = h * 0.11;
      ctx.fillRect(0, 0, w, b);
      ctx.fillRect(0, h - b, w, b);
      ctx.fillRect(0, 0, b, h);
      ctx.fillRect(w - b, 0, b, h);
      return;
    }
    case "chevron":
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.42, h / 2);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      return;
    default:
      return;
  }
}

/** Paint a whole flag into a `w` by `h` area at the context's origin. */
export function drawFlag(ctx: CanvasRenderingContext2D, flag: CrewFlagWire, w: number, h: number): void {
  const field = hexOf(flag.field);
  const accent = hexOf(flag.accent);
  ctx.save();
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  drawPattern(ctx, flag.pattern, w, h);
  drawEmblem(ctx, flag.emblem, w / 2, h / 2, h * 0.8, accent, field);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = Math.max(1, h / 40);
  ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}

export const flagKey = (f: CrewFlagWire): string => `${f.field}.${f.accent}.${f.pattern}.${f.emblem}`;

const urls = new Map<string, string>();

/** The flag as an image URL `height` pixels tall, cached. */
export function flagDataUrl(flag: CrewFlagWire, height: number): string {
  const key = `${flagKey(flag)}@${height}`;
  let url = urls.get(key);
  if (url) return url;
  const canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.width = Math.round(height * FLAG_ASPECT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  drawFlag(ctx, flag, canvas.width, canvas.height);
  url = canvas.toDataURL();
  urls.set(key, url);
  return url;
}

/** Words for a flag, for screen readers and titles: "Rocket in Gold on Deep space, with a Cross". */
export function flagLabel(flag: CrewFlagWire): string {
  const name = (list: readonly { id: string; nameKey: string }[], id: string): string => t(list.find((x) => x.id === id)?.nameKey ?? id);
  return t(flag.pattern === "plain" ? "crew.flag_label_plain" : "crew.flag_label", {
    emblem: name(rules.emblems, flag.emblem),
    accent: name(rules.colors, flag.accent),
    field: name(rules.colors, flag.field),
    pattern: name(rules.patterns, flag.pattern),
  });
}

export { hexOf as flagColor };
