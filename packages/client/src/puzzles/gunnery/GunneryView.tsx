import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PuzzleViewProps } from '../registry';
import { fitCanvas, drawGem, PIECE_COLORS, roundRect, outlinedText, drawPanel, lerp, easeOut, clamp } from '../../lib/canvas';
import { play } from '../../lib/audio';
import {
  KIND_COLOR, SHAPE_CELLS, SHAPE_SIZE, MAX_CANNONS, GARBAGE_INTERVAL_MS, pieceCells, ghostY, score,
  type State, type Action, type Cell, type Kind, type PieceSpec, type Pt,
} from '../../../../shared/src/puzzles/gunnery/engine';

const NAVY = '#0d1b2a';
const PARCHMENT = '#f0d9a8';
const BRASS = '#c89b3c';
const WOOD = '#4a2e1a';
const WOOD_DARK = '#2e1a0e';
const WOOD_LIGHT = '#6b4426';
const UI_FONT = 'Nunito, system-ui, sans-serif';
const DISPLAY_FONT = '"Pirata One", "IM Fell English", serif';

const FALL_TWEEN_MS = 70;
const CLEAR_ANIM_MS = 420;
const PRIMED_FLASH_MS = 900;
const SHAKE_MS = 320;
const LOCK_FLASH_MS = 160;

interface Button { label: string; action: Action; x: number; y: number; w: number; h: number; hint: string }

interface Layout {
  cell: number;
  wellX: number; wellY: number; wellW: number; wellH: number; frame: number;
  holdX: number; holdY: number; holdW: number; holdH: number;
  nextX: number; nextY: number; nextW: number; nextH: number;
  mini: number;
  cannonY: number; cannonW: number; cannonX0: number;
  hudY: number;
  buttons: Button[];
  hintY: number;
}

function computeLayout(W: number, H: number, cols: number, rows: number): Layout {
  const pad = 10;
  const hudH = 40;
  const cannonH = 30;
  const btnH = 44;
  const hintH = 16;
  const bottomH = btnH + hintH + 6;
  const boardTop = pad + hudH + cannonH + 4;
  const boardBottom = H - bottomH - pad;
  const availH = Math.max(100, boardBottom - boardTop);
  const sideW = clamp(W * 0.18, 66, 120);
  const gap = 8;
  const availW = Math.max(100, W - 2 * pad - 2 * sideW - 2 * gap);
  const cell = Math.max(12, Math.floor(Math.min(availH / rows, availW / cols)));
  const wellW = cell * cols;
  const wellH = cell * rows;
  const frame = Math.max(6, Math.round(cell * 0.3));
  const wellX = Math.round((W - wellW) / 2);
  const wellY = Math.round(boardTop + (availH - wellH) / 2);
  const mini = Math.max(8, Math.min(Math.floor(cell * 0.62), Math.floor((sideW - 14) / 4)));
  const holdX = wellX - frame - gap - sideW;
  const holdW = sideW;
  const holdY = wellY;
  const holdH = mini * 4 + 30;
  const nextX = wellX + wellW + frame + gap;
  const nextW = sideW;
  const nextY = wellY;
  const nextH = 26 + 3 * (mini * 3 + 6) + 6;
  const cannonW = Math.min(26, Math.floor((W - 2 * pad) / MAX_CANNONS));
  const cannonX0 = Math.round((W - cannonW * MAX_CANNONS) / 2);
  const cannonY = pad + hudH + 2;
  // Buttons row.
  const labels: [string, Action, string][] = [
    ['◀', { type: 'left' }, 'left'],
    ['▶', { type: 'right' }, 'right'],
    ['⟲', { type: 'rotateCCW' }, 'rotate ccw'],
    ['⟳', { type: 'rotateCW' }, 'rotate cw'],
    ['⬇', { type: 'softDrop' }, 'soft drop'],
    ['⤓', { type: 'hardDrop' }, 'hard drop'],
    ['HOLD', { type: 'hold' }, 'hold'],
  ];
  const bgap = 6;
  const btnW = Math.min(64, Math.floor((W - 2 * pad - bgap * (labels.length - 1)) / labels.length));
  const totalW = btnW * labels.length + bgap * (labels.length - 1);
  const bx0 = Math.round((W - totalW) / 2);
  const by = H - pad - btnH;
  const buttons: Button[] = labels.map(([label, action, hint], i) => ({
    label, action, hint, x: bx0 + i * (btnW + bgap), y: by, w: btnW, h: btnH,
  }));
  return {
    cell, wellX, wellY, wellW, wellH, frame,
    holdX, holdY, holdW, holdH, nextX, nextY, nextW, nextH, mini,
    cannonY, cannonW, cannonX0, hudY: pad, buttons, hintY: by - hintH / 2 - 2,
  };
}

// ---------------------------------------------------------------------------
// Cell drawing

function drawKindIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, kind: Kind): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  if (kind === 'powder') {
    // small keg with cross-hatch
    const w = size * 0.34, h = size * 0.42;
    ctx.fillStyle = 'rgba(70,40,15,0.9)';
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, w * 0.3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,150,0.75)';
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - h * 0.25); ctx.lineTo(cx + w / 2, cy - h * 0.25);
    ctx.moveTo(cx - w / 2, cy + h * 0.25); ctx.lineTo(cx + w / 2, cy + h * 0.25);
    ctx.moveTo(cx - w * 0.35, cy - h * 0.15); ctx.lineTo(cx + w * 0.35, cy + h * 0.15);
    ctx.moveTo(cx + w * 0.35, cy - h * 0.15); ctx.lineTo(cx - w * 0.35, cy + h * 0.15);
    ctx.stroke();
  } else if (kind === 'wad') {
    // soft fuzzy circle
    const r = size * 0.2;
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.7, 'rgba(235,225,200,0.8)');
    g.addColorStop(1, 'rgba(200,185,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,100,70,0.5)';
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.setLineDash([size * 0.06, size * 0.05]);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2); ctx.stroke();
  } else {
    // dark sphere
    const r = size * 0.21;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#8a93a3');
    g.addColorStop(0.5, '#2b303a');
    g.addColorStop(1, '#090a0d');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.4, r * 0.22, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawDamp(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha = 1): void {
  const pad = size * 0.08;
  const s = size - pad * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, '#5a6b5e');
  g.addColorStop(1, '#263129');
  ctx.fillStyle = g;
  roundRect(ctx, x + pad, y + pad, s, s, s * 0.18);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,30,25,0.55)';
  ctx.beginPath(); ctx.arc(x + size * 0.35, y + size * 0.4, size * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + size * 0.65, y + size * 0.62, size * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(120,160,140,0.35)';
  roundRect(ctx, x + size * 0.55, y + size * 0.15, size * 0.12, size * 0.4, size * 0.06);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = Math.max(1, size * 0.04);
  roundRect(ctx, x + pad, y + pad, s, s, s * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, cell: Cell, alpha = 1, glow = 0): void {
  if (cell === null) return;
  if (cell === 'damp') { drawDamp(ctx, x, y, size, alpha); return; }
  drawGem(ctx, x, y, size, KIND_COLOR[cell], { alpha, glow });
  if (size >= 14) {
    ctx.save();
    ctx.globalAlpha = alpha;
    drawKindIcon(ctx, x, y, size, cell);
    ctx.restore();
  }
}

function drawGhostCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, kind: Kind): void {
  const c = PIECE_COLORS[KIND_COLOR[kind] % PIECE_COLORS.length]!;
  const pad = size * 0.12;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = c.light;
  ctx.lineWidth = Math.max(1.5, size * 0.07);
  ctx.setLineDash([size * 0.18, size * 0.12]);
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.22);
  ctx.stroke();
  ctx.restore();
}

function drawMiniPiece(ctx: CanvasRenderingContext2D, spec: PieceSpec, x: number, y: number, boxW: number, boxH: number, mini: number): void {
  const cells = SHAPE_CELLS[spec.shape][0]!;
  const n = SHAPE_SIZE[spec.shape];
  // bounding box of the actual cells
  let minX = n, maxX = 0, minY = n, maxY = 0;
  for (const c of cells) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); }
  const pw = (maxX - minX + 1) * mini;
  const ph = (maxY - minY + 1) * mini;
  const ox = x + (boxW - pw) / 2 - minX * mini;
  const oy = y + (boxH - ph) / 2 - minY * mini;
  for (const c of cells) drawCell(ctx, ox + c.x * mini, oy + c.y * mini, mini, spec.kind);
}

function drawCannon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, lit: boolean, now: number, i: number): void {
  const h = w * 0.95;
  const bx = x + w * 0.12, by = y + h * 0.3, bw = w * 0.76, bh = h * 0.28;
  ctx.save();
  // wheel
  ctx.fillStyle = lit ? WOOD_LIGHT : '#1f2c3a';
  ctx.beginPath(); ctx.arc(x + w * 0.45, y + h * 0.72, w * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = lit ? BRASS : '#2f4152';
  ctx.lineWidth = 1;
  ctx.stroke();
  // barrel, tapering to the right
  ctx.fillStyle = lit ? BRASS : '#22303f';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + bw, by + bh * 0.2);
  ctx.lineTo(bx + bw, by + bh * 0.8);
  ctx.lineTo(bx, by + bh);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = lit ? '#f0d9a8' : '#34475a';
  ctx.stroke();
  // breech knob
  ctx.fillStyle = lit ? '#e2b85b' : '#2a3a4b';
  ctx.beginPath(); ctx.arc(bx, by + bh / 2, bh * 0.4, 0, Math.PI * 2); ctx.fill();
  if (lit) {
    // fuse spark, flickering
    const f = 0.6 + 0.4 * Math.sin(now / 90 + i * 1.7);
    ctx.fillStyle = `rgba(255,${Math.round(150 + 80 * f)},40,${0.6 + 0.4 * f})`;
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 8 * f;
    ctx.beginPath(); ctx.arc(bx - bh * 0.1, by - bh * 0.25, Math.max(1.5, w * 0.09 * (0.8 + 0.4 * f)), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Animation bookkeeping (mutable ref, never allocated per frame except on events)

interface ClearAnim { rows: number[]; t0: number; primed: boolean }
interface Anim {
  pieceSeq: number;
  fromY: number;
  toY: number;
  tweenT0: number;
  clears: ClearAnim[];
  clearSeq: number;
  lockSeq: number;
  garbageSeq: number;
  primedT0: number;
  shakeT0: number;
  lockFlash: { cells: Pt[]; t0: number } | null;
  pressed: { idx: number; t0: number } | null;
  lastDropCells: Pt[] | null;
}

function makeAnim(s: State): Anim {
  return {
    pieceSeq: s.pieceSeq,
    fromY: s.active?.y ?? 0,
    toY: s.active?.y ?? 0,
    tweenT0: -1e9,
    clears: [],
    clearSeq: s.clearSeq,
    lockSeq: s.lockSeq,
    garbageSeq: s.garbageSeq,
    primedT0: -1e9,
    shakeT0: -1e9,
    lockFlash: null,
    pressed: null,
    lastDropCells: null,
  };
}

// ---------------------------------------------------------------------------

export default function GunneryView({ state, dispatch, width, height, now, focused }: PuzzleViewProps<State, Action>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<Anim | null>(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const stateRef = useRef(state);
  stateRef.current = state;
  const touchRef = useRef<{ x: number; y: number; id: number } | null>(null);

  const layout = useMemo(() => computeLayout(width, height, state.cols, state.rows), [width, height, state.cols, state.rows]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const send = useCallback((a: Action) => {
    const s = stateRef.current;
    if (s.over) return;
    if (a.type === 'hardDrop' && s.active) {
      // Remember where the piece will land so we can flash it.
      const y = ghostY(s);
      const cells = pieceCells({ ...s.active, y });
      const anim = animRef.current;
      if (anim) anim.lastDropCells = cells;
      play('drop');
    }
    dispatchRef.current(a);
  }, []);

  // Sounds driven by engine sequence counters.
  const prevSeq = useRef({ lock: state.lockSeq, clear: state.clearSeq, garbage: state.garbageSeq });
  useEffect(() => {
    const p = prevSeq.current;
    if (state.clearSeq !== p.clear) {
      play('clear');
      if (state.lastPrimed) play('cannon');
    } else if (state.lockSeq !== p.lock) {
      play('lock');
    }
    if (state.garbageSeq !== p.garbage) play('bad');
    prevSeq.current = { lock: state.lockSeq, clear: state.clearSeq, garbage: state.garbageSeq };
  }, [state.lockSeq, state.clearSeq, state.garbageSeq, state.lastPrimed]);

  // Keyboard.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let a: Action | null = null;
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': a = { type: 'left' }; break;
        case 'ArrowRight': case 'd': case 'D': a = { type: 'right' }; break;
        case 'ArrowUp': case 'x': case 'X': case 'w': case 'W': a = { type: 'rotateCW' }; break;
        case 'z': case 'Z': a = { type: 'rotateCCW' }; break;
        case 'ArrowDown': case 's': case 'S': a = { type: 'softDrop' }; break;
        case ' ': case 'Spacebar': a = { type: 'hardDrop' }; break;
        case 'c': case 'C': case 'Shift': a = { type: 'hold' }; break;
        default: return;
      }
      e.preventDefault();
      if (e.repeat && (a.type === 'hardDrop' || a.type === 'hold' || a.type === 'rotateCW' || a.type === 'rotateCCW')) return;
      send(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, send]);

  // Pointer / touch.
  const toLocal = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!focused) return;
    const { x, y } = toLocal(e);
    const L = layoutRef.current;
    for (let i = 0; i < L.buttons.length; i++) {
      const b = L.buttons[i]!;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        e.preventDefault();
        const anim = animRef.current;
        if (anim) anim.pressed = { idx: i, t0: now };
        send(b.action);
        touchRef.current = null;
        return;
      }
    }
    const inWell = x >= L.wellX - L.frame && x <= L.wellX + L.wellW + L.frame && y >= L.wellY - L.frame && y <= L.wellY + L.wellH + L.frame;
    if (inWell) {
      e.preventDefault();
      touchRef.current = { x, y, id: e.pointerId };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const t = touchRef.current;
    if (!t || t.id !== e.pointerId) return;
    touchRef.current = null;
    const { x, y } = toLocal(e);
    const dx = x - t.x, dy = y - t.y;
    const L = layoutRef.current;
    if (dy > 40 && Math.abs(dy) > Math.abs(dx)) send({ type: 'hardDrop' });
    else if (dy < -40 && Math.abs(dy) > Math.abs(dx)) send({ type: 'rotateCW' });
    else if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
      send(x < L.wellX + L.wellW / 2 ? { type: 'left' } : { type: 'right' });
    } else if (Math.abs(dx) >= 24) {
      send(dx < 0 ? { type: 'left' } : { type: 'right' });
    }
  };
  const onPointerCancel = () => { touchRef.current = null; };

  // Draw.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const L = layout;
    const s = state;
    const cell = L.cell;
    let anim = animRef.current;
    if (!anim) { anim = makeAnim(s); animRef.current = anim; }

    // --- event detection ---
    if (s.clearSeq !== anim.clearSeq) {
      anim.clears.push({ rows: s.lastClearRows.slice(), t0: now, primed: s.lastPrimed });
      if (s.lastPrimed) anim.primedT0 = now;
      anim.clearSeq = s.clearSeq;
    }
    if (s.lockSeq !== anim.lockSeq) {
      anim.lockSeq = s.lockSeq;
      if (anim.lastDropCells) {
        anim.lockFlash = { cells: anim.lastDropCells, t0: now };
        anim.lastDropCells = null;
      }
    }
    if (s.garbageSeq !== anim.garbageSeq) {
      anim.garbageSeq = s.garbageSeq;
      anim.shakeT0 = now;
    }
    // falling piece tween
    if (s.active) {
      if (s.pieceSeq !== anim.pieceSeq) {
        anim.pieceSeq = s.pieceSeq;
        anim.fromY = s.active.y;
        anim.toY = s.active.y;
        anim.tweenT0 = -1e9;
      } else if (s.active.y !== anim.toY) {
        const t = clamp((now - anim.tweenT0) / FALL_TWEEN_MS, 0, 1);
        anim.fromY = lerp(anim.fromY, anim.toY, easeOut(t));
        anim.toY = s.active.y;
        anim.tweenT0 = now;
      }
    }
    // prune finished clears
    while (anim.clears.length && now - anim.clears[0]!.t0 > CLEAR_ANIM_MS) anim.clears.shift();

    // --- background ---
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, width, height);
    // subtle plank stripes
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = PARCHMENT;
    for (let y = 0; y < height; y += 28) ctx.fillRect(0, y, width, 1);
    ctx.restore();

    // --- HUD top ---
    const sc = score(s);
    const hudMid = L.hudY + 18;
    outlinedText(ctx, `${sc.points} pts`, 14, hudMid, `800 20px ${UI_FONT}`, PARCHMENT, 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, sc.label, 14, hudMid + 18, `600 12px ${UI_FONT}`, BRASS, 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, 'Gunnery', width / 2, hudMid - 2, `26px ${DISPLAY_FONT}`, PARCHMENT, 'rgba(0,0,0,0.6)');
    outlinedText(ctx, `${s.cannonsLoaded}/${MAX_CANNONS} cannons loaded`, width / 2, hudMid + 18, `600 12px ${UI_FONT}`, BRASS, 'rgba(0,0,0,0.6)');
    const remain = s.durationMs - s.elapsedMs;
    outlinedText(ctx, fmtTime(remain), width - 14, hudMid, `800 20px ${UI_FONT}`, remain < 15000 ? '#ff8a8e' : PARCHMENT, 'rgba(0,0,0,0.6)', 'right');
    outlinedText(ctx, s.difficulty >= 0.3 ? `damp in ${fmtTime(GARBAGE_INTERVAL_MS - s.garbageTimerMs)}` : 'dry hold', width - 14, hudMid + 18, `600 12px ${UI_FONT}`, '#9ab0c4', 'rgba(0,0,0,0.6)', 'right');

    // --- cannon row ---
    for (let i = 0; i < MAX_CANNONS; i++) {
      drawCannon(ctx, L.cannonX0 + i * L.cannonW, L.cannonY, L.cannonW, i < s.cannonsLoaded, now, i);
    }

    // --- side panels ---
    drawPanel(ctx, L.holdX, L.holdY, L.holdW, L.holdH, 10);
    outlinedText(ctx, 'HOLD', L.holdX + L.holdW / 2, L.holdY + 13, `800 12px ${UI_FONT}`, s.holdUsed ? '#6d7f91' : PARCHMENT, 'rgba(0,0,0,0.5)');
    if (s.hold) {
      ctx.save();
      if (s.holdUsed) ctx.globalAlpha = 0.45;
      drawMiniPiece(ctx, s.hold, L.holdX + 4, L.holdY + 24, L.holdW - 8, L.holdH - 28, L.mini);
      ctx.restore();
    }
    // stats under hold
    const statY = L.holdY + L.holdH + 10;
    const statH = 70;
    if (statY + statH < L.wellY + L.wellH) {
      drawPanel(ctx, L.holdX, statY, L.holdW, statH, 10);
      outlinedText(ctx, 'rows', L.holdX + L.holdW / 2, statY + 14, `600 11px ${UI_FONT}`, '#9ab0c4', 'rgba(0,0,0,0.5)');
      outlinedText(ctx, `${s.totalRows}`, L.holdX + L.holdW / 2, statY + 30, `800 16px ${UI_FONT}`, PARCHMENT, 'rgba(0,0,0,0.5)');
      outlinedText(ctx, 'primed', L.holdX + L.holdW / 2, statY + 46, `600 11px ${UI_FONT}`, '#9ab0c4', 'rgba(0,0,0,0.5)');
      outlinedText(ctx, `${s.primedRows}`, L.holdX + L.holdW / 2, statY + 61, `800 16px ${UI_FONT}`, BRASS, 'rgba(0,0,0,0.5)');
    }
    // legend under stats
    const legY = statY + statH + 10;
    const legH = 3 * (L.mini + 4) + 10;
    if (legY + legH < L.wellY + L.wellH && L.holdW >= 70) {
      drawPanel(ctx, L.holdX, legY, L.holdW, legH, 10);
      const kinds: Kind[] = ['powder', 'wad', 'shot'];
      for (let i = 0; i < kinds.length; i++) {
        const k = kinds[i]!;
        const yy = legY + 6 + i * (L.mini + 4);
        drawCell(ctx, L.holdX + 6, yy, L.mini, k);
        outlinedText(ctx, k, L.holdX + 10 + L.mini, yy + L.mini / 2, `600 11px ${UI_FONT}`, PARCHMENT, 'rgba(0,0,0,0.5)', 'left');
      }
    }

    drawPanel(ctx, L.nextX, L.nextY, L.nextW, L.nextH, 10);
    outlinedText(ctx, 'NEXT', L.nextX + L.nextW / 2, L.nextY + 13, `800 12px ${UI_FONT}`, PARCHMENT, 'rgba(0,0,0,0.5)');
    for (let i = 0; i < s.next.length; i++) {
      const slotH = L.mini * 3 + 6;
      drawMiniPiece(ctx, s.next[i]!, L.nextX + 4, L.nextY + 24 + i * slotH, L.nextW - 8, slotH, L.mini);
    }
    // recipe hint under next
    const recY = L.nextY + L.nextH + 10;
    if (recY + 58 < L.wellY + L.wellH) {
      drawPanel(ctx, L.nextX, recY, L.nextW, 58, 10);
      outlinedText(ctx, 'primed row', L.nextX + L.nextW / 2, recY + 14, `600 11px ${UI_FONT}`, BRASS, 'rgba(0,0,0,0.5)');
      outlinedText(ctx, '2 powder', L.nextX + L.nextW / 2, recY + 29, `600 11px ${UI_FONT}`, PARCHMENT, 'rgba(0,0,0,0.5)');
      outlinedText(ctx, '1 wad, 1 shot', L.nextX + L.nextW / 2, recY + 43, `600 11px ${UI_FONT}`, PARCHMENT, 'rgba(0,0,0,0.5)');
    }

    // --- well (gun deck) ---
    ctx.save();
    const shakeT = (now - anim.shakeT0) / SHAKE_MS;
    if (shakeT >= 0 && shakeT < 1) {
      ctx.translate(Math.sin(now / 14) * 4 * (1 - shakeT), Math.cos(now / 11) * 2 * (1 - shakeT));
    }
    const fx = L.wellX - L.frame, fy = L.wellY - L.frame, fw = L.wellW + L.frame * 2, fh = L.wellH + L.frame * 2;
    // wood frame
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    const wg = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    wg.addColorStop(0, WOOD_LIGHT);
    wg.addColorStop(0.5, WOOD);
    wg.addColorStop(1, WOOD_DARK);
    ctx.fillStyle = wg;
    roundRect(ctx, fx, fy, fw, fh, L.frame);
    ctx.fill();
    ctx.restore();
    // grain lines on the frame
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const off = (L.frame / 3) * i;
      roundRect(ctx, fx + off, fy + off, fw - off * 2, fh - off * 2, Math.max(2, L.frame - off));
      ctx.stroke();
    }
    ctx.restore();
    // brass bolts
    const boltR = Math.max(2, L.frame * 0.28);
    const bolts: [number, number][] = [
      [fx + L.frame / 2, fy + L.frame / 2], [fx + fw - L.frame / 2, fy + L.frame / 2],
      [fx + L.frame / 2, fy + fh - L.frame / 2], [fx + fw - L.frame / 2, fy + fh - L.frame / 2],
    ];
    const midCount = Math.max(1, Math.floor(L.wellH / (cell * 3.5)));
    for (let i = 1; i <= midCount; i++) {
      const yy = fy + (fh * i) / (midCount + 1);
      bolts.push([fx + L.frame / 2, yy], [fx + fw - L.frame / 2, yy]);
    }
    for (const [bxp, byp] of bolts) {
      const bg = ctx.createRadialGradient(bxp - boltR * 0.3, byp - boltR * 0.3, boltR * 0.1, bxp, byp, boltR);
      bg.addColorStop(0, '#f3d98b');
      bg.addColorStop(1, '#8a6420');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(bxp, byp, boltR, 0, Math.PI * 2); ctx.fill();
    }
    // well interior
    const ig = ctx.createLinearGradient(L.wellX, L.wellY, L.wellX, L.wellY + L.wellH);
    ig.addColorStop(0, '#0a1420');
    ig.addColorStop(1, '#12233a');
    ctx.fillStyle = ig;
    ctx.fillRect(L.wellX, L.wellY, L.wellW, L.wellH);
    // grid lines
    ctx.strokeStyle = 'rgba(240,217,168,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < s.cols; c++) { ctx.moveTo(L.wellX + c * cell + 0.5, L.wellY); ctx.lineTo(L.wellX + c * cell + 0.5, L.wellY + L.wellH); }
    for (let r = 1; r < s.rows; r++) { ctx.moveTo(L.wellX, L.wellY + r * cell + 0.5); ctx.lineTo(L.wellX + L.wellW, L.wellY + r * cell + 0.5); }
    ctx.stroke();
    // spawn-space band + deck line
    ctx.fillStyle = 'rgba(200,155,60,0.07)';
    ctx.fillRect(L.wellX, L.wellY, L.wellW, cell * s.spawnRows);
    ctx.save();
    ctx.strokeStyle = 'rgba(200,155,60,0.5)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(L.wellX, L.wellY + cell * s.spawnRows + 0.5);
    ctx.lineTo(L.wellX + L.wellW, L.wellY + cell * s.spawnRows + 0.5);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(L.wellX, L.wellY, L.wellW, L.wellH);
    ctx.clip();

    // settled cells
    for (let r = 0; r < s.rows; r++) {
      const row = s.grid[r]!;
      for (let c = 0; c < s.cols; c++) {
        const v = row[c]!;
        if (v !== null) drawCell(ctx, L.wellX + c * cell, L.wellY + r * cell, cell, v);
      }
    }

    // ghost + active piece
    if (s.active && !s.over) {
      const gy = ghostY(s);
      const rel = SHAPE_CELLS[s.active.shape][s.active.rot & 3]!;
      if (gy !== s.active.y) {
        for (const c of rel) drawGhostCell(ctx, L.wellX + (s.active.x + c.x) * cell, L.wellY + (gy + c.y) * cell, cell, s.active.kind);
      }
      const tt = clamp((now - anim.tweenT0) / FALL_TWEEN_MS, 0, 1);
      const visY = lerp(anim.fromY, anim.toY, easeOut(tt));
      const grounded = gy === s.active.y;
      const glow = grounded ? 6 + 4 * Math.sin(now / 80) : 0;
      for (const c of rel) {
        drawCell(ctx, L.wellX + (s.active.x + c.x) * cell, L.wellY + (visY + c.y) * cell, cell, s.active.kind, 1, glow);
      }
    } else if (s.active && s.over && s.topOut) {
      for (const c of pieceCells(s.active)) drawCell(ctx, L.wellX + c.x * cell, L.wellY + c.y * cell, cell, s.active.kind, 0.6);
    }

    // lock flash
    if (anim.lockFlash) {
      const t = (now - anim.lockFlash.t0) / LOCK_FLASH_MS;
      if (t < 1) {
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - t)})`;
        for (const c of anim.lockFlash.cells) {
          roundRect(ctx, L.wellX + c.x * cell + 2, L.wellY + c.y * cell + 2, cell - 4, cell - 4, cell * 0.25);
          ctx.fill();
        }
      } else anim.lockFlash = null;
    }

    // row clear flashes
    for (const ca of anim.clears) {
      const t = clamp((now - ca.t0) / CLEAR_ANIM_MS, 0, 1);
      const a = 1 - t;
      for (const r of ca.rows) {
        const yy = L.wellY + r * cell;
        ctx.fillStyle = ca.primed ? `rgba(255,190,80,${0.85 * a})` : `rgba(255,255,255,${0.75 * a})`;
        ctx.fillRect(L.wellX, yy + cell * 0.5 * t, L.wellW, cell * (1 - t));
      }
    }
    ctx.restore(); // clip

    // cannon puffs outside the well (to starboard)
    for (const ca of anim.clears) {
      const t = clamp((now - ca.t0) / CLEAR_ANIM_MS, 0, 1);
      for (const r of ca.rows) {
        const cy = L.wellY + r * cell + cell / 2;
        const px = L.wellX + L.wellW + L.frame;
        for (let k = 0; k < 3; k++) {
          const rr = cell * (0.3 + 0.9 * easeOut(t)) * (1 - k * 0.2);
          const ox = easeOut(t) * cell * (1.2 + k * 0.6);
          ctx.fillStyle = ca.primed ? `rgba(255,200,120,${0.55 * (1 - t)})` : `rgba(220,220,220,${0.45 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(px + ox, cy - k * cell * 0.25, rr, 0, Math.PI * 2); ctx.fill();
        }
        if (t < 0.25) {
          ctx.fillStyle = `rgba(255,230,120,${1 - t * 4})`;
          ctx.beginPath(); ctx.arc(px, cy, cell * 0.35, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // "Primed!" flash
    const pt = (now - anim.primedT0) / PRIMED_FLASH_MS;
    if (pt >= 0 && pt < 1) {
      const scale = 1 + 0.35 * (1 - easeOut(Math.min(1, pt * 3)));
      ctx.save();
      ctx.globalAlpha = pt < 0.7 ? 1 : 1 - (pt - 0.7) / 0.3;
      ctx.translate(L.wellX + L.wellW / 2, L.wellY + L.wellH * 0.4);
      ctx.scale(scale, scale);
      outlinedText(ctx, 'Primed!', 0, 0, `${Math.max(22, cell * 1.3)}px ${DISPLAY_FONT}`, '#ffd27a', 'rgba(120,40,0,0.9)');
      ctx.restore();
    }
    ctx.restore(); // shake

    // --- game over overlay ---
    if (s.over) {
      ctx.fillStyle = 'rgba(13,27,42,0.65)';
      ctx.fillRect(L.wellX - L.frame, L.wellY - L.frame, L.wellW + L.frame * 2, L.wellH + L.frame * 2);
      outlinedText(ctx, s.topOut ? 'Guns spiked!' : 'Cease fire!', L.wellX + L.wellW / 2, L.wellY + L.wellH / 2 - 14, `${Math.max(22, cell * 1.2)}px ${DISPLAY_FONT}`, PARCHMENT, 'rgba(0,0,0,0.8)');
      outlinedText(ctx, `${s.points} pts  ·  ${s.cannonsLoaded} loaded`, L.wellX + L.wellW / 2, L.wellY + L.wellH / 2 + 14, `700 13px ${UI_FONT}`, BRASS, 'rgba(0,0,0,0.8)');
    }

    // --- buttons ---
    for (let i = 0; i < L.buttons.length; i++) {
      const b = L.buttons[i]!;
      const pressed = anim.pressed && anim.pressed.idx === i && now - anim.pressed.t0 < 120;
      const disabled = b.action.type === 'hold' && s.holdUsed;
      ctx.save();
      ctx.fillStyle = pressed ? BRASS : '#1b2a3b';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, b.x, b.y, b.w, b.h, 9);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = pressed ? PARCHMENT : 'rgba(200,155,60,0.6)';
      ctx.lineWidth = 2;
      roundRect(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 8);
      ctx.stroke();
      ctx.restore();
      const isWord = b.label.length > 1;
      outlinedText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, isWord ? `800 ${Math.min(13, b.w / 4)}px ${UI_FONT}` : `${Math.min(22, b.h * 0.5)}px ${UI_FONT}`, disabled ? '#6d7f91' : pressed ? NAVY : PARCHMENT, 'rgba(0,0,0,0.5)');
    }
    outlinedText(ctx, '←→/AD move · ↑/W/X rot · Z rot ↺ · ↓/S soft · Space drop · C/Shift hold · tap sides, swipe down', width / 2, L.hintY, `600 ${width < 480 ? 9 : 11}px ${UI_FONT}`, '#9ab0c4', 'rgba(0,0,0,0.5)');

    // focus ring
    if (focused) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,155,60,0.5)';
      ctx.lineWidth = 2;
      roundRect(ctx, 1, 1, width - 2, height - 2, 10);
      ctx.stroke();
      ctx.restore();
    }
  }, [state, now, width, height, focused, layout]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', touchAction: 'none', userSelect: 'none', cursor: 'pointer' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
