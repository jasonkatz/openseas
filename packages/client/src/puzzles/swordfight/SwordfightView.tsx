import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PuzzleViewProps } from '../registry';
import { clamp, drawGem, drawPanel, easeOut, fitCanvas, outlinedText, roundRect } from '../../lib/canvas';
import { play } from '../../lib/audio';
// Engine source is imported relatively: the shared package only exposes its root entry.
// `engine.ts` has no side effects, so this never double-registers the puzzle.
import {
  COLS,
  HIDDEN_ROWS,
  JUNK,
  ROWS,
  def,
  landingCells,
  pairCells,
  type Action,
  type Block,
  type Cell,
  type ClearedCell,
  type Pair,
  type State,
} from '../../../../shared/src/puzzles/swordfight/engine';

const VIS_ROWS = ROWS - HIDDEN_ROWS;
const NAVY = '#0d1b2a';
const WELL = '#08131f';
const PARCHMENT = '#f0d9a8';
const BRASS = '#c89b3c';
const TEAL = '#29c6d6';
const RED = '#e5484d';
const SIDE_COLORS = [TEAL, RED];
/** Engine colour 0..3 -> PIECE_COLORS index (red, green, blue, amber). */
const COLOR_IDX = [0, 2, 3, 1] as const;

const POP_MS = 320;
const PASS_STAGGER_MS = 140;
const CALLOUT_MS = 1100;
const FLASH_MS = 380;
const HUD_H = 50;
const BAR_H = 54;

type Props = PuzzleViewProps<State, Action>;
type Other = NonNullable<Props['others']>[number];

interface Layout {
  cell: number;
  mx: number; // threat meter x
  meterW: number;
  bx: number;
  by: number;
  boardW: number;
  boardH: number;
  sx: number; // side panel x
  sideW: number;
  ox: number; // others area
  oy: number;
  ow: number;
  oh: number;
  barY: number;
}

function layout(width: number, height: number, nOthers: number): Layout {
  const pad = 10;
  const availH = height - HUD_H - BAR_H - pad * 2;
  const meterW = 26;
  const sideW = width >= 560 ? 100 : 76;
  const leftFrac = nOthers > 0 ? (width >= 700 ? 0.58 : 0.62) : 1;
  const leftW = Math.floor(width * leftFrac) - pad * 2;
  const cell = clamp(Math.floor(Math.min(availH / VIS_ROWS, (leftW - meterW - sideW - pad * 2) / COLS)), 12, 60);
  const boardW = cell * COLS;
  const boardH = cell * VIS_ROWS;
  const groupW = meterW + pad + boardW + pad + sideW;
  const gx = pad + Math.floor((Math.floor(width * leftFrac) - pad * 2 - groupW) / 2);
  const by = HUD_H + pad + Math.floor((availH - boardH) / 2);
  const ox = gx + groupW + pad;
  return {
    cell,
    mx: gx,
    meterW,
    bx: gx + meterW + pad,
    by,
    boardW,
    boardH,
    sx: gx + meterW + pad + boardW + pad,
    sideW,
    ox,
    oy: HUD_H + pad,
    ow: Math.max(0, width - ox - pad),
    oh: availH,
    barY: height - BAR_H,
  };
}

interface Button {
  id: string;
  label: string;
  action: Action;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Anim {
  lockSeq: number;
  clearSeq: number;
  garbageSeq: number;
  visX: number;
  visY: number;
  lastNow: number;
  pops: ClearedCell[];
  popAt: number;
  callout: string;
  calloutAt: number;
  flashAt: number;
  shakeAt: number;
}

function freshAnim(s: State): Anim {
  return {
    lockSeq: s.lockSeq,
    clearSeq: s.clearSeq,
    garbageSeq: s.garbageSeq,
    visX: s.cur?.x ?? 2,
    visY: s.cur?.y ?? 1,
    lastNow: 0,
    pops: [],
    popAt: -1e9,
    callout: '',
    calloutAt: -1e9,
    flashAt: -1e9,
    shakeAt: -1e9,
  };
}

// ---------------------------------------------------------------------------
// drawing primitives

function drawJunk(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha = 1): void {
  const pad = size * 0.08;
  const s = size - pad * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#8d939b');
  g.addColorStop(0.5, '#5f666e');
  g.addColorStop(1, '#3a4047');
  ctx.fillStyle = g;
  roundRect(ctx, x + pad, y + pad, s, s, s * 0.14);
  ctx.fill();
  // chisel marks
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.beginPath();
  ctx.moveTo(x + pad + s * 0.2, y + pad + s * 0.35);
  ctx.lineTo(x + pad + s * 0.45, y + pad + s * 0.2);
  ctx.moveTo(x + pad + s * 0.5, y + pad + s * 0.8);
  ctx.lineTo(x + pad + s * 0.8, y + pad + s * 0.55);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(x + pad + s * 0.25, y + pad + s * 0.4);
  ctx.lineTo(x + pad + s * 0.5, y + pad + s * 0.25);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, size * 0.04);
  roundRect(ctx, x + pad, y + pad, s, s, s * 0.14);
  ctx.stroke();
  ctx.restore();
}

function drawBurst(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // four-point star
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.28, cy - r * 0.28);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx + r * 0.28, cy + r * 0.28);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.28, cy + r * 0.28);
  ctx.lineTo(cx - r, cy);
  ctx.lineTo(cx - r * 0.28, cy - r * 0.28);
  ctx.closePath();
  ctx.fill();
  // cross-hatch
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy - r * 0.6);
  ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
  ctx.moveTo(cx + r * 0.6, cy - r * 0.6);
  ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, b: Block, now: number, alpha = 1, detail = true): void {
  if (b.color === JUNK) {
    drawJunk(ctx, x, y, size, alpha);
    return;
  }
  const idx = COLOR_IDX[b.color] ?? 0;
  if (b.breaker) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 160 + x * 0.05);
    drawGem(ctx, x, y, size, idx, { glow: detail ? 6 + pulse * 10 : 0, alpha });
    drawBurst(ctx, x + size / 2, y + size / 2, size * (0.26 + pulse * 0.06), alpha * (0.7 + pulse * 0.3));
  } else {
    drawGem(ctx, x, y, size, idx, { alpha });
  }
}

function drawSword(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, len * 0.16);
  ctx.beginPath();
  ctx.moveTo(-len * 0.5, 0);
  ctx.lineTo(len * 0.35, 0);
  ctx.stroke();
  ctx.strokeStyle = BRASS;
  ctx.beginPath();
  ctx.moveTo(-len * 0.3, -len * 0.22);
  ctx.lineTo(-len * 0.3, len * 0.22);
  ctx.stroke();
  ctx.strokeStyle = '#5a3a1a';
  ctx.beginPath();
  ctx.moveTo(-len * 0.32, 0);
  ctx.lineTo(-len * 0.5, 0);
  ctx.stroke();
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.28);
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size * 0.5;
  ctx.lineWidth = Math.max(2, size * 0.1);
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(13,27,42,0.75)';
  roundRect(ctx, -w / 2, -size * 0.65, w, size * 1.3, size * 0.15);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, 0, size * 0.04);
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, grid: Cell[][], x0: number, y0: number, cell: number, now: number, detail: boolean): void {
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < COLS; x++) {
      const c = row[x];
      if (c) drawBlock(ctx, x0 + x * cell, y0 + (y - HIDDEN_ROWS) * cell, cell, c, now, 1, detail);
    }
  }
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

export default function SwordfightView({ state, dispatch, width, height, now, focused, others }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<Anim | null>(null);
  const buttonsRef = useRef<Button[]>([]);
  const layoutRef = useRef<Layout | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // --- keyboard -------------------------------------------------------------
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent): void => {
      let a: Action | null = null;
      let drop = false;
      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          a = { type: 'left' };
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          a = { type: 'right' };
          break;
        case 'ArrowUp':
        case 'x':
        case 'X':
        case 'w':
        case 'W':
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          a = { type: 'rotateCW' };
          break;
        case 'z':
        case 'Z':
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          a = { type: 'rotateCCW' };
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          a = { type: 'softDrop' };
          break;
        case ' ':
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          a = { type: 'hardDrop' };
          drop = true;
          break;
        default:
          return;
      }
      e.preventDefault();
      if (stateRef.current.over) return;
      if (drop) play('drop');
      dispatch(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, dispatch]);

  // --- pointer / touch ------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      e.preventDefault();
      if (stateRef.current.over) return;
      for (const b of buttonsRef.current) {
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          if (b.action.type === 'hardDrop') play('drop');
          else play('tap');
          dispatch(b.action);
          return;
        }
      }
      const L = layoutRef.current;
      if (!L) return;
      if (px >= L.bx && px <= L.bx + L.boardW && py >= L.by && py <= L.by + L.boardH) {
        const t = (px - L.bx) / L.boardW;
        if (t < 0.33) dispatch({ type: 'left' });
        else if (t > 0.67) dispatch({ type: 'right' });
        else dispatch({ type: 'rotateCW' });
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    return () => canvas.removeEventListener('pointerdown', onDown);
  }, [dispatch]);

  // --- render ---------------------------------------------------------------
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const visible = (others ?? []).filter((o) => !o.isSelf);
    const L = layout(width, height, visible.length);
    layoutRef.current = L;
    const s = state;

    // animation bookkeeping
    let A = animRef.current;
    if (!A) {
      A = freshAnim(s);
      A.lastNow = now;
      animRef.current = A;
    }
    const dt = Math.max(0, Math.min(100, now - A.lastNow));
    A.lastNow = now;
    if (s.lockSeq !== A.lockSeq) {
      A.lockSeq = s.lockSeq;
      play('lock');
      if (s.cur) {
        A.visX = s.cur.x;
        A.visY = s.cur.y;
      }
    }
    if (s.clearSeq !== A.clearSeq) {
      A.clearSeq = s.clearSeq;
      A.pops = s.lastClears;
      A.popAt = now;
      play('sword');
      if (s.chain >= 2) {
        play('combo', s.chain);
        A.callout = `Chain ×${s.chain}!`;
        A.calloutAt = now;
      } else if (s.lastClears.length >= 6) {
        A.callout = 'Strike!';
        A.calloutAt = now;
      }
    }
    if (s.garbageSeq !== A.garbageSeq) {
      A.garbageSeq = s.garbageSeq;
      A.flashAt = now;
      A.shakeAt = now;
      play('hit');
    }
    if (s.cur) {
      const k = 1 - Math.exp(-dt / 55);
      A.visX += (s.cur.x - A.visX) * k;
      A.visY += (s.cur.y - A.visY) * k;
      if (Math.abs(A.visX - s.cur.x) < 0.02) A.visX = s.cur.x;
      if (A.visY > s.cur.y || Math.abs(A.visY - s.cur.y) < 0.02) A.visY = s.cur.y;
    }

    // background
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, width, height);

    // shake on garbage
    const shakeT = (now - A.shakeAt) / FLASH_MS;
    ctx.save();
    if (shakeT >= 0 && shakeT < 1) {
      const amp = (1 - shakeT) * 4;
      ctx.translate(Math.sin(now / 9) * amp, Math.cos(now / 11) * amp * 0.6);
    }

    // --- HUD
    const sc = def.score(s);
    drawPanel(ctx, 8, 6, width - 16, HUD_H - 10, 10);
    const hudY = 6 + (HUD_H - 10) / 2;
    outlinedText(ctx, `${sc.points} pts`, 20, hudY, '700 17px system-ui, sans-serif', PARCHMENT, 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, sc.label, width / 2, hudY, '700 17px system-ui, sans-serif', BRASS, 'rgba(0,0,0,0.6)', 'center');
    outlinedText(ctx, fmtTime(s.durationMs - s.elapsedMs), width - 20, hudY, '700 17px system-ui, sans-serif', PARCHMENT, 'rgba(0,0,0,0.6)', 'right');
    if (width >= 520) {
      outlinedText(ctx, `⚔ ${s.damageDealt} dealt`, width * 0.26, hudY, '600 13px system-ui, sans-serif', '#ffd27a', 'rgba(0,0,0,0.6)', 'center');
      outlinedText(ctx, `${s.damageTaken} taken`, width * 0.74, hudY, '600 13px system-ui, sans-serif', '#ff8a8e', 'rgba(0,0,0,0.6)', 'center');
    }

    // --- threat meter
    {
      const mx = L.mx;
      roundRect(ctx, mx, L.by, L.meterW, L.boardH, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,217,168,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      const n = Math.min(14, s.pendingGarbage);
      const icon = Math.min(L.meterW - 4, Math.floor(L.boardH / 15));
      for (let i = 0; i < n; i++) {
        const cy = L.by + L.boardH - 8 - i * icon - icon / 2;
        const danger = s.pendingGarbage >= 6 ? RED : '#ff8a8e';
        const wob = Math.sin(now / 200 + i) * 1.5;
        drawSword(ctx, mx + L.meterW / 2 + wob, cy, icon * 0.95, danger);
      }
      if (s.pendingGarbage > 0) {
        outlinedText(ctx, `${s.pendingGarbage}`, mx + L.meterW / 2, L.by + 12, '800 13px system-ui, sans-serif', RED);
      }
    }

    // --- main board
    drawPanel(ctx, L.bx - 6, L.by - 6, L.boardW + 12, L.boardH + 12, 10);
    ctx.fillStyle = WELL;
    ctx.fillRect(L.bx, L.by, L.boardW, L.boardH);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(L.bx + x * L.cell + 0.5, L.by);
      ctx.lineTo(L.bx + x * L.cell + 0.5, L.by + L.boardH);
    }
    for (let y = 1; y < VIS_ROWS; y++) {
      ctx.moveTo(L.bx, L.by + y * L.cell + 0.5);
      ctx.lineTo(L.bx + L.boardW, L.by + y * L.cell + 0.5);
    }
    ctx.stroke();
    // danger line under the hidden spawn row
    ctx.strokeStyle = 'rgba(229,72,77,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(L.bx, L.by + L.cell + 0.5);
    ctx.lineTo(L.bx + L.boardW, L.by + L.cell + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.bx, L.by, L.boardW, L.boardH);
    ctx.clip();
    drawGrid(ctx, s.grid, L.bx, L.by, L.cell, now, true);

    if (s.cur && !s.over) {
      // ghost
      const land = landingCells(s.grid, s.cur);
      for (const c of land) {
        if (c.y < 0) continue;
        drawBlock(ctx, L.bx + c.x * L.cell, L.by + (c.y - HIDDEN_ROWS) * L.cell, L.cell, c.block, now, 0.22, false);
      }
      // falling pair (interpolated)
      const vis: Pair = { ...s.cur, x: A.visX, y: A.visY };
      for (const c of pairCells(vis)) {
        drawBlock(ctx, L.bx + c.x * L.cell, L.by + (c.y - HIDDEN_ROWS) * L.cell, L.cell, c.block, now, 1, true);
      }
    }

    // pop animations
    if (A.pops.length) {
      for (const p of A.pops) {
        const t = (now - A.popAt - (p.pass - 1) * PASS_STAGGER_MS) / POP_MS;
        if (t < 0 || t >= 1) continue;
        const e = easeOut(t);
        const size = L.cell * (1 + e * 0.6);
        const cx = L.bx + p.x * L.cell + L.cell / 2;
        const cy = L.by + (p.y - HIDDEN_ROWS) * L.cell + L.cell / 2;
        const b: Block = { color: p.color, breaker: false };
        drawBlock(ctx, cx - size / 2, cy - size / 2, size, b, now, 1 - e, false);
        drawBurst(ctx, cx, cy, L.cell * (0.3 + e * 0.9), (1 - e) * 0.9);
      }
      if (now - A.popAt > POP_MS + PASS_STAGGER_MS * 12) A.pops = [];
    }

    // garbage flash
    const flashT = (now - A.flashAt) / FLASH_MS;
    if (flashT >= 0 && flashT < 1) {
      ctx.fillStyle = `rgba(229,72,77,${(1 - flashT) * 0.45})`;
      ctx.fillRect(L.bx, L.by, L.boardW, L.boardH);
    }
    ctx.restore();

    // chain callout
    const calloutT = (now - A.calloutAt) / CALLOUT_MS;
    if (A.callout && calloutT >= 0 && calloutT < 1) {
      const e = easeOut(calloutT);
      ctx.save();
      ctx.globalAlpha = 1 - calloutT * calloutT;
      const size = Math.max(18, L.cell * 0.9);
      outlinedText(ctx, A.callout, L.bx + L.boardW / 2, L.by + L.boardH * 0.42 - e * L.cell * 1.5, `900 ${size}px system-ui, sans-serif`, '#ffd27a', 'rgba(60,20,0,0.85)');
      ctx.restore();
    }

    if (s.over) {
      const cx = L.bx + L.boardW / 2;
      const cy = L.by + L.boardH / 2;
      if (s.ko) drawStamp(ctx, 'KO', cx, cy, Math.max(28, L.cell * 1.6), RED);
      else drawStamp(ctx, 'TIME', cx, cy, Math.max(22, L.cell * 1.1), BRASS);
    }

    // --- side panel: next pair, stats
    {
      const sx = L.sx;
      const sw = L.sideW;
      const pc = Math.min(L.cell, Math.floor((sw - 16) / 2));
      const nh = pc * 2 + 36;
      drawPanel(ctx, sx, L.by, sw, nh, 8);
      outlinedText(ctx, 'NEXT', sx + sw / 2, L.by + 14, '800 12px system-ui, sans-serif', BRASS);
      const nx = sx + (sw - pc) / 2;
      const ny = L.by + 26;
      drawBlock(ctx, nx, ny, pc, s.next.b, now, 1, true);
      drawBlock(ctx, nx, ny + pc, pc, s.next.a, now, 1, true);

      const iy = L.by + nh + 10;
      const ih = Math.min(L.boardH - nh - 10, 120);
      if (ih > 50) {
        drawPanel(ctx, sx, iy, sw, ih, 8);
        const f = `700 ${sw >= 100 ? 13 : 11}px system-ui, sans-serif`;
        outlinedText(ctx, 'DEALT', sx + sw / 2, iy + 14, '800 11px system-ui, sans-serif', BRASS);
        outlinedText(ctx, `${s.damageDealt}`, sx + sw / 2, iy + 32, f, '#ffd27a');
        outlinedText(ctx, 'CHAIN', sx + sw / 2, iy + 54, '800 11px system-ui, sans-serif', BRASS);
        outlinedText(ctx, s.chain >= 2 ? `×${s.chain}` : '—', sx + sw / 2, iy + 72, f, PARCHMENT);
        if (ih >= 110) {
          outlinedText(ctx, 'PIECES', sx + sw / 2, iy + 92, '800 11px system-ui, sans-serif', BRASS);
          outlinedText(ctx, `${s.pieces}`, sx + sw / 2, iy + 108, f, PARCHMENT);
        }
      }
    }

    // --- opponents / allies
    if (visible.length > 0 && L.ow > 40) {
      const n = visible.length;
      const gap = 8;
      const labelH = 18;
      let bestCols = 1;
      let bestCell = 0;
      for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c);
        const cw = (L.ow - gap * (c - 1)) / c;
        const chh = (L.oh - gap * (r - 1)) / r - labelH - 8;
        const cellSize = Math.floor(Math.min((cw - 8) / COLS, chh / VIS_ROWS));
        if (cellSize > bestCell) {
          bestCell = cellSize;
          bestCols = c;
        }
      }
      const mc = clamp(bestCell, 3, L.cell);
      const rows = Math.ceil(n / bestCols);
      const tileW = mc * COLS + 8;
      const tileH = mc * VIS_ROWS + labelH + 8;
      const totalW = tileW * bestCols + gap * (bestCols - 1);
      const totalH = tileH * rows + gap * (rows - 1);
      const startX = L.ox + Math.max(0, Math.floor((L.ow - totalW) / 2));
      const startY = L.oy + Math.max(0, Math.floor((L.oh - totalH) / 2));
      visible.forEach((o: Other, i) => {
        const col = i % bestCols;
        const row = Math.floor(i / bestCols);
        const tx = startX + col * (tileW + gap);
        const ty = startY + row * (tileH + gap);
        const sideColor = SIDE_COLORS[o.side % 2] ?? PARCHMENT;
        drawPanel(ctx, tx, ty, tileW, tileH, 8);
        ctx.fillStyle = sideColor;
        roundRect(ctx, tx + 2, ty + 2, tileW - 4, labelH, 6);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(tx + 2, ty + 2, tileW - 4, labelH);
        ctx.clip();
        outlinedText(ctx, o.name, tx + tileW / 2, ty + 2 + labelH / 2, `800 ${Math.max(9, Math.min(12, mc * 0.9))}px system-ui, sans-serif`, '#fff', 'rgba(0,0,0,0.5)');
        ctx.restore();
        const gx = tx + 4;
        const gy = ty + labelH + 4;
        ctx.fillStyle = WELL;
        ctx.fillRect(gx, gy, mc * COLS, mc * VIS_ROWS);
        const os = o.state as State | undefined;
        if (os && Array.isArray(os.grid)) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(gx, gy, mc * COLS, mc * VIS_ROWS);
          ctx.clip();
          drawGrid(ctx, os.grid, gx, gy, mc, now, mc >= 12);
          if (os.cur && !os.over) {
            for (const c of pairCells(os.cur)) {
              drawBlock(ctx, gx + c.x * mc, gy + (c.y - HIDDEN_ROWS) * mc, mc, c.block, now, 1, mc >= 12);
            }
          }
          ctx.restore();
          if (os.pendingGarbage > 0) {
            outlinedText(ctx, `⚔${os.pendingGarbage}`, gx + mc * COLS - 4, gy + 8, '800 10px system-ui, sans-serif', RED, 'rgba(0,0,0,0.6)', 'right');
          }
        }
        if (o.ko || os?.ko) drawStamp(ctx, 'KO', gx + (mc * COLS) / 2, gy + (mc * VIS_ROWS) / 2, Math.max(14, mc * 1.6), RED);
      });
    }

    // --- bottom bar: touch buttons + controls hint
    {
      const defs: { id: string; label: string; action: Action }[] = [
        { id: 'left', label: '◀', action: { type: 'left' } },
        { id: 'ccw', label: '↺', action: { type: 'rotateCCW' } },
        { id: 'cw', label: '↻', action: { type: 'rotateCW' } },
        { id: 'right', label: '▶', action: { type: 'right' } },
        { id: 'soft', label: '▼', action: { type: 'softDrop' } },
        { id: 'hard', label: '⤓', action: { type: 'hardDrop' } },
      ];
      const bw = Math.min(56, Math.floor((width - 24) / defs.length) - 6);
      const bh = BAR_H - 14;
      const totalW = defs.length * (bw + 6) - 6;
      const hintFits = width - totalW >= 360;
      const startX = hintFits ? 12 : Math.floor((width - totalW) / 2);
      const y = L.barY + 7;
      const buttons: Button[] = defs.map((d, i) => ({ ...d, x: startX + i * (bw + 6), y, w: bw, h: bh }));
      buttonsRef.current = buttons;
      for (const b of buttons) {
        ctx.fillStyle = 'rgba(27,42,59,0.95)';
        roundRect(ctx, b.x, b.y, b.w, b.h, 8);
        ctx.fill();
        ctx.strokeStyle = BRASS;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        outlinedText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, `700 ${Math.floor(bh * 0.55)}px system-ui, sans-serif`, PARCHMENT, 'rgba(0,0,0,0.5)');
      }
      if (hintFits) {
        outlinedText(ctx, '←→ move · ↑/X rotate · Z rotate back · ↓ soft · space drop', width - 12, y + bh / 2, '600 12px system-ui, sans-serif', 'rgba(240,217,168,0.85)', 'rgba(0,0,0,0.6)', 'right');
      }
    }

    if (!focused && !s.over) {
      ctx.fillStyle = 'rgba(13,27,42,0.45)';
      ctx.fillRect(L.bx, L.by, L.boardW, L.boardH);
      outlinedText(ctx, 'Click to take up your blade', L.bx + L.boardW / 2, L.by + L.boardH / 2, `700 ${Math.max(12, Math.min(18, L.cell * 0.55))}px system-ui, sans-serif`, PARCHMENT);
    }
    ctx.restore();
  }, [state, width, height, now, focused, others]);

  return <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none', background: NAVY }} />;
}
