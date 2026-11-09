import { GunneryKind } from "@openseas/engine";
import { drawSprite, spriteRevision } from "../sprites/atlas.js";
import { paintMark } from "../cooling/tiles.js";

/**
 * Gunnery's own pieces, painted with Canvas 2D: a powder keg, a tied wad of cloth, an iron
 * cannonball and a bucket of water. Each has its own silhouette (a barrel, a square bundle, a
 * ball, a tapered bucket with a handle), so they read apart without color (CLAUDE.md rule 6);
 * with marks on, each also carries its symbol on a small badge in the corner. Every piece stands
 * on a soft shadow so it sits on the deck rather than in it.
 */

function shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  g.addColorStop(0, "rgba(0,0,0,0.42)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.38);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Powder: a squat keg of charred staves bound with brass hoops, a bung on top. */
function charge(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  shadow(ctx, cx, s * 0.86, s * 0.36);
  const top = s * 0.14;
  const bot = s * 0.84;
  const w = s * 0.62; // width at the ends
  const bulge = s * 0.08; // extra width at the belly
  const body = new Path2D();
  body.moveTo(cx - w / 2, top);
  body.quadraticCurveTo(cx - w / 2 - bulge * 2, (top + bot) / 2, cx - w / 2, bot);
  body.lineTo(cx + w / 2, bot);
  body.quadraticCurveTo(cx + w / 2 + bulge * 2, (top + bot) / 2, cx + w / 2, top);
  body.closePath();
  const wood = ctx.createLinearGradient(cx - w / 2 - bulge, 0, cx + w / 2 + bulge, 0);
  wood.addColorStop(0, "#1c1c22");
  wood.addColorStop(0.35, "#4a4a56");
  wood.addColorStop(0.55, "#3b3b47");
  wood.addColorStop(1, "#16161b");
  ctx.fillStyle = wood;
  ctx.fill(body);
  // Staves.
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(1, s * 0.018);
  for (let i = -2; i <= 2; i++) {
    const x = cx + i * w * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.quadraticCurveTo(x + i * bulge * 0.9, (top + bot) / 2, x, bot);
    ctx.stroke();
  }
  // Brass hoops, a little in from each end.
  for (const y of [top + s * 0.13, bot - s * 0.13]) {
    const hoop = ctx.createLinearGradient(0, y - s * 0.04, 0, y + s * 0.04);
    hoop.addColorStop(0, "#f2cf73");
    hoop.addColorStop(0.5, "#c9962f");
    hoop.addColorStop(1, "#7d5a17");
    ctx.fillStyle = hoop;
    ctx.fillRect(0, y - s * 0.04, s, s * 0.08);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.strokeStyle = "#0b0b0e";
  ctx.stroke(body);
  // The head, seen just over the rim, with a bung.
  ctx.beginPath();
  ctx.ellipse(cx, top, w / 2, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#55555f";
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.12, top, s * 0.05, s * 0.022, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#c9962f";
  ctx.fill();
}

/** Wad: a square bundle of cream sailcloth, puffed at the corners, tied across with twine. */
function sabot(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  const cy = s * 0.5;
  shadow(ctx, cx, s * 0.86, s * 0.36);
  const h = s * 0.33;
  const bundle = new Path2D();
  // A pillow: straight-ish sides pinched in a little, rounded corners.
  const p = h * 0.18;
  bundle.moveTo(cx - h, cy - h + p);
  bundle.quadraticCurveTo(cx - h, cy - h, cx - h + p, cy - h);
  bundle.quadraticCurveTo(cx, cy - h + p * 0.9, cx + h - p, cy - h);
  bundle.quadraticCurveTo(cx + h, cy - h, cx + h, cy - h + p);
  bundle.quadraticCurveTo(cx + h - p * 0.9, cy, cx + h, cy + h - p);
  bundle.quadraticCurveTo(cx + h, cy + h, cx + h - p, cy + h);
  bundle.quadraticCurveTo(cx, cy + h - p * 0.9, cx - h + p, cy + h);
  bundle.quadraticCurveTo(cx - h, cy + h, cx - h, cy + h - p);
  bundle.quadraticCurveTo(cx - h + p * 0.9, cy, cx - h, cy - h + p);
  bundle.closePath();
  const cloth = ctx.createRadialGradient(cx - h * 0.4, cy - h * 0.5, h * 0.1, cx, cy, h * 1.5);
  cloth.addColorStop(0, "#fffdf4");
  cloth.addColorStop(0.6, "#efe8d2");
  cloth.addColorStop(1, "#c9bd98");
  ctx.fillStyle = cloth;
  ctx.fill(bundle);
  // Folds running in to the knot.
  ctx.save();
  ctx.clip(bundle);
  ctx.strokeStyle = "rgba(120,100,60,0.35)";
  ctx.lineWidth = Math.max(1, s * 0.015);
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * h * 0.95, cy + dy * h * 0.95);
    ctx.quadraticCurveTo(cx + dx * h * 0.3, cy + dy * h * 0.55, cx + dx * h * 0.12, cy + dy * h * 0.12);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.strokeStyle = "#8d7b4f";
  ctx.stroke(bundle);
  // Twine, crossed and knotted in the middle.
  ctx.strokeStyle = "#9a6a32";
  ctx.lineWidth = Math.max(1.5, s * 0.045);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.98);
  ctx.lineTo(cx, cy + h * 0.98);
  ctx.moveTo(cx - h * 0.98, cy);
  ctx.lineTo(cx + h * 0.98, cy);
  ctx.stroke();
  ctx.fillStyle = "#7a4f20";
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

/** Shot: an iron cannonball, lit from the upper left, with a glint and a cast seam. */
function ball(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  const cy = s * 0.48;
  const r = s * 0.34;
  shadow(ctx, cx + s * 0.03, s * 0.84, s * 0.34);
  const iron = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r);
  iron.addColorStop(0, "#c3cbd6");
  iron.addColorStop(0.25, "#7c8794");
  iron.addColorStop(0.7, "#3b4350");
  iron.addColorStop(1, "#1a1e25");
  ctx.fillStyle = iron;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // A faint seam from the mould.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.3, -0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.strokeStyle = "#0e1116";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Glint.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.38, cy - r * 0.45, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** Water: a tapered wooden bucket with iron bands, a rope handle, brimming with blue water. */
function bucket(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  shadow(ctx, cx, s * 0.87, s * 0.32);
  const top = s * 0.3;
  const bot = s * 0.85;
  const wt = s * 0.66; // width at the mouth
  const wb = s * 0.46; // width at the foot
  // Rope handle behind the mouth.
  ctx.strokeStyle = "#caa36a";
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx - wt / 2 + s * 0.04, top + s * 0.02);
  ctx.quadraticCurveTo(cx, -s * 0.04, cx + wt / 2 - s * 0.04, top + s * 0.02);
  ctx.stroke();
  const body = new Path2D();
  body.moveTo(cx - wt / 2, top);
  body.lineTo(cx + wt / 2, top);
  body.lineTo(cx + wb / 2, bot);
  body.quadraticCurveTo(cx, bot + s * 0.04, cx - wb / 2, bot);
  body.closePath();
  const wood = ctx.createLinearGradient(cx - wt / 2, 0, cx + wt / 2, 0);
  wood.addColorStop(0, "#5f4a35");
  wood.addColorStop(0.4, "#b08a5f");
  wood.addColorStop(0.6, "#9c7a52");
  wood.addColorStop(1, "#4d3b29");
  ctx.fillStyle = wood;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = "rgba(40,25,10,0.45)";
  ctx.lineWidth = Math.max(1, s * 0.015);
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * wt * 0.2, top);
    ctx.lineTo(cx + i * wb * 0.2, bot);
    ctx.stroke();
  }
  for (const y of [top + s * 0.12, bot - s * 0.1]) {
    ctx.fillStyle = "#3a3f47";
    ctx.fillRect(0, y - s * 0.03, s, s * 0.06);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, y - s * 0.03, s, s * 0.015);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.strokeStyle = "#2a1c10";
  ctx.stroke(body);
  // The water at the mouth: the strongest blue on the deck, so a bucket reads at a glance.
  const coolant = ctx.createLinearGradient(0, top - s * 0.07, 0, top + s * 0.07);
  coolant.addColorStop(0, "#9fe0ff");
  coolant.addColorStop(1, "#2a8fe0");
  ctx.fillStyle = coolant;
  ctx.beginPath();
  ctx.ellipse(cx, top, wt / 2 - s * 0.02, s * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2a1c10";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.ellipse(cx - wt * 0.15, top - s * 0.015, wt * 0.12, s * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();
}

const PAINTERS: Record<number, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  [GunneryKind.Cell]: charge,
  [GunneryKind.Sabot]: sabot,
  [GunneryKind.Slug]: ball,
  [GunneryKind.Coolant]: bucket,
};

/** Paints one piece into an `s`-pixel square whose top-left corner is the context origin. */
export function paintGunneryPiece(ctx: CanvasRenderingContext2D, s: number, kind: number, mark: string | null): void {
  // Drawn a little larger than the painters' own proportions, so a piece fills most of its plank.
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.scale(PIECE_ZOOM, PIECE_ZOOM);
  ctx.translate(-s / 2, -s / 2);
  const name = ["cell", "sabot", "slug", "coolant"][kind];
  if (!name || !drawSprite(ctx, "gunnery", name, s * 0.06, s * 0.06, s * 0.88, s * 0.88)) PAINTERS[kind]?.(ctx, s);
  ctx.restore();
  if (mark) {
    // The shared mark on a badge in the lower right, so the piece itself stays recognisable.
    ctx.save();
    ctx.translate(s * 0.42, s * 0.42);
    paintMark(ctx, s * 0.6, mark);
    ctx.restore();
  }
}

const PIECE_ZOOM = 1.14;

/** A piece as its own canvas, `s` CSS pixels square at `resolution` device pixels per pixel. */
export function gunneryPieceCanvas(s: number, kind: number, mark: string | null, resolution: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(s * resolution);
  canvas.height = Math.ceil(s * resolution);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(resolution, resolution);
    paintGunneryPiece(ctx, s, kind, mark);
  }
  return canvas;
}

const urlCache = new Map<string, string>();

/** A data URL of a piece for the page legend; cached because legends re-render often. */
export function gunneryPieceUrl(kind: number, mark: string | null, px: number): string {
  const key = `${kind}|${mark ?? ""}|${px}|${spriteRevision()}`;
  let url = urlCache.get(key);
  if (!url) {
    url = gunneryPieceCanvas(px, kind, mark, 3).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
