import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PuzzleViewProps } from '../registry';
import { clamp, drawGem, drawPanel, easeInOut, easeOut, fitCanvas, outlinedText, roundRect } from '../../lib/canvas';
import { play } from '../../lib/audio';
// Engine source is imported relatively: the shared package only exposes its root entry.
// `engine.ts` has no side effects, so this never double-registers the puzzle.
import {
  COLS,
  CRAB,
  JELLY,
  PUFFER,
  ROWS,
  def,
  idx,
  type Action,
  type Piece,
  type State,
  type Step,
} from '../../../../shared/src/puzzles/bilging/engine';

const SWAP_MS = 120;
const POP_MS = 180;
const FALL_MS = 200;
const STEP_MS = POP_MS + FALL_MS;
const FLASH_MS = 1100;

const NAVY = '#0d1b2a';
const PARCHMENT = '#f0d9a8';
const BRASS = '#c89b3c';

interface Layout {
  cell: number;
  bx: number;
  by: number;
  boardW: number;
  boardH: number;
  hx: number;
  hy: number;
  hw: number;
  hh: number;
}

function layout(width: number, height: number): Layout {
  const pad = 12;
  const hudW = width >= 620 ? 220 : 148;
  const cell = Math.max(18, Math.floor(Math.min((width - hudW - pad * 3) / COLS, (height - pad * 2) / ROWS)));
  const boardW = cell * COLS;
  const boardH = cell * ROWS;
  const block = boardW + pad + hudW;
  const bx = Math.floor((width - block) / 2);
  const by = Math.floor((height - boardH) / 2);
  return { cell, bx, by, boardW, boardH, hx: bx + boardW + pad, hy: by, hw: hudW, hh: boardH };
}

/** Per-cell draw item, reused every frame to avoid allocation. */
interface Item {
  piece: Piece;
  dx: number; // offset in cells
  dy: number;
  alpha: number;
  scale: number;
  glow: number;
}

interface Anim {
  swapSeq: number;
  startedAt: number;
  swap: { x: number; y: number } | null;
  steps: Step[];
}

interface Flash {
  at: number;
  combo: number;
  cascades: number;
  points: number;
}

interface Input {
  cx: number; // cursor: left cell of the pair
  cy: number;
  sel: { x: number; y: number } | null; // mouse-selected cell
  drag: { x: number; y: number } | null;
}

function fillItems(items: Item[], board: readonly Piece[]): void {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    it.piece = board[i] ?? 0;
    it.dx = 0;
    it.dy = 0;
    it.alpha = 1;
    it.scale = 1;
    it.glow = 0;
  }
}

/** Resolves the animation layer into draw items for this frame. */
function computeFrame(items: Item[], state: State, anim: Anim, now: number): void {
  const t = now - anim.startedAt;
  const steps = anim.steps;
  if (anim.swap && t < SWAP_MS) {
    fillItems(items, steps[0]?.board ?? state.board);
    const p = easeInOut(clamp(t / SWAP_MS, 0, 1));
    const a = idx(anim.swap.x, anim.swap.y);
    const b = idx(anim.swap.x + 1, anim.swap.y);
    items[a]!.dx = 1 - p;
    items[b]!.dx = -(1 - p);
    return;
  }
  if (steps.length === 0) {
    fillItems(items, state.board);
    return;
  }
  const tt = t - SWAP_MS;
  const k = Math.floor(tt / STEP_MS);
  if (k < 0 || k >= steps.length) {
    fillItems(items, state.board);
    return;
  }
  const step = steps[k]!;
  const local = tt - k * STEP_MS;
  if (local < POP_MS) {
    fillItems(items, step.board);
    const p = clamp(local / POP_MS, 0, 1);
    for (const c of step.clears) {
      for (const cell of c.cells) {
        const it = items[cell]!;
        it.scale = 1 + 0.4 * Math.sin(p * Math.PI);
        it.alpha = 1 - p * p;
        it.glow = 16 * (1 - p);
      }
    }
    return;
  }
  fillItems(items, steps[k + 1]?.board ?? state.board);
  const p = clamp((local - POP_MS) / FALL_MS, 0, 1);
  const eased = p * p; // gravity: accelerate
  for (const f of step.falls) {
    items[idx(f.x, f.toY)]!.dy = (f.fromY - f.toY) * (1 - eased);
  }
}

// ---------------------------------------------------------------------------
// Special piece art

function drawCrab(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, opts: { alpha: number; glow: number }): void {
  drawGem(ctx, x, y, size, 7, { alpha: opts.alpha, glow: opts.glow });
  const cx = x + size / 2;
  const cy = y + size * 0.56;
  const s = size;
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  ctx.strokeStyle = '#8d2a2a';
  ctx.fillStyle = '#b8352f';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.lineCap = 'round';
  // legs
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.16, cy + i * s * 0.07);
    ctx.lineTo(cx - s * 0.32, cy + i * s * 0.1 + s * 0.06);
    ctx.moveTo(cx + s * 0.16, cy + i * s * 0.07);
    ctx.lineTo(cx + s * 0.32, cy + i * s * 0.1 + s * 0.06);
    ctx.stroke();
  }
  // body
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * 0.2, s * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  // claws
  ctx.beginPath();
  ctx.arc(cx - s * 0.22, cy - s * 0.14, s * 0.07, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.22, cy - s * 0.14, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - s * 0.06, cy - s * 0.06, s * 0.03, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.06, cy - s * 0.06, s * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPuffer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, now: number, opts: { alpha: number; glow: number }): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.3;
  const puff = 1 + 0.05 * Math.sin(now * 0.006);
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  if (opts.glow) {
    ctx.shadowColor = '#ffd27a';
    ctx.shadowBlur = opts.glow;
  }
  ctx.beginPath();
  const spikes = 14;
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (i / (spikes * 2)) * Math.PI * 2;
    const rr = (i % 2 === 0 ? r * 1.35 : r) * puff;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r * 1.4);
  g.addColorStop(0, '#ffe4a0');
  g.addColorStop(0.6, '#f5a524');
  g.addColorStop(1, '#9c5b00');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#5a3300';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.stroke();
  // eye + mouth
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.25, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.25, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5a3300';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.2, r * 0.3, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawJelly(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, now: number, opts: { alpha: number; glow: number }): void {
  const cx = x + size / 2;
  const cy = y + size * 0.48;
  const r = size * 0.3;
  const wob = Math.sin(now * 0.004 + x * 0.1) * 0.08;
  ctx.save();
  ctx.globalAlpha = opts.alpha;
  if (opts.glow) {
    ctx.shadowColor = '#ffb8de';
    ctx.shadowBlur = opts.glow;
  }
  // tentacles
  ctx.strokeStyle = 'rgba(240,160,255,0.75)';
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    const tx = cx + i * r * 0.35;
    ctx.beginPath();
    ctx.moveTo(tx, cy + r * 0.05);
    ctx.quadraticCurveTo(tx + Math.sin(now * 0.005 + i) * r * 0.25, cy + r * 0.6, tx + Math.sin(now * 0.003 + i * 1.7) * r * 0.3, cy + r * 1.15);
    ctx.stroke();
  }
  // dome
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * (1 + wob), r * (1 - wob), 0, Math.PI, Math.PI * 2);
  ctx.lineTo(cx + r * (1 + wob), cy + r * 0.12);
  ctx.quadraticCurveTo(cx, cy + r * 0.35, cx - r * (1 + wob), cy + r * 0.12);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r * 0.3);
  g.addColorStop(0, 'rgba(255,220,255,0.85)');
  g.addColorStop(1, 'rgba(200,120,240,0.45)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.stroke();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.45, r * 0.25, r * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, x: number, y: number, size: number, now: number, opts: { alpha: number; glow: number }): void {
  if (p === CRAB) drawCrab(ctx, x, y, size, opts);
  else if (p === PUFFER) drawPuffer(ctx, x, y, size, now, opts);
  else if (p === JELLY) drawJelly(ctx, x, y, size, now, opts);
  else drawGem(ctx, x, y, size, p, opts);
}

// ---------------------------------------------------------------------------
// Scene

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  state: State,
  now: number,
  width: number,
  height: number,
  focused: boolean,
  L: Layout,
  items: Item[],
  input: Input,
  flash: Flash | null,
): void {
  const { cell, bx, by, boardW, boardH } = L;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, width, height);

  // Board panel + hull planks.
  drawPanel(ctx, bx - 6, by - 6, boardW + 12, boardH + 12, 12);
  ctx.save();
  roundRect(ctx, bx, by, boardW, boardH, 8);
  ctx.clip();
  ctx.fillStyle = '#132131';
  ctx.fillRect(bx, by, boardW, boardH);
  ctx.strokeStyle = 'rgba(240,217,168,0.07)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(bx + x * cell + 0.5, by);
    ctx.lineTo(bx + x * cell + 0.5, by + boardH);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(bx, by + y * cell + 0.5);
    ctx.lineTo(bx + boardW, by + y * cell + 0.5);
    ctx.stroke();
  }

  // Selection / cursor backdrop.
  if (input.sel) {
    ctx.fillStyle = 'rgba(240,217,168,0.22)';
    ctx.fillRect(bx + input.sel.x * cell, by + input.sel.y * cell, cell, cell);
  }

  // Pieces (with per-cell animation).
  const waterY = by + boardH - clamp(state.water, 0, 1) * boardH;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const it = items[idx(x, y)]!;
      const px = bx + (x + it.dx) * cell;
      const py = by + (y + it.dy) * cell;
      if (py + cell < by - cell) continue;
      const submerged = py + cell * 0.6 > waterY;
      const alpha = it.alpha * (submerged ? 0.8 : 1);
      if (it.scale !== 1) {
        ctx.save();
        ctx.translate(px + cell / 2, py + cell / 2);
        ctx.scale(it.scale, it.scale);
        drawPiece(ctx, it.piece, -cell / 2, -cell / 2, cell, now, { alpha, glow: it.glow });
        ctx.restore();
      } else {
        drawPiece(ctx, it.piece, px, py, cell, now, { alpha, glow: it.glow });
      }
    }
  }

  // Water overlay with a gentle wave.
  if (state.water > 0) {
    ctx.beginPath();
    ctx.moveTo(bx, by + boardH);
    const step = 6;
    for (let x = 0; x <= boardW; x += step) {
      const wx = bx + x;
      const wy = waterY + Math.sin(x * 0.07 + now * 0.004) * 3 + Math.sin(x * 0.025 - now * 0.0022) * 2;
      ctx.lineTo(wx, wy);
    }
    ctx.lineTo(bx + boardW, by + boardH);
    ctx.closePath();
    const wg = ctx.createLinearGradient(0, waterY, 0, by + boardH);
    wg.addColorStop(0, 'rgba(70,150,230,0.42)');
    wg.addColorStop(1, 'rgba(20,70,150,0.6)');
    ctx.fillStyle = wg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,220,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= boardW; x += step) {
      const wx = bx + x;
      const wy = waterY + Math.sin(x * 0.07 + now * 0.004) * 3 + Math.sin(x * 0.025 - now * 0.0022) * 2;
      if (x === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();
  }

  // Danger vignette when nearly flooded.
  if (state.water > 0.7 && !state.over) {
    const pulse = 0.25 + 0.2 * Math.sin(now * 0.008);
    ctx.strokeStyle = `rgba(229,72,77,${pulse * ((state.water - 0.7) / 0.3)})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(bx, by, boardW, boardH);
  }

  // Cursor spanning two cells.
  if (!state.over) {
    const cx = bx + input.cx * cell;
    const cy = by + input.cy * cell;
    ctx.strokeStyle = focused ? PARCHMENT : 'rgba(240,217,168,0.45)';
    ctx.lineWidth = 3;
    roundRect(ctx, cx + 2, cy + 2, cell * 2 - 4, cell - 4, 6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    roundRect(ctx, cx + 4, cy + 4, cell * 2 - 8, cell - 8, 5);
    ctx.stroke();
  }

  // Combo / points flash.
  if (flash && now - flash.at < FLASH_MS) {
    const p = (now - flash.at) / FLASH_MS;
    const rise = easeOut(p) * cell * 1.2;
    ctx.save();
    ctx.globalAlpha = 1 - p * p;
    const fy = by + boardH * 0.4 - rise;
    const big = Math.max(16, Math.round(cell * 0.7));
    if (flash.combo >= 2 || flash.cascades >= 2) {
      const label = flash.cascades >= 2 ? `Combo ×${flash.combo}! Cascade ×${flash.cascades}` : `Combo ×${flash.combo}!`;
      outlinedText(ctx, label, bx + boardW / 2, fy, `bold ${Math.min(big, 22)}px Georgia, serif`, '#ffd27a');
      outlinedText(ctx, `+${flash.points}`, bx + boardW / 2, fy + big, `bold ${big}px Georgia, serif`, PARCHMENT);
    } else {
      outlinedText(ctx, `+${flash.points}`, bx + boardW / 2, fy, `bold ${big}px Georgia, serif`, PARCHMENT);
    }
    ctx.restore();
  }

  // Game over.
  if (state.over) {
    ctx.fillStyle = 'rgba(13,27,42,0.6)';
    ctx.fillRect(bx, by, boardW, boardH);
    const msg = state.endReason === 'flooded' ? 'Flooded!' : "Time's up";
    outlinedText(ctx, msg, bx + boardW / 2, by + boardH / 2 - 10, `bold ${Math.round(cell * 0.9)}px Georgia, serif`, state.endReason === 'flooded' ? '#8dc0ff' : PARCHMENT);
    outlinedText(ctx, `${state.points} pts`, bx + boardW / 2, by + boardH / 2 + cell * 0.6, `bold ${Math.round(cell * 0.55)}px Georgia, serif`, BRASS);
  }
  ctx.restore();

  drawHud(ctx, state, now, L, flash);
}

function drawHud(ctx: CanvasRenderingContext2D, state: State, now: number, L: Layout, flash: Flash | null): void {
  const { hx, hy, hw, hh } = L;
  drawPanel(ctx, hx, hy, hw, hh, 12);
  const narrow = hw < 190;
  const pad = narrow ? 10 : 14;
  let y = hy + pad + 10;
  const sc = def.score(state);

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = BRASS;
  ctx.font = `bold ${narrow ? 15 : 18}px Georgia, serif`;
  ctx.fillText('BILGING', hx + pad, y);
  y += narrow ? 24 : 30;

  const label = (t: string) => {
    ctx.fillStyle = 'rgba(240,217,168,0.65)';
    ctx.font = `${narrow ? 11 : 12}px sans-serif`;
    ctx.fillText(t.toUpperCase(), hx + pad, y);
    y += narrow ? 14 : 16;
  };
  const value = (t: string, color = PARCHMENT, size = narrow ? 20 : 26) => {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px Georgia, serif`;
    ctx.fillText(t, hx + pad, y);
    y += size + (narrow ? 8 : 12);
  };

  label('Points');
  value(String(state.points));
  label('Rating');
  const perfColor = sc.performance >= 0.7 ? '#8ff0a0' : sc.performance >= 0.3 ? PARCHMENT : '#ff8a8e';
  value(sc.label, perfColor, narrow ? 16 : 20);
  // Rating bar.
  const barW = hw - pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, hx + pad, y - 6, barW, 8, 4);
  ctx.fill();
  ctx.fillStyle = perfColor;
  roundRect(ctx, hx + pad, y - 6, Math.max(4, barW * sc.performance), 8, 4);
  ctx.fill();
  y += narrow ? 14 : 18;

  label('Time');
  value(fmtTime(state.durationMs - state.elapsedMs), state.durationMs - state.elapsedMs < 15_000 ? '#ff8a8e' : PARCHMENT, narrow ? 18 : 22);

  // Water gauge.
  label('Bilge water');
  const pct = Math.round(state.water * 100);
  const waterColor = state.water > 0.7 ? '#ff8a8e' : state.water > 0.4 ? '#ffd27a' : '#8dc0ff';
  value(`${pct}%`, waterColor, narrow ? 18 : 22);
  const gaugeH = Math.max(40, Math.min(110, hh * 0.18));
  const gaugeW = Math.min(barW, 60);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, hx + pad, y - 4, gaugeW, gaugeH, 6);
  ctx.fill();
  const fillH = gaugeH * clamp(state.water, 0, 1);
  const wobble = Math.sin(now * 0.004) * 1.5;
  ctx.save();
  roundRect(ctx, hx + pad, y - 4, gaugeW, gaugeH, 6);
  ctx.clip();
  ctx.fillStyle = 'rgba(70,150,230,0.75)';
  ctx.fillRect(hx + pad, y - 4 + gaugeH - fillH + wobble, gaugeW, fillH + 4);
  ctx.restore();
  ctx.strokeStyle = 'rgba(240,217,168,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, hx + pad, y - 4, gaugeW, gaugeH, 6);
  ctx.stroke();
  y += gaugeH + (narrow ? 10 : 14);

  // Combo readout.
  if (flash && now - flash.at < FLASH_MS * 2 && (flash.combo >= 2 || flash.cascades >= 2)) {
    ctx.fillStyle = '#ffd27a';
    ctx.font = `bold ${narrow ? 13 : 15}px Georgia, serif`;
    ctx.fillText(`Combo ×${flash.combo}`, hx + pad, y);
    y += narrow ? 16 : 20;
  }

  // Controls hint pinned to the bottom.
  ctx.fillStyle = 'rgba(240,217,168,0.6)';
  ctx.font = `${narrow ? 10 : 11}px sans-serif`;
  const hints = narrow
    ? ['Click two neighbours', 'or drag to swap.', 'Arrows move,', 'Space swaps.']
    : ['Click a piece, then its neighbour', '(or drag) to swap.', 'Arrows move the cursor,', 'Space / Enter swaps.'];
  let hy2 = hy + hh - pad - (hints.length - 1) * 13 - 4;
  for (const h of hints) {
    ctx.fillText(h, hx + pad, hy2);
    hy2 += 13;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Component

export default function BilgingView({ state, dispatch, width, height, now, focused }: PuzzleViewProps<State, Action>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const itemsRef = useRef<Item[]>([]);
  const animRef = useRef<Anim>({ swapSeq: -1, startedAt: 0, swap: null, steps: [] });
  const flashRef = useRef<Flash | null>(null);
  const inputRef = useRef<Input>({ cx: Math.floor((COLS - 1) / 2), cy: Math.floor(ROWS / 2), sel: null, drag: null });
  const layoutRef = useRef<Layout>(layout(width, height));
  const stateRef = useRef(state);
  const nowRef = useRef(now);
  const focusedRef = useRef(focused);
  const dispatchRef = useRef(dispatch);
  stateRef.current = state;
  nowRef.current = now;
  focusedRef.current = focused;
  dispatchRef.current = dispatch;

  if (itemsRef.current.length === 0) {
    for (let i = 0; i < COLS * ROWS; i++) itemsRef.current.push({ piece: 0, dx: 0, dy: 0, alpha: 1, scale: 1, glow: 0 });
  }

  // Sound + flash cues keyed on engine sequence counters.
  const prevSeqs = useRef({ swap: state.swapSeq, clear: state.clearSeq, over: state.over });
  useEffect(() => {
    const prev = prevSeqs.current;
    if (state.swapSeq !== prev.swap) {
      if (state.clearSeq !== prev.clear) {
        if (state.lastCombo >= 2 || state.lastCascades >= 2) play('combo', state.lastCombo + state.lastCascades);
        else play('match');
        flashRef.current = { at: nowRef.current, combo: state.lastCombo, cascades: state.lastCascades, points: state.lastPoints };
      } else {
        play('swap');
      }
    }
    if (state.over && !prev.over) play(state.endReason === 'flooded' ? 'bad' : 'bell');
    prevSeqs.current = { swap: state.swapSeq, clear: state.clearSeq, over: state.over };
  }, [state.swapSeq, state.clearSeq, state.over, state.lastCombo, state.lastCascades, state.lastPoints, state.endReason]);

  // Draw every frame.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const L = layout(width, height);
    layoutRef.current = L;
    const anim = animRef.current;
    if (anim.swapSeq !== state.swapSeq) {
      anim.swapSeq = state.swapSeq;
      anim.startedAt = now;
      anim.swap = state.lastSwap;
      anim.steps = state.lastSteps;
    }
    computeFrame(itemsRef.current, state, anim, now);
    drawScene(ctx, state, now, width, height, focused, L, itemsRef.current, inputRef.current, flashRef.current);
  }, [state, now, width, height, focused]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!focusedRef.current) return;
      const inp = inputRef.current;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': inp.cx = Math.max(0, inp.cx - 1); break;
        case 'ArrowRight': case 'd': case 'D': inp.cx = Math.min(COLS - 2, inp.cx + 1); break;
        case 'ArrowUp': case 'w': case 'W': inp.cy = Math.max(0, inp.cy - 1); break;
        case 'ArrowDown': case 's': case 'S': inp.cy = Math.min(ROWS - 1, inp.cy + 1); break;
        case ' ': case 'Enter': case 'z': case 'Z': case 'x': case 'X':
          inp.sel = null;
          if (!stateRef.current.over) dispatchRef.current({ type: 'swap', x: inp.cx, y: inp.cy });
          else play('bad');
          break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pointer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toCell = (e: PointerEvent): { x: number; y: number; fx: number } | null => {
      const r = canvas.getBoundingClientRect();
      const L = layoutRef.current;
      const fx = (e.clientX - r.left - L.bx) / L.cell;
      const fy = (e.clientY - r.top - L.by) / L.cell;
      if (fx < 0 || fy < 0 || fx >= COLS || fy >= ROWS) return null;
      return { x: Math.floor(fx), y: Math.floor(fy), fx };
    };
    const doSwap = (x: number, y: number) => {
      const inp = inputRef.current;
      inp.cx = clamp(x, 0, COLS - 2);
      inp.cy = y;
      inp.sel = null;
      inp.drag = null;
      if (stateRef.current.over) {
        play('bad');
        return;
      }
      dispatchRef.current({ type: 'swap', x: inp.cx, y });
    };
    const onDown = (e: PointerEvent) => {
      if (!focusedRef.current) return;
      const c = toCell(e);
      const inp = inputRef.current;
      if (!c) {
        inp.sel = null;
        return;
      }
      e.preventDefault();
      const frac = c.fx - c.x;
      // Clicking the seam between two cells swaps them directly.
      if (frac < 0.2 && c.x > 0) return doSwap(c.x - 1, c.y);
      if (frac > 0.8 && c.x < COLS - 1) return doSwap(c.x, c.y);
      if (inp.sel && inp.sel.y === c.y && Math.abs(inp.sel.x - c.x) === 1) return doSwap(Math.min(inp.sel.x, c.x), c.y);
      if (inp.sel && (inp.sel.x !== c.x || inp.sel.y !== c.y)) play('tap');
      inp.sel = { x: c.x, y: c.y };
      inp.drag = { x: c.x, y: c.y };
      inp.cx = clamp(c.x, 0, COLS - 2);
      inp.cy = c.y;
      play('tap');
    };
    const onMove = (e: PointerEvent) => {
      const inp = inputRef.current;
      const c = toCell(e);
      if (!c) return;
      if (inp.drag) {
        if (c.y === inp.drag.y && Math.abs(c.x - inp.drag.x) === 1) doSwap(Math.min(c.x, inp.drag.x), c.y);
        else if (c.y !== inp.drag.y) inp.drag = { x: c.x, y: c.y };
      } else if (!inp.sel) {
        inp.cx = clamp(c.x, 0, COLS - 2);
        inp.cy = c.y;
      }
    };
    const onUp = () => {
      inputRef.current.drag = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width, height, touchAction: 'none', cursor: 'pointer', userSelect: 'none' }}
      aria-label={`Bilging: ${state.points} points, water ${Math.round(state.water * 100)} percent`}
    />
  );
}
