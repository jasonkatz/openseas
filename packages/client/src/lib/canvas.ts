/** Sizes a canvas for the device pixel ratio and returns the 2D context scaled to CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
export function easeInOut(t: number): number { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }

/** Seven chunky, colour-blind-friendlier piece colours shared by all puzzles. */
export const PIECE_COLORS = [
  { base: '#e5484d', light: '#ff8a8e', dark: '#9b1c22', name: 'red' },
  { base: '#f5a524', light: '#ffd27a', dark: '#9c5b00', name: 'amber' },
  { base: '#3fb950', light: '#8ff0a0', dark: '#1d6b2a', name: 'green' },
  { base: '#2f81f7', light: '#8dc0ff', dark: '#103f8a', name: 'blue' },
  { base: '#a371f7', light: '#d7bcff', dark: '#5a2fa3', name: 'violet' },
  { base: '#29c6d6', light: '#9aeef7', dark: '#0d6a74', name: 'teal' },
  { base: '#f06ab2', light: '#ffb8de', dark: '#8d2a65', name: 'pink' },
  { base: '#c9c9c9', light: '#ffffff', dark: '#6a6a6a', name: 'bone' },
] as const;

/** A glossy rounded gem/tile. */
export function drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colorIdx: number, opts: { radius?: number; glow?: number; alpha?: number } = {}): void {
  const c = PIECE_COLORS[colorIdx % PIECE_COLORS.length]!;
  const pad = size * 0.08;
  const s = size - pad * 2;
  const r = opts.radius ?? s * 0.28;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.glow) {
    ctx.shadowColor = c.light;
    ctx.shadowBlur = opts.glow;
  }
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, c.light);
  g.addColorStop(0.45, c.base);
  g.addColorStop(1, c.dark);
  ctx.fillStyle = g;
  roundRect(ctx, x + pad, y + pad, s, s, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, x + pad + s * 0.14, y + pad + s * 0.1, s * 0.72, s * 0.28, r * 0.8);
  ctx.fill();
  // rim
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, size * 0.04);
  roundRect(ctx, x + pad, y + pad, s, s, r);
  ctx.stroke();
  ctx.restore();
}

/** Centered text with an outline for legibility over busy backgrounds. */
export function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill = '#fff', stroke = 'rgba(0,0,0,0.7)', align: CanvasTextAlign = 'center'): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Parchment panel background. */
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 14): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#1b2a3b';
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(240,217,168,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();
  ctx.restore();
}
