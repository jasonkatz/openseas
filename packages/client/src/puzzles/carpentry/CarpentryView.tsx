import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
// Engine source is imported relatively: the shared package only exposes its root entry.
// `engine.ts` has no side effects, so this never double-registers the puzzle.
import {
  BREACH_CELLS,
  COLS,
  ROWS,
  canPlace,
  def,
  openCells,
  shapeBounds,
  type Action,
  type Pt,
  type State,
} from '../../../../shared/src/puzzles/carpentry/engine';
import type { PuzzleViewProps } from '../registry';
import { clamp, drawPanel, easeOut, fitCanvas, outlinedText, roundRect } from '../../lib/canvas';
import { play } from '../../lib/audio';

type Props = PuzzleViewProps<State, Action>;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SlotLayout {
  box: Rect;
  piece: Rect;
  rotate: Rect;
  flip: Rect;
  discard: Rect;
}

interface Layout {
  wide: boolean;
  hud: Rect;
  board: Rect;
  cell: number;
  tray: Rect;
  slots: SlotLayout[];
  hint: Rect;
}

const PAD = 10;
const HUD_H = 50;
const HINT_H = 22;

function computeLayout(width: number, height: number): Layout {
  const hud: Rect = { x: PAD, y: PAD, w: width - PAD * 2, h: HUD_H };
  const hint: Rect = { x: PAD, y: height - PAD - HINT_H, w: width - PAD * 2, h: HINT_H };
  const top = hud.y + hud.h + PAD;
  const bottom = hint.y - PAD;
  // Try both arrangements and keep whichever yields the larger cell.
  const trayW = clamp(Math.floor(width * 0.26), 130, 220);
  const wideCell = Math.floor(Math.min(width - trayW - PAD * 3, bottom - top) / COLS);
  const trayH = clamp(Math.floor(height * 0.19), 96, 140);
  const narrowCell = Math.floor(Math.min(width - PAD * 2, bottom - top - trayH - PAD) / ROWS);
  const wide = wideCell >= narrowCell;
  const cell = Math.max(8, wide ? wideCell : narrowCell);
  const boardW = cell * COLS;
  const boardH = cell * ROWS;
  let board: Rect;
  let tray: Rect;
  if (wide) {
    const totalW = boardW + PAD + trayW;
    const x0 = Math.floor((width - totalW) / 2);
    const y0 = Math.floor(top + (bottom - top - boardH) / 2);
    board = { x: x0, y: y0, w: boardW, h: boardH };
    tray = { x: x0 + boardW + PAD, y: y0, w: trayW, h: boardH };
  } else {
    const totalH = boardH + PAD + trayH;
    const y0 = Math.floor(top + (bottom - top - totalH) / 2);
    board = { x: Math.floor((width - boardW) / 2), y: y0, w: boardW, h: boardH };
    tray = { x: PAD, y: y0 + boardH + PAD, w: width - PAD * 2, h: trayH };
  }
  const slots: SlotLayout[] = [];
  const btnH = 22;
  for (let i = 0; i < 3; i++) {
    let box: Rect;
    if (wide) {
      const sh = Math.floor((tray.h - PAD * 2) / 3);
      box = { x: tray.x + 6, y: tray.y + PAD + i * sh, w: tray.w - 12, h: sh - 6 };
    } else {
      const sw = Math.floor((tray.w - PAD * 2) / 3);
      box = { x: tray.x + PAD + i * sw, y: tray.y + 6, w: sw - 6, h: tray.h - 12 };
    }
    const pieceH = Math.max(24, box.h - btnH - 14);
    const piece: Rect = { x: box.x + 4, y: box.y + 4, w: box.w - 8, h: pieceH };
    const by = box.y + box.h - btnH - 5;
    const bw = Math.floor((box.w - 16) / 3);
    const rotate: Rect = { x: box.x + 4, y: by, w: bw, h: btnH };
    const flip: Rect = { x: box.x + 8 + bw, y: by, w: bw, h: btnH };
    const discard: Rect = { x: box.x + 12 + bw * 2, y: by, w: bw, h: btnH };
    slots.push({ box, piece, rotate, flip, discard });
  }
  return { wide, hud, board, cell, tray, slots, hint };
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Small deterministic hash for per-cell visual variation. */
function hash(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function anchorOf(shape: readonly Pt[]): Pt {
  const b = shapeBounds(shape);
  return { x: Math.floor((b.w - 1) / 2), y: Math.floor((b.h - 1) / 2) };
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- drawing

const PLANK_TONES = ['#8a5a2b', '#9a6833', '#7f5127', '#946236'];
const FRESH_PLANK = '#d9a564';
const FRESH_LIGHT = '#eec07c';

function drawGrain(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, px: number, py: number, dark: string): void {
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, size * 0.03);
  for (let i = 0; i < 2; i++) {
    const gy = y + size * (0.3 + 0.4 * i) + (hash(px, py, i) - 0.5) * size * 0.2;
    const wob = (hash(px, py, 7 + i) - 0.5) * size * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.quadraticCurveTo(x + size / 2, gy + wob, x + size, gy);
    ctx.stroke();
  }
}

function drawSolidCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, px: number, py: number): void {
  const tone = PLANK_TONES[(py + (px >= 5 ? 2 : 0)) % PLANK_TONES.length]!;
  ctx.fillStyle = tone;
  ctx.fillRect(x, y, size, size);
  // subtle per-cell shade
  ctx.fillStyle = `rgba(0,0,0,${(hash(px, py, 3) * 0.12).toFixed(3)})`;
  ctx.fillRect(x, y, size, size);
  drawGrain(ctx, x, y, size, px, py, 'rgba(60,30,10,0.35)');
  // plank edges: top/bottom seam per row, staggered vertical seams
  ctx.fillStyle = 'rgba(40,20,8,0.5)';
  ctx.fillRect(x, y, size, 1);
  if ((px + py * 3) % 4 === 0) ctx.fillRect(x, y, 1.5, size);
}

function drawFilledCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, px: number, py: number): void {
  const g = ctx.createLinearGradient(x, y, x, y + size);
  g.addColorStop(0, FRESH_LIGHT);
  g.addColorStop(1, FRESH_PLANK);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  drawGrain(ctx, x, y, size, px, py, 'rgba(120,70,20,0.3)');
  ctx.strokeStyle = 'rgba(120,70,20,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  // nails
  const r = Math.max(1.2, size * 0.055);
  const off = size * 0.18;
  ctx.fillStyle = '#4a3a2a';
  for (const [nx, ny] of [[off, off], [size - off, off], [off, size - off], [size - off, size - off]] as const) {
    ctx.beginPath();
    ctx.arc(x + nx, y + ny, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [nx, ny] of [[off, off], [size - off, off], [off, size - off], [size - off, size - off]] as const) {
    ctx.beginPath();
    ctx.arc(x + nx - r * 0.3, y + ny - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHoleCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, px: number, py: number, now: number): void {
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#0c2d4b');
  g.addColorStop(1, '#061a2e');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  // faint moving water sheen
  const sheen = 0.5 + 0.5 * Math.sin(now / 900 + px * 0.9 + py * 1.3);
  ctx.fillStyle = `rgba(80,160,220,${(0.04 + sheen * 0.06).toFixed(3)})`;
  ctx.fillRect(x, y + size * 0.3, size, size * 0.4);
  // bubbles
  for (let i = 0; i < 2; i++) {
    const speed = 0.25 + hash(px, py, 20 + i) * 0.35; // cells per second
    const phase = hash(px, py, 30 + i);
    const t = ((now / 1000) * speed + phase) % 1;
    const bx = x + size * (0.2 + 0.6 * hash(px, py, 40 + i)) + Math.sin(now / 400 + i + px) * size * 0.05;
    const by = y + size - t * size;
    const r = Math.max(1, size * (0.03 + 0.04 * hash(px, py, 50 + i)));
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(170,220,255,${(0.55 * (1 - t)).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawPiece(ctx: CanvasRenderingContext2D, shape: readonly Pt[], r: Rect, fill: string, light: string, maxCell: number): void {
  const b = shapeBounds(shape);
  const cell = Math.min(maxCell, Math.floor(Math.min(r.w / Math.max(b.w, 1), r.h / Math.max(b.h, 1))));
  const ox = r.x + (r.w - b.w * cell) / 2;
  const oy = r.y + (r.h - b.h * cell) / 2;
  for (const p of shape) {
    const x = ox + p.x * cell;
    const y = oy + p.y * cell;
    const g = ctx.createLinearGradient(x, y, x, y + cell);
    g.addColorStop(0, light);
    g.addColorStop(1, fill);
    ctx.fillStyle = g;
    roundRect(ctx, x + 1, y + 1, cell - 2, cell - 2, cell * 0.18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,30,10,0.25)';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + cell * 0.5);
    ctx.lineTo(x + cell - 3, y + cell * 0.55);
    ctx.stroke();
  }
}

function drawButton(ctx: CanvasRenderingContext2D, r: Rect, label: string, accent: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, r.x, r.y, r.w, r.h, 6);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 6);
  ctx.stroke();
  outlinedText(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 1, `bold ${Math.min(13, r.h - 8)}px system-ui, sans-serif`, '#f0d9a8', 'rgba(0,0,0,0.5)');
}

// ---------------------------------------------------------------- component

export default function CarpentryView({ state, dispatch, width, height, now, focused }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState(0);
  const selRef = useRef(0);
  selRef.current = sel;
  const stateRef = useRef(state);
  stateRef.current = state;
  const cursorRef = useRef<Pt>({ x: 4, y: 4 });
  const layout = useMemo(() => computeLayout(width, height), [width, height]);
  const layoutRef = useRef<Layout>(layout);
  layoutRef.current = layout;
  // animation bookkeeping (visual only)
  const flashRef = useRef<{ seq: number; at: number }>({ seq: state.clearSeq, at: -1e9 });
  const popRef = useRef<{ seq: number; at: number }>({ seq: state.placeSeq, at: -1e9 });
  const seaRef = useRef<{ seq: number; at: number }>({ seq: state.seaSeq, at: -1e9 });
  const shakeRef = useRef<number>(-1e9);
  const discardFlashRef = useRef<number>(-1e9);
  const nowRef = useRef(now);
  nowRef.current = now;

  // Sounds / animation triggers keyed off engine sequence counters.
  useEffect(() => {
    if (state.clearSeq !== flashRef.current.seq) {
      flashRef.current = { seq: state.clearSeq, at: nowRef.current };
      play(state.lastCompletedPerfect ? 'win' : 'clear');
    }
  }, [state.clearSeq, state.lastCompletedPerfect]);
  useEffect(() => {
    if (state.placeSeq !== popRef.current.seq) popRef.current = { seq: state.placeSeq, at: nowRef.current };
  }, [state.placeSeq]);
  useEffect(() => {
    if (state.seaSeq !== seaRef.current.seq) {
      seaRef.current = { seq: state.seaSeq, at: nowRef.current };
      play('splash');
    }
  }, [state.seaSeq]);
  useEffect(() => {
    if (state.over) play(state.breached ? 'lose' : 'bell');
  }, [state.over, state.breached]);

  // ---- actions
  const select = (slot: number): void => {
    if (slot === selRef.current) return;
    setSel(slot);
    play('tap');
  };
  const tryPlace = (slot: number, x: number, y: number): void => {
    const s = stateRef.current;
    if (s.over) return;
    if (canPlace(s, slot, x, y)) {
      dispatch({ type: 'place', slot, x, y });
      play('lock');
    } else {
      shakeRef.current = nowRef.current;
    }
  };
  const discard = (slot: number): void => {
    if (stateRef.current.over) return;
    dispatch({ type: 'discard', slot });
    discardFlashRef.current = nowRef.current;
    play('bad');
  };
  const cursorFromPoint = (cx: number, cy: number): boolean => {
    const L = layoutRef.current;
    if (!inRect(L.board, cx, cy)) return false;
    const hx = Math.floor((cx - L.board.x) / L.cell);
    const hy = Math.floor((cy - L.board.y) / L.cell);
    const piece = stateRef.current.tray[selRef.current];
    const a = piece ? anchorOf(piece.shape) : { x: 0, y: 0 };
    cursorRef.current = { x: hx - a.x, y: hy - a.y };
    return true;
  };
  const pointerDown = (cx: number, cy: number): void => {
    const L = layoutRef.current;
    for (let i = 0; i < L.slots.length; i++) {
      const sl = L.slots[i]!;
      if (inRect(sl.rotate, cx, cy)) {
        select(i);
        dispatch({ type: 'rotate', slot: i });
        return;
      }
      if (inRect(sl.flip, cx, cy)) {
        select(i);
        dispatch({ type: 'flip', slot: i });
        return;
      }
      if (inRect(sl.discard, cx, cy)) {
        select(i);
        discard(i);
        return;
      }
      if (inRect(sl.box, cx, cy)) {
        select(i);
        return;
      }
    }
    if (cursorFromPoint(cx, cy)) {
      tryPlace(selRef.current, cursorRef.current.x, cursorRef.current.y);
    }
  };
  const canvasPoint = (clientX: number, clientY: number): [number, number] => {
    const c = canvasRef.current;
    if (!c) return [-1, -1];
    const r = c.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  };
  const onMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const [x, y] = canvasPoint(e.clientX, e.clientY);
    cursorFromPoint(x, y);
  };
  const onMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const [x, y] = canvasPoint(e.clientX, e.clientY);
    pointerDown(x, y);
  };
  const onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    dispatch({ type: 'rotate', slot: selRef.current });
  };
  const onTouchStart = (e: ReactTouchEvent<HTMLCanvasElement>): void => {
    const t = e.touches[0];
    if (!t) return;
    e.preventDefault();
    const [x, y] = canvasPoint(t.clientX, t.clientY);
    pointerDown(x, y);
  };
  const onTouchMove = (e: ReactTouchEvent<HTMLCanvasElement>): void => {
    const t = e.touches[0];
    if (!t) return;
    const [x, y] = canvasPoint(t.clientX, t.clientY);
    cursorFromPoint(x, y);
  };

  // ---- keyboard
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent): void => {
      const slot = selRef.current;
      const s = stateRef.current;
      let used = true;
      switch (e.key) {
        case '1':
        case '2':
        case '3':
          select(Number(e.key) - 1);
          break;
        case 'r':
        case 'R':
          dispatch({ type: 'rotate', slot });
          break;
        case 'f':
        case 'F':
          dispatch({ type: 'flip', slot });
          break;
        case 'x':
        case 'X':
          discard(slot);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          cursorRef.current = { x: Math.max(-4, cursorRef.current.x - 1), y: cursorRef.current.y };
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          cursorRef.current = { x: Math.min(COLS - 1, cursorRef.current.x + 1), y: cursorRef.current.y };
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          cursorRef.current = { x: cursorRef.current.x, y: Math.max(-4, cursorRef.current.y - 1) };
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          cursorRef.current = { x: cursorRef.current.x, y: Math.min(ROWS - 1, cursorRef.current.y + 1) };
          break;
        case ' ':
        case 'Enter':
          if (!s.over) tryPlace(slot, cursorRef.current.x, cursorRef.current.y);
          break;
        case 'Tab':
          select((slot + (e.shiftKey ? 2 : 1)) % 3);
          break;
        default:
          used = false;
      }
      if (used) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, dispatch]);

  // ---- draw
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const L = layoutRef.current;
    const { board, cell } = L;

    // background
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, width, height);
    // faint sea swell behind everything
    ctx.fillStyle = 'rgba(30,70,110,0.25)';
    for (let i = 0; i < 5; i++) {
      const yy = height * (0.2 + i * 0.18) + Math.sin(now / 1500 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= width; x += 20) ctx.lineTo(x, yy + Math.sin(x / 60 + now / 900 + i) * 4);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();
    }

    // shake on an illegal placement attempt
    const shakeT = (now - shakeRef.current) / 220;
    let shakeX = 0;
    if (shakeT >= 0 && shakeT < 1) shakeX = Math.sin(shakeT * Math.PI * 4) * 4 * (1 - shakeT);

    // ---- hull
    ctx.save();
    ctx.translate(shakeX, 0);
    // frame
    ctx.fillStyle = '#3b2412';
    roundRect(ctx, board.x - 6, board.y - 6, board.w + 12, board.h + 12, 8);
    ctx.fill();
    ctx.strokeStyle = '#c89b3c';
    ctx.lineWidth = 2;
    roundRect(ctx, board.x - 6, board.y - 6, board.w + 12, board.h + 12, 8);
    ctx.stroke();

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const k = y * COLS + x;
        const px = board.x + x * cell;
        const py = board.y + y * cell;
        const c = state.cells[k];
        if (c === 'hole') drawHoleCell(ctx, px, py, cell, x, y, now);
        else if (c === 'filled') drawFilledCell(ctx, px, py, cell, x, y);
        else drawSolidCell(ctx, px, py, cell, x, y);
      }
    }
    // hole rims: dark inner edge where water meets wood
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (state.cells[y * COLS + x] !== 'hole') continue;
        const px = board.x + x * cell;
        const py = board.y + y * cell;
        const solidAt = (xx: number, yy: number): boolean => xx < 0 || yy < 0 || xx >= COLS || yy >= ROWS || state.cells[yy * COLS + xx] !== 'hole';
        if (solidAt(x, y - 1)) { ctx.moveTo(px, py + 1); ctx.lineTo(px + cell, py + 1); }
        if (solidAt(x - 1, y)) { ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + cell); }
        if (solidAt(x + 1, y)) { ctx.moveTo(px + cell - 1, py); ctx.lineTo(px + cell - 1, py + cell); }
        if (solidAt(x, y + 1)) { ctx.moveTo(px, py + cell - 1); ctx.lineTo(px + cell, py + cell - 1); }
      }
    }
    ctx.stroke();

    // placement pop
    const popT = (now - popRef.current.at) / 350;
    if (popT >= 0 && popT < 1) {
      ctx.fillStyle = `rgba(255,240,200,${(0.5 * (1 - easeOut(popT))).toFixed(3)})`;
      for (const p of state.lastPlaced) ctx.fillRect(board.x + p.x * cell, board.y + p.y * cell, cell, cell);
    }
    // sea ripple on new/widened hole cells
    const seaT = (now - seaRef.current.at) / 900;
    if (seaT >= 0 && seaT < 1) {
      ctx.strokeStyle = `rgba(120,200,255,${(0.9 * (1 - seaT)).toFixed(3)})`;
      ctx.lineWidth = 2 + 4 * (1 - seaT);
      for (const p of state.lastSea) {
        const grow = cell * 0.5 * seaT;
        ctx.strokeRect(board.x + p.x * cell - grow, board.y + p.y * cell - grow, cell + grow * 2, cell + grow * 2);
      }
    }
    // completed hole flash (gold)
    const flashT = (now - flashRef.current.at) / 750;
    if (flashT >= 0 && flashT < 1) {
      const a = 1 - easeOut(flashT);
      ctx.fillStyle = `rgba(255,205,70,${(0.85 * a).toFixed(3)})`;
      for (const p of state.lastCompleted) ctx.fillRect(board.x + p.x * cell, board.y + p.y * cell, cell, cell);
      ctx.strokeStyle = `rgba(255,240,180,${a.toFixed(3)})`;
      ctx.lineWidth = 3;
      for (const p of state.lastCompleted) ctx.strokeRect(board.x + p.x * cell + 1.5, board.y + p.y * cell + 1.5, cell - 3, cell - 3);
    }

    // ghost piece
    const piece = state.tray[sel];
    if (piece && !state.over) {
      const cur = cursorRef.current;
      const legal = canPlace(state, sel, cur.x, cur.y);
      const pulse = 0.75 + 0.25 * Math.sin(now / 180);
      ctx.fillStyle = legal ? `rgba(90,220,120,${(0.45 * pulse).toFixed(3)})` : `rgba(230,70,70,${(0.4 * pulse).toFixed(3)})`;
      ctx.strokeStyle = legal ? 'rgba(160,255,180,0.95)' : 'rgba(255,140,140,0.9)';
      ctx.lineWidth = 2;
      for (const p of piece.shape) {
        const gx = cur.x + p.x;
        const gy = cur.y + p.y;
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) continue;
        const px = board.x + gx * cell;
        const py = board.y + gy * cell;
        ctx.fillRect(px + 2, py + 2, cell - 4, cell - 4);
        ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
      }
    }
    ctx.restore();

    // ---- tray
    drawPanel(ctx, L.tray.x, L.tray.y, L.tray.w, L.tray.h, 10);
    const discardT = (now - discardFlashRef.current) / 400;
    for (let i = 0; i < 3; i++) {
      const sl = L.slots[i]!;
      const p = state.tray[i];
      const selected = i === sel;
      ctx.fillStyle = selected ? 'rgba(200,155,60,0.22)' : 'rgba(0,0,0,0.22)';
      roundRect(ctx, sl.box.x, sl.box.y, sl.box.w, sl.box.h, 8);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = '#c89b3c';
        ctx.lineWidth = 2.5;
        roundRect(ctx, sl.box.x + 1, sl.box.y + 1, sl.box.w - 2, sl.box.h - 2, 7);
        ctx.stroke();
      }
      if (discardT >= 0 && discardT < 1 && selected) {
        ctx.fillStyle = `rgba(230,70,70,${(0.5 * (1 - discardT)).toFixed(3)})`;
        roundRect(ctx, sl.box.x, sl.box.y, sl.box.w, sl.box.h, 8);
        ctx.fill();
      }
      outlinedText(ctx, String(i + 1), sl.box.x + 10, sl.box.y + 11, 'bold 12px system-ui, sans-serif', selected ? '#ffd27a' : '#f0d9a8');
      if (p) drawPiece(ctx, p.shape, sl.piece, FRESH_PLANK, FRESH_LIGHT, Math.max(10, Math.floor(cell * 0.6)));
      const accent = selected ? '#c89b3c' : 'rgba(240,217,168,0.45)';
      drawButton(ctx, sl.rotate, '⟳', accent);
      drawButton(ctx, sl.flip, '⇋', accent);
      drawButton(ctx, sl.discard, '✕', selected ? '#e5484d' : 'rgba(229,72,77,0.5)');
    }

    // ---- HUD
    const open = openCells(state);
    const remaining = state.durationMs - state.elapsedMs;
    const hud = L.hud;
    drawPanel(ctx, hud.x, hud.y, hud.w, hud.h, 10);
    const perf = perfLabel(state);
    outlinedText(ctx, `${state.points} pts`, hud.x + 12, hud.y + 18, 'bold 18px system-ui, sans-serif', '#f0d9a8', 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, perf, hud.x + hud.w / 2, hud.y + 18, 'bold 16px system-ui, sans-serif', '#c89b3c');
    outlinedText(ctx, fmtTime(remaining), hud.x + hud.w - 12, hud.y + 18, 'bold 18px system-ui, sans-serif', remaining < 15000 ? '#ff8a8e' : '#f0d9a8', 'rgba(0,0,0,0.6)', 'right');
    const danger = open / BREACH_CELLS;
    const openColor = danger > 0.8 ? '#ff8a8e' : danger > 0.55 ? '#ffd27a' : '#9aeef7';
    outlinedText(ctx, `Open: ${open} / ${BREACH_CELLS} cells`, hud.x + 12, hud.y + 38, '12px system-ui, sans-serif', openColor, 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, `Patched: ${state.completedHoles}  ·  Discards: ${state.discards}`, hud.x + hud.w - 12, hud.y + 38, '12px system-ui, sans-serif', '#f0d9a8', 'rgba(0,0,0,0.6)', 'right');
    // breach meter under the HUD text
    const meter: Rect = { x: hud.x + hud.w * 0.34, y: hud.y + 33, w: hud.w * 0.32, h: 8 };
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, meter.x, meter.y, meter.w, meter.h, 4);
    ctx.fill();
    ctx.fillStyle = openColor;
    roundRect(ctx, meter.x, meter.y, Math.max(2, meter.w * clamp(danger, 0, 1)), meter.h, 4);
    ctx.fill();
    if (danger > 0.8 && !state.over) {
      const blink = 0.5 + 0.5 * Math.sin(now / 120);
      outlinedText(ctx, 'HULL BREACHING!', board.x + board.w / 2, board.y + 18, 'bold 16px system-ui, sans-serif', `rgba(255,120,120,${(0.4 + 0.6 * blink).toFixed(2)})`);
    }

    // perfect / completion banner
    const bannerT = (now - flashRef.current.at) / 1200;
    if (bannerT >= 0 && bannerT < 1 && flashRef.current.at > 0) {
      const a = bannerT < 0.7 ? 1 : (1 - bannerT) / 0.3;
      const rise = easeOut(Math.min(1, bannerT * 3)) * 14;
      const text = state.lastCompletedPerfect ? 'Perfect patch!' : 'Patched';
      outlinedText(ctx, text, board.x + board.w / 2, board.y + board.h / 2 - rise, `bold ${state.lastCompletedPerfect ? 30 : 22}px system-ui, sans-serif`, state.lastCompletedPerfect ? `rgba(255,215,90,${a.toFixed(2)})` : `rgba(240,217,168,${a.toFixed(2)})`, `rgba(0,0,0,${(0.75 * a).toFixed(2)})`);
    }

    // hint
    const hint = L.wide
      ? '1/2/3 select · R rotate · F flip · arrows/mouse aim · space/click place · X discard'
      : '1-3 select · R rotate · F flip · click/space place · X discard';
    outlinedText(ctx, hint, width / 2, L.hint.y + L.hint.h / 2, '11px system-ui, sans-serif', 'rgba(240,217,168,0.8)', 'rgba(0,0,0,0.5)');

    // game over
    if (state.over) {
      ctx.fillStyle = 'rgba(5,10,20,0.6)';
      ctx.fillRect(0, 0, width, height);
      const title = state.breached ? 'Hull breached!' : 'Shift over';
      outlinedText(ctx, title, width / 2, height / 2 - 20, 'bold 34px system-ui, sans-serif', state.breached ? '#ff8a8e' : '#f0d9a8');
      outlinedText(ctx, `${state.points} pts · ${state.completedHoles} holes patched · ${perf}`, width / 2, height / 2 + 18, 'bold 16px system-ui, sans-serif', '#c89b3c');
    }
  }, [state, now, width, height, focused, sel]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    />
  );
}

function perfLabel(state: State): string {
  return def.score(state).label;
}
