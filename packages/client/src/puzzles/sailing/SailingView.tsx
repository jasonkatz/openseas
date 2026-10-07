import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ratingLabel } from '@tidebound/shared';
import {
  COLS,
  EMPTY,
  GUST,
  LOCK_MS,
  ROWS,
  canOccupy,
  landingRow,
  type Action,
  type ClearLine,
  type State,
} from '../../../../shared/src/puzzles/sailing/engine';
import { PIECE_COLORS, clamp, drawGem, drawPanel, easeOut, fitCanvas, lerp, outlinedText, roundRect } from '../../lib/canvas';
import { play } from '../../lib/audio';
import type { PuzzleViewProps } from '../registry';

const NAVY = '#0d1b2a';
const PARCHMENT = '#f0d9a8';
const BRASS = '#c89b3c';
const WOOD = '#6b4423';
const WOOD_LIGHT = '#8d5d33';
const WOOD_DARK = '#3f2714';
const ROPE = '#d9b77c';

const MOVE_TWEEN_MS = 70;
const FLASH_MS = 420;
const FLASH_STEP_MS = 140;
const CHAIN_MS = 1000;
const BTN_FLASH_MS = 120;

interface Layout {
  cell: number;
  wellX: number;
  wellY: number;
  wellW: number;
  wellH: number;
  frame: number;
  sideX: number;
  sideY: number;
  sideW: number;
  sideH: number;
  hudY: number;
  buttons: { id: Action['type']; x: number; y: number; w: number; h: number; glyph: string }[];
  hintY: number;
}

interface Flash {
  cells: number[];
  color: number;
  gust: boolean;
  t0: number;
}

interface Fx {
  lockSeq: number;
  clearSeq: number;
  colFrom: number;
  colTo: number;
  colT0: number;
  flashes: Flash[];
  chainAt: number;
  chainN: number;
  pressed: { id: string; t0: number } | null;
  overAt: number;
}

function computeLayout(width: number, height: number): Layout {
  const m = 12;
  const hudH = 44;
  const btnH = clamp(Math.round(height * 0.085), 40, 56);
  const hintH = 20;
  const gap = 12;
  const sideW = clamp(Math.round(width * 0.26), 112, 180);
  const availW = width - 2 * m - sideW - gap;
  const availH = height - hudH - btnH - hintH - 2 * m - 8;
  const cell = Math.max(14, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  const wellW = cell * COLS;
  const wellH = cell * ROWS;
  const frame = Math.max(8, Math.round(cell * 0.36));
  const groupW = wellW + gap + sideW;
  const wellX = Math.round((width - groupW) / 2);
  const wellY = hudH + m + Math.round((availH - wellH) / 2);
  const sideX = wellX + wellW + gap;
  const sideH = wellH;
  const btnY = wellY + wellH + frame + 10;
  const btnW = Math.min(72, Math.floor((wellW + sideW + gap - 3 * 8) / 4));
  const btnTotal = btnW * 4 + 8 * 3;
  const btnX0 = Math.round((width - btnTotal) / 2);
  const ids: { id: Action['type']; glyph: string }[] = [
    { id: 'left', glyph: '◀' },
    { id: 'cycle', glyph: '⟳' },
    { id: 'right', glyph: '▶' },
    { id: 'hardDrop', glyph: '⬇' },
  ];
  const buttons = ids.map((b, i) => ({ ...b, x: btnX0 + i * (btnW + 8), y: btnY, w: btnW, h: btnH }));
  return {
    cell,
    wellX,
    wellY,
    wellW,
    wellH,
    frame,
    sideX,
    sideY: wellY,
    sideW,
    sideH,
    hudY: 22,
    buttons,
    hintY: btnY + btnH + 12,
  };
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

function perfColor(p: number): string {
  if (p >= 0.85) return '#8ff0a0';
  if (p >= 0.5) return '#ffd27a';
  if (p >= 0.3) return PARCHMENT;
  return '#ff8a8e';
}

function drawSail(ctx: CanvasRenderingContext2D, width: number, height: number, perf: number, now: number): void {
  // A big lateen-ish sail behind the board; its belly swells with performance and breathes with time.
  const mastX = width * 0.22;
  const top = height * 0.06;
  const bottom = height * 0.94;
  const breathe = 1 + 0.12 * Math.sin(now / 850) + 0.05 * Math.sin(now / 310);
  const belly = (0.18 + 0.62 * perf) * width * 0.55 * breathe;
  ctx.save();
  ctx.globalAlpha = 0.075 + perf * 0.06;
  ctx.fillStyle = PARCHMENT;
  ctx.beginPath();
  ctx.moveTo(mastX, top);
  ctx.quadraticCurveTo(mastX + belly * 1.2, (top + bottom) * 0.45, mastX + belly * 0.55, bottom);
  ctx.lineTo(mastX, bottom * 0.9);
  ctx.closePath();
  ctx.fill();
  // seams
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = PARCHMENT;
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const y = lerp(top, bottom * 0.9, t);
    ctx.beginPath();
    ctx.moveTo(mastX, y);
    ctx.quadraticCurveTo(mastX + belly * 0.9 * (1 - t * 0.3), y + 10, mastX + belly * (1 - t) * 0.9 + belly * t * 0.5, y + 24);
    ctx.stroke();
  }
  // mast
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = WOOD_LIGHT;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(mastX, top - 10);
  ctx.lineTo(mastX, height);
  ctx.stroke();
  ctx.restore();
}

function drawRope(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, lw: number): void {
  ctx.save();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = lw + 2;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.strokeStyle = ROPE;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.setLineDash([lw * 0.9, lw * 0.9]);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#f3d98a');
  g.addColorStop(0.6, BRASS);
  g.addColorStop(1, '#6e4f14');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawGust(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, now: number, alpha = 1): void {
  drawGem(ctx, x, y, size, GUST, { glow: size * 0.35, alpha });
  ctx.save();
  ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(now / 160));
  ctx.strokeStyle = '#4fa3e3';
  ctx.lineWidth = Math.max(1.5, size * 0.07);
  ctx.lineCap = 'round';
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.26;
  ctx.beginPath();
  ctx.arc(cx - r * 0.2, cy, r, Math.PI * 1.1, Math.PI * 2.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.1, cy + r * 0.35, r * 0.55, Math.PI * 1.2, Math.PI * 2.6);
  ctx.stroke();
  ctx.restore();
}

function drawBlock(ctx: CanvasRenderingContext2D, color: number, x: number, y: number, size: number, now: number, opts: { alpha?: number; glow?: number } = {}): void {
  if (color === GUST) drawGust(ctx, x, y, size, now, opts.alpha ?? 1);
  else drawGem(ctx, x, y, size, color, opts);
}

function drawWoodButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glyph: string, pressed: number): void {
  ctx.save();
  const lift = pressed > 0 ? 0 : 2;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, pressed > 0 ? WOOD : WOOD_LIGHT);
  g.addColorStop(1, WOOD_DARK);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = lift + 2;
  ctx.fillStyle = g;
  roundRect(ctx, x, y + (2 - lift), w, h, 10);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = pressed > 0 ? '#f3d98a' : BRASS;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 1, y + 1 + (2 - lift), w - 2, h - 2, 9);
  ctx.stroke();
  outlinedText(ctx, glyph, x + w / 2, y + h / 2 + (2 - lift), `${Math.round(h * 0.5)}px system-ui, sans-serif`, PARCHMENT);
  ctx.restore();
}

export default function SailingView({ state, dispatch, width, height, now, focused }: PuzzleViewProps<State, Action>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout>(computeLayout(width, height));
  const stateRef = useRef(state);
  stateRef.current = state;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const nowRef = useRef(now);
  nowRef.current = now;
  const fx = useRef<Fx>({
    lockSeq: state.lockSeq,
    clearSeq: state.clearSeq,
    colFrom: state.piece?.col ?? 0,
    colTo: state.piece?.col ?? 0,
    colT0: -1e9,
    flashes: [],
    chainAt: -1e9,
    chainN: 0,
    pressed: null,
    overAt: -1,
  });
  const pointer = useRef<{ id: number; x: number; y: number; t: number; consumed: boolean } | null>(null);

  const act = useCallback(
    (a: Action) => {
      if (!focusedRef.current || stateRef.current.over) return;
      if (a.type === 'softDrop' || a.type === 'hardDrop') play('drop');
      dispatch(a);
    },
    [dispatch],
  );

  // Keyboard
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let a: Action | null = null;
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
        case 'w':
        case 'W':
        case 'x':
        case 'X':
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          a = { type: 'cycle' };
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          a = { type: 'softDrop' };
          break;
        case ' ':
        case 'Spacebar':
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          a = { type: 'hardDrop' };
          break;
        default:
          return;
      }
      e.preventDefault();
      fx.current.pressed = { id: a.type, t0: nowRef.current };
      act(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, act]);

  // Pointer / touch
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!focusedRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const L = layoutRef.current;
      for (const b of L.buttons) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          fx.current.pressed = { id: b.id, t0: nowRef.current };
          act({ type: b.id });
          pointer.current = { id: e.pointerId, x, y, t: nowRef.current, consumed: true };
          return;
        }
      }
      pointer.current = { id: e.pointerId, x, y, t: nowRef.current, consumed: false };
    },
    [act],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const p = pointer.current;
      pointer.current = null;
      if (!p || p.id !== e.pointerId || p.consumed || !focusedRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - p.x;
      const dy = y - p.y;
      const L = layoutRef.current;
      const s = stateRef.current;
      const swipe = Math.max(24, L.cell * 0.8);
      if (dy > swipe && Math.abs(dy) > Math.abs(dx) * 1.2) {
        act({ type: 'hardDrop' });
        return;
      }
      if (dy < -swipe && Math.abs(dy) > Math.abs(dx) * 1.2) {
        act({ type: 'cycle' });
        return;
      }
      if (Math.abs(dx) > swipe) {
        const steps = clamp(Math.round(Math.abs(dx) / L.cell), 1, COLS - 1);
        const a: Action = dx < 0 ? { type: 'left' } : { type: 'right' };
        for (let i = 0; i < steps; i++) act(a);
        return;
      }
      // Tap
      if (!s.piece) return;
      const inWell = x >= L.wellX && x <= L.wellX + L.wellW && y >= L.wellY && y <= L.wellY + L.wellH;
      const tapCol = Math.floor((x - L.wellX) / L.cell);
      if (inWell && tapCol === s.piece.col) {
        act({ type: 'cycle' });
      } else if (inWell) {
        act({ type: tapCol < s.piece.col ? 'left' : 'right' });
      } else if (y < L.wellY + L.wellH && y > L.wellY - L.frame) {
        act({ type: x < L.wellX + L.wellW / 2 ? 'left' : 'right' });
      }
    },
    [act],
  );

  const onPointerCancel = useCallback(() => {
    pointer.current = null;
  }, []);

  // Draw
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const L = computeLayout(width, height);
    layoutRef.current = L;
    const F = fx.current;
    const { cell } = L;

    // --- detect engine events -> animation + sound ---
    if (state.lockSeq !== F.lockSeq) {
      F.lockSeq = state.lockSeq;
      play('lock');
      F.colFrom = F.colTo = state.piece?.col ?? F.colTo;
      F.colT0 = -1e9;
    }
    if (state.clearSeq !== F.clearSeq) {
      F.clearSeq = state.clearSeq;
      for (const c of state.lastClears as ClearLine[]) {
        F.flashes.push({ cells: c.cells, color: c.color, gust: c.gust, t0: now + c.step * FLASH_STEP_MS });
      }
      play('match');
      if (state.chain >= 2) {
        play('combo', state.chain);
        F.chainAt = now;
        F.chainN = state.chain;
      }
    }
    if (state.piece && state.piece.col !== F.colTo) {
      const t = clamp((now - F.colT0) / MOVE_TWEEN_MS, 0, 1);
      F.colFrom = lerp(F.colFrom, F.colTo, easeOut(t));
      F.colTo = state.piece.col;
      F.colT0 = now;
    }
    if (state.over && F.overAt < 0) F.overAt = now;
    if (F.flashes.length > 0) F.flashes = F.flashes.filter((f) => now - f.t0 < FLASH_MS);

    // --- background ---
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#102338');
    bg.addColorStop(1, NAVY);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    drawSail(ctx, width, height, state.performance, now);

    // --- well frame (wood + rope + rivets) ---
    const fx0 = L.wellX - L.frame;
    const fy0 = L.wellY - L.frame;
    const fw = L.wellW + L.frame * 2;
    const fh = L.wellH + L.frame * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    const wg = ctx.createLinearGradient(fx0, fy0, fx0 + fw, fy0 + fh);
    wg.addColorStop(0, WOOD_LIGHT);
    wg.addColorStop(0.5, WOOD);
    wg.addColorStop(1, WOOD_DARK);
    ctx.fillStyle = wg;
    roundRect(ctx, fx0, fy0, fw, fh, L.frame * 0.9);
    ctx.fill();
    ctx.restore();
    // wood grain
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const yy = fy0 + ((i + 0.5) / 7) * fh;
      ctx.beginPath();
      ctx.moveTo(fx0 + 4, yy);
      ctx.bezierCurveTo(fx0 + fw * 0.3, yy - 4, fx0 + fw * 0.7, yy + 4, fx0 + fw - 4, yy);
      ctx.stroke();
    }
    ctx.restore();
    drawRope(ctx, fx0 + L.frame * 0.45, fy0 + L.frame * 0.45, fw - L.frame * 0.9, fh - L.frame * 0.9, L.frame * 0.6, Math.max(3, L.frame * 0.22));
    const rr = Math.max(3, L.frame * 0.28);
    drawRivet(ctx, fx0 + L.frame * 0.5, fy0 + L.frame * 0.5, rr);
    drawRivet(ctx, fx0 + fw - L.frame * 0.5, fy0 + L.frame * 0.5, rr);
    drawRivet(ctx, fx0 + L.frame * 0.5, fy0 + fh - L.frame * 0.5, rr);
    drawRivet(ctx, fx0 + fw - L.frame * 0.5, fy0 + fh - L.frame * 0.5, rr);

    // --- well interior ---
    ctx.save();
    ctx.fillStyle = '#081220';
    ctx.fillRect(L.wellX, L.wellY, L.wellW, L.wellH);
    ctx.strokeStyle = 'rgba(240,217,168,0.07)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(L.wellX + c * cell + 0.5, L.wellY);
      ctx.lineTo(L.wellX + c * cell + 0.5, L.wellY + L.wellH);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(L.wellX, L.wellY + r * cell + 0.5);
      ctx.lineTo(L.wellX + L.wellW, L.wellY + r * cell + 0.5);
      ctx.stroke();
    }
    // spawn row tint
    ctx.fillStyle = 'rgba(229,72,77,0.08)';
    ctx.fillRect(L.wellX, L.wellY, L.wellW, cell);
    ctx.beginPath();
    ctx.rect(L.wellX, L.wellY, L.wellW, L.wellH);
    ctx.clip();

    // settled blocks
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = state.grid[r * COLS + c];
        if (v === undefined || v === EMPTY) continue;
        drawBlock(ctx, v, L.wellX + c * cell, L.wellY + r * cell, cell, now);
      }
    }

    // ghost + falling piece
    const piece = state.piece;
    if (piece && !state.over) {
      const land = landingRow(state.grid, piece);
      const t = clamp((now - F.colT0) / MOVE_TWEEN_MS, 0, 1);
      const dispCol = lerp(F.colFrom, F.colTo, easeOut(t));
      const px = L.wellX + dispCol * cell;
      if (land !== piece.row) {
        for (let k = 0; k < 3; k++) {
          const r = land + k;
          if (r < 0) continue;
          drawBlock(ctx, piece.colors[k] as number, px, L.wellY + r * cell, cell, now, { alpha: 0.2 });
        }
      }
      const canFall = canOccupy(state.grid, piece.col, piece.row + 1);
      const frac = canFall && state.fallMs > 0 ? clamp(state.fallAcc / state.fallMs, 0, 1) : 0;
      const visRow = piece.row + frac;
      const resting = !canFall;
      const lockT = resting ? clamp(state.lockAcc / LOCK_MS, 0, 1) : 0;
      for (let k = 0; k < 3; k++) {
        const y = L.wellY + (visRow + k) * cell;
        if (y + cell < L.wellY) continue;
        drawBlock(ctx, piece.colors[k] as number, px, y, cell, now, { glow: resting ? cell * 0.25 * lockT : 0 });
      }
    }

    // clear flashes
    for (const f of F.flashes) {
      const age = now - f.t0;
      if (age < 0) continue;
      const t = age / FLASH_MS;
      const col = f.gust ? '#ffffff' : (PIECE_COLORS[f.color % PIECE_COLORS.length]?.light ?? '#ffffff');
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = col;
      const grow = 1 + easeOut(t) * 0.35;
      for (const idx of f.cells) {
        const r = Math.floor(idx / COLS);
        const c = idx % COLS;
        const s = cell * grow;
        const x = L.wellX + c * cell + (cell - s) / 2;
        const y = L.wellY + r * cell + (cell - s) / 2;
        roundRect(ctx, x, y, s, s, s * 0.3);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore(); // end clip

    // chain text
    if (now - F.chainAt < CHAIN_MS) {
      const t = (now - F.chainAt) / CHAIN_MS;
      const scale = 1 + (1 - easeOut(Math.min(1, t * 4))) * 0.8;
      ctx.save();
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.translate(L.wellX + L.wellW / 2, L.wellY + L.wellH * 0.42 - t * 30);
      ctx.scale(scale, scale);
      outlinedText(ctx, `Chain ×${F.chainN}`, 0, 0, `bold ${Math.round(cell * 0.75)}px system-ui, sans-serif`, '#ffd27a', 'rgba(60,20,0,0.85)');
      ctx.restore();
    }

    // --- side panel: next trio, wind meter ---
    drawPanel(ctx, L.sideX, L.sideY, L.sideW, L.sideH, 12);
    const pad = 10;
    outlinedText(ctx, 'NEXT', L.sideX + L.sideW / 2, L.sideY + pad + 10, `bold ${Math.max(11, Math.round(cell * 0.4))}px system-ui, sans-serif`, PARCHMENT, 'rgba(0,0,0,0.6)');
    const nextSize = Math.min(cell * 0.9, (L.sideW - pad * 2) * 0.7);
    const nx = L.sideX + (L.sideW - nextSize) / 2;
    const ny0 = L.sideY + pad + 24;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, nx - 6, ny0 - 6, nextSize + 12, nextSize * 3 + 12, 8);
    ctx.fill();
    ctx.restore();
    for (let k = 0; k < 3; k++) drawBlock(ctx, state.next[k] as number, nx, ny0 + k * nextSize, nextSize, now);

    // wind meter
    const meterY = ny0 + nextSize * 3 + 26;
    const meterH = Math.max(80, L.sideY + L.sideH - meterY - pad - 44);
    const meterW = Math.max(12, Math.min(22, L.sideW * 0.18));
    const mx = L.sideX + L.sideW / 2 - meterW / 2;
    if (meterH > 40) {
      outlinedText(ctx, 'WIND', L.sideX + L.sideW / 2, meterY - 10, `bold ${Math.max(10, Math.round(cell * 0.33))}px system-ui, sans-serif`, PARCHMENT, 'rgba(0,0,0,0.6)');
      ctx.save();
      ctx.fillStyle = '#081220';
      roundRect(ctx, mx, meterY, meterW, meterH, meterW / 2);
      ctx.fill();
      const fillH = meterH * clamp(state.performance, 0, 1);
      const mg = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
      mg.addColorStop(0, '#2f81f7');
      mg.addColorStop(0.6, '#29c6d6');
      mg.addColorStop(1, '#8ff0a0');
      ctx.fillStyle = mg;
      if (fillH > 2) {
        roundRect(ctx, mx + 2, meterY + meterH - fillH + 2, meterW - 4, fillH - 4 + 2, (meterW - 4) / 2);
        ctx.fill();
      }
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = 2;
      roundRect(ctx, mx, meterY, meterW, meterH, meterW / 2);
      ctx.stroke();
      ctx.restore();
      outlinedText(ctx, `${Math.round(state.performance * 100)}%`, L.sideX + L.sideW / 2, meterY + meterH + 14, `bold ${Math.max(10, Math.round(cell * 0.36))}px system-ui, sans-serif`, perfColor(state.performance), 'rgba(0,0,0,0.6)');
    }
    // chain badge at bottom of side panel
    if (state.chain >= 2) {
      outlinedText(ctx, `×${state.chain} chain`, L.sideX + L.sideW / 2, L.sideY + L.sideH - 16, `${Math.max(10, Math.round(cell * 0.33))}px system-ui, sans-serif`, '#ffd27a', 'rgba(0,0,0,0.6)');
    }

    // --- HUD ---
    const hudFont = `bold ${clamp(Math.round(width * 0.028), 14, 20)}px system-ui, sans-serif`;
    outlinedText(ctx, `${state.points} pts`, 16, L.hudY, hudFont, PARCHMENT, 'rgba(0,0,0,0.7)', 'left');
    outlinedText(ctx, ratingLabel(state.performance), width / 2, L.hudY, hudFont, perfColor(state.performance));
    const remain = state.durationMs - state.elapsedMs;
    outlinedText(ctx, fmtTime(remain), width - 16, L.hudY, hudFont, remain < 10000 ? '#ff8a8e' : PARCHMENT, 'rgba(0,0,0,0.7)', 'right');

    // --- buttons ---
    for (const b of L.buttons) {
      const pressed = F.pressed && F.pressed.id === b.id && now - F.pressed.t0 < BTN_FLASH_MS ? 1 : 0;
      drawWoodButton(ctx, b.x, b.y, b.w, b.h, b.glyph, pressed);
    }
    // hint
    const hint = width < 480 ? 'tap sides: move · tap trio: cycle · swipe down: drop' : '← → move · ↑ / X cycle · ↓ soft drop · space hard drop';
    outlinedText(ctx, hint, width / 2, L.hintY, `${clamp(Math.round(width * 0.02), 10, 13)}px system-ui, sans-serif`, 'rgba(240,217,168,0.75)', 'rgba(0,0,0,0.5)');

    // --- over / unfocused overlays ---
    if (state.over) {
      const t = clamp((now - F.overAt) / 500, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.6 * t;
      ctx.fillStyle = NAVY;
      ctx.fillRect(L.wellX, L.wellY, L.wellW, L.wellH);
      ctx.restore();
      if (t > 0.3) {
        const big = `bold ${Math.round(cell * 0.8)}px system-ui, sans-serif`;
        outlinedText(ctx, state.toppedOut ? 'Topped out!' : 'Watch over', L.wellX + L.wellW / 2, L.wellY + L.wellH * 0.42, big, PARCHMENT);
        outlinedText(ctx, `${state.points} pts · ${ratingLabel(state.performance)}`, L.wellX + L.wellW / 2, L.wellY + L.wellH * 0.42 + cell, `${Math.round(cell * 0.45)}px system-ui, sans-serif`, PARCHMENT);
      }
    } else if (!focused) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = NAVY;
      ctx.fillRect(L.wellX, L.wellY, L.wellW, L.wellH);
      ctx.restore();
      outlinedText(ctx, 'Click to take the helm', L.wellX + L.wellW / 2, L.wellY + L.wellH * 0.45, `bold ${Math.round(cell * 0.5)}px system-ui, sans-serif`, PARCHMENT);
    }
  }, [state, now, width, height, focused]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: 'block', touchAction: 'none', userSelect: 'none', cursor: 'pointer' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
