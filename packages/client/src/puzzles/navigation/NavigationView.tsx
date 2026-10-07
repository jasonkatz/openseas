import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ratingLabel } from '@tidebound/shared';
import type { PuzzleViewProps } from '../registry';
// Type-only import (erased at runtime); the shared package only exports its root at runtime.
import type { Action, State } from '../../../../shared/src/puzzles/navigation/engine';
import { fitCanvas, roundRect, outlinedText, drawPanel, lerp, easeOut, clamp } from '../../lib/canvas';
import { play } from '../../lib/audio';

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const HELM_X = 3;

const ROT_MS = 120;
const DROP_MS = 260;
const FLASH_MS = 1300;
const SPARK_MS = 700;

const NAVY = '#0d1b2a';
const PARCH = '#f0d9a8';
const PARCH_LIGHT = '#f7e6bf';
const PARCH_DARK = '#e6cb92';
const BRASS = '#c89b3c';
const INK = '#1b3a5c';
const GOLD = '#f0b83a';
const GOLD_LIGHT = '#fff1b8';
const STONE = '#8d9399';
const STONE_DARK = '#5c646b';

interface RotAnim { dir: 1 | -1; start: number }
interface Spark { x: number; y: number; vx: number; vy: number; start: number; hue: number }
interface Flash { text: string; start: number }

interface Layout {
  hudH: number;
  cell: number;
  boardX: number;
  starsY: number;
  gridY: number;
  helmY: number;
  boardW: number;
  panelX: number;
  panelY: number;
  panelW: number;
  panelH: number;
}

function layoutFor(width: number, height: number, w: number, h: number): Layout {
  const hudH = 60;
  const hintH = 26;
  const avail = height - hudH - hintH - 20;
  const cell = Math.max(24, Math.floor(Math.min((width - 36) / w, avail / (h + 2))));
  const boardW = cell * w;
  const boardX = Math.floor((width - boardW) / 2);
  const starsY = hudH + 10;
  const gridY = starsY + cell;
  const helmY = gridY + cell * h;
  return {
    hudH,
    cell,
    boardX,
    starsY,
    gridY,
    helmY,
    boardW,
    panelX: boardX - 10,
    panelY: starsY - 6,
    panelW: boardW + 20,
    panelH: cell * (h + 2) + 12,
  };
}

function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = '#4a3a1f';
  ctx.fillStyle = '#4a3a1f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const len = i % 2 === 0 ? r * 0.95 : r * 0.55;
    const wid = i % 2 === 0 ? r * 0.12 : r * 0.07;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.lineTo(cx + Math.cos(a + Math.PI / 2) * wid, cy + Math.sin(a + Math.PI / 2) * wid);
    ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * wid, cy + Math.sin(a - Math.PI / 2) * wid);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = `bold ${Math.round(r * 0.28)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r * 1.12);
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawHelm(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, lit: boolean, now: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (lit) ctx.rotate(now / 1800);
  ctx.strokeStyle = lit ? GOLD : BRASS;
  ctx.fillStyle = lit ? GOLD : BRASS;
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2.5, r * 0.22);
  ctx.strokeStyle = '#6b4a1e';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.strokeStyle = lit ? GOLD : BRASS;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = '#6b4a1e';
  ctx.fill();
  ctx.restore();
}

/** Draws one tile centred at (cx, cy). */
function drawTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  mask: number,
  locked: boolean,
  lit: boolean,
  angle: number,
  scale: number,
  shade: number,
  now: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (angle) ctx.rotate(angle);
  if (scale !== 1) ctx.scale(scale, scale);
  const half = size / 2;
  const inset = 1;
  // Square.
  ctx.fillStyle = locked ? STONE : shade ? PARCH_LIGHT : PARCH_DARK;
  ctx.fillRect(-half + inset, -half + inset, size - inset * 2, size - inset * 2);
  if (lit && !locked) {
    ctx.fillStyle = 'rgba(255, 214, 110, 0.28)';
    ctx.fillRect(-half + inset, -half + inset, size - inset * 2, size - inset * 2);
  }
  ctx.strokeStyle = locked ? STONE_DARK : 'rgba(70, 45, 15, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-half + inset + 0.5, -half + inset + 0.5, size - inset * 2 - 1, size - inset * 2 - 1);

  // Connectors.
  const segs: [number, number][] = [];
  if (mask & N) segs.push([0, -half]);
  if (mask & E) segs.push([half, 0]);
  if (mask & S) segs.push([0, half]);
  if (mask & W) segs.push([-half, 0]);
  const wBase = size * 0.22;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  const strokeSegs = (color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [sx, sy] of segs) {
      ctx.moveTo(0, 0);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  };
  if (lit) {
    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = size * 0.35;
    strokeSegs(GOLD, wBase);
    ctx.restore();
    strokeSegs(GOLD, wBase);
    // Animated current.
    ctx.save();
    ctx.setLineDash([size * 0.16, size * 0.2]);
    ctx.lineDashOffset = -((now / 28) % (size * 0.36));
    strokeSegs(GOLD_LIGHT, size * 0.07);
    ctx.restore();
    ctx.fillStyle = GOLD;
  } else {
    strokeSegs(locked ? '#2f3b47' : INK, wBase);
    ctx.fillStyle = locked ? '#2f3b47' : INK;
  }
  // Hub.
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (lit) {
    ctx.fillStyle = GOLD_LIGHT;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  // Reef icon.
  if (locked) {
    ctx.fillStyle = '#3d4449';
    ctx.strokeStyle = '#1f2529';
    ctx.lineWidth = 1;
    const bx = half * 0.62;
    const by = half * 0.62;
    ctx.beginPath();
    ctx.moveTo(bx - size * 0.2, by + size * 0.08);
    ctx.lineTo(bx - size * 0.12, by - size * 0.12);
    ctx.lineTo(bx - size * 0.04, by);
    ctx.lineTo(bx + size * 0.04, by - size * 0.18);
    ctx.lineTo(bx + size * 0.12, by + size * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export default function NavigationView({ state, dispatch, width, height, now, focused }: PuzzleViewProps<State, Action>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const nowRef = useRef(now);
  const focusedRef = useRef(focused);
  const layoutRef = useRef<Layout>(layoutFor(width, height, state.w, state.h));
  const cursorRef = useRef({ x: HELM_X, y: state.h - 1 });
  const rotAnims = useRef(new Map<string, RotAnim>());
  const dropAnims = useRef(new Map<string, number>());
  const sparks = useRef<Spark[]>([]);
  const flashRef = useRef<Flash | null>(null);
  const prevSeq = useRef(state.courseSeq);
  const prevFog = useRef(state.fog);
  const prevOver = useRef(state.over);

  stateRef.current = state;
  nowRef.current = now;
  focusedRef.current = focused;
  layoutRef.current = layoutFor(width, height, state.w, state.h);

  const act = (x: number, y: number, dir: 1 | -1): void => {
    const s = stateRef.current;
    if (!focusedRef.current || s.over) return;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
    const tile = s.tiles[y]?.[x];
    if (!tile) return;
    if (tile.locked) {
      play('lock');
      return;
    }
    rotAnims.current.set(`${x},${y}`, { dir, start: nowRef.current });
    play('tap');
    dispatch({ type: 'rotate', x, y, dir });
  };

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!focusedRef.current) return;
      const s = stateRef.current;
      const c = cursorRef.current;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': c.x = Math.max(0, c.x - 1); break;
        case 'ArrowRight': case 'd': case 'D': c.x = Math.min(s.w - 1, c.x + 1); break;
        case 'ArrowUp': case 'w': case 'W': c.y = Math.max(0, c.y - 1); break;
        case 'ArrowDown': case 's': case 'S': c.y = Math.min(s.h - 1, c.y + 1); break;
        case ' ': case 'Enter': case 'e': case 'E': case 'x': case 'X': act(c.x, c.y, 1); break;
        case 'q': case 'Q': case 'z': case 'Z': act(c.x, c.y, -1); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cellAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const L = layoutRef.current;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const x = Math.floor((px - L.boardX) / L.cell);
    const y = Math.floor((py - L.gridY) / L.cell);
    const s = stateRef.current;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return null;
    return { x, y };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType === 'touch') e.preventDefault();
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    cursorRef.current = cell;
    const dir: 1 | -1 = e.pointerType !== 'touch' && (e.button === 2 || e.shiftKey) ? -1 : 1;
    act(cell.x, cell.y, dir);
  };

  // Draw every frame.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const L = layoutRef.current;
    const { cell } = L;
    const s = state;

    // --- Event detection (engine state changes -> animation layer) ---
    if (s.courseSeq !== prevSeq.current) {
      prevSeq.current = s.courseSeq;
      const lc = s.lastCourse;
      if (lc) {
        flashRef.current = { text: `Course set! +${lc.points}`, start: now };
        for (const [x, y] of lc.cells) {
          dropAnims.current.set(`${x},${y}`, now);
          if (sparks.current.length < 160) {
            const cx = L.boardX + x * cell + cell / 2;
            const cy = L.gridY + y * cell + cell / 2;
            for (let i = 0; i < 2; i++) {
              const a = ((x * 7 + y * 13 + i * 5) % 12) * (Math.PI / 6);
              sparks.current.push({ x: cx, y: cy, vx: Math.cos(a) * 0.08, vy: Math.sin(a) * 0.08 - 0.05, start: now, hue: i });
            }
          }
        }
        // Star burst.
        const sx = L.boardX + lc.star * cell + cell / 2;
        const sy = L.starsY + cell / 2;
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6;
          sparks.current.push({ x: sx, y: sy, vx: Math.cos(a) * 0.14, vy: Math.sin(a) * 0.14, start: now, hue: 1 });
        }
        play('bell');
      }
    }
    if (prevFog.current <= 0.8 && s.fog > 0.8) play('bad');
    prevFog.current = s.fog;
    if (!prevOver.current && s.over) play(s.fog >= 1 ? 'lose' : 'win');
    prevOver.current = s.over;

    // --- Background ---
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, width, height);

    // --- Chart parchment ---
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    const g = ctx.createRadialGradient(
      L.panelX + L.panelW / 2, L.panelY + L.panelH / 2, L.panelW * 0.2,
      L.panelX + L.panelW / 2, L.panelY + L.panelH / 2, L.panelW * 0.75,
    );
    g.addColorStop(0, PARCH);
    g.addColorStop(1, '#d9b97e');
    ctx.fillStyle = g;
    roundRect(ctx, L.panelX, L.panelY, L.panelW, L.panelH, 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = 2;
    roundRect(ctx, L.panelX + 1, L.panelY + 1, L.panelW - 2, L.panelH - 2, 9);
    ctx.stroke();
    ctx.restore();
    drawCompass(ctx, L.boardX + L.boardW / 2, L.gridY + (cell * s.h) / 2, cell * s.h * 0.42);

    // --- Stars ---
    const flash = flashRef.current;
    const flashT = flash ? (now - flash.start) / FLASH_MS : 2;
    for (let i = 0; i < s.stars.length; i++) {
      const c = s.stars[i]!;
      const v = s.starValues[i] ?? 1;
      const cx = L.boardX + c * cell + cell / 2;
      const cy = L.starsY + cell / 2;
      const twinkle = 1 + 0.06 * Math.sin(now / 300 + c);
      ctx.save();
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = cell * 0.25;
      drawStar(ctx, cx, cy, cell * 0.3 * twinkle, GOLD, '#8a5a00');
      ctx.restore();
      outlinedText(ctx, String(v), cx, cy + cell * 0.04, `bold ${Math.round(cell * 0.28)}px Georgia, serif`, '#3a2500', 'rgba(255,240,200,0.9)');
    }
    // Faint connector from star down to the top edge of the grid.
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(60,40,15,0.35)';
    ctx.lineWidth = 1.5;
    for (const c of s.stars) {
      const cx = L.boardX + c * cell + cell / 2;
      ctx.beginPath();
      ctx.moveTo(cx, L.starsY + cell * 0.82);
      ctx.lineTo(cx, L.gridY);
      ctx.stroke();
    }
    ctx.restore();

    // --- Helm ---
    const helmTileLit = !!s.lit[s.h - 1]?.[HELM_X];
    const hx = L.boardX + HELM_X * cell + cell / 2;
    const hy = L.helmY + cell / 2;
    ctx.save();
    ctx.strokeStyle = helmTileLit ? GOLD : INK;
    ctx.lineWidth = cell * 0.22;
    ctx.beginPath();
    ctx.moveTo(hx, L.helmY);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.restore();
    drawHelm(ctx, hx, hy + cell * 0.04, cell * 0.3, helmTileLit, now);

    // --- Tiles ---
    const rot = rotAnims.current;
    const drops = dropAnims.current;
    for (let y = 0; y < s.h; y++) {
      const row = s.tiles[y]!;
      const litRow = s.lit[y]!;
      for (let x = 0; x < s.w; x++) {
        const tile = row[x]!;
        const key = `${x},${y}`;
        let angle = 0;
        const ra = rot.get(key);
        if (ra) {
          const t = (now - ra.start) / ROT_MS;
          if (t >= 1) rot.delete(key);
          else angle = -ra.dir * (Math.PI / 2) * (1 - easeOut(clamp(t, 0, 1)));
        }
        let scale = 1;
        const ds = drops.get(key);
        if (ds !== undefined) {
          const t = (now - ds) / DROP_MS;
          if (t >= 1) drops.delete(key);
          else {
            const e = easeOut(clamp(t, 0, 1));
            scale = lerp(0.25, 1, e) * (t > 0.7 ? 1 + 0.08 * Math.sin((t - 0.7) / 0.3 * Math.PI) : 1);
          }
        }
        drawTile(ctx, L.boardX + x * cell + cell / 2, L.gridY + y * cell + cell / 2, cell, tile.mask, tile.locked, !!litRow[x], angle, scale, (x + y) & 1, now);
      }
    }

    // --- Sparkles ---
    const sp = sparks.current;
    for (let i = sp.length - 1; i >= 0; i--) {
      const p = sp[i]!;
      const t = (now - p.start) / SPARK_MS;
      if (t >= 1) {
        sp[i] = sp[sp.length - 1]!;
        sp.pop();
        continue;
      }
      const dt = now - p.start;
      const px = p.x + p.vx * dt;
      const py = p.y + p.vy * dt + 0.00012 * dt * dt;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.hue ? GOLD_LIGHT : GOLD;
      drawStar(ctx, px, py, cell * 0.09 * (1 - t * 0.5), p.hue ? GOLD_LIGHT : GOLD, 'rgba(0,0,0,0)');
    }
    ctx.globalAlpha = 1;

    // --- Cursor ---
    if (focused && !s.over) {
      const c = cursorRef.current;
      ctx.save();
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = 3;
      ctx.shadowColor = BRASS;
      ctx.shadowBlur = 8;
      roundRect(ctx, L.boardX + c.x * cell + 2, L.gridY + c.y * cell + 2, cell - 4, cell - 4, 5);
      ctx.stroke();
      ctx.restore();
    }

    // --- Fog wash ---
    if (s.fog > 0.001) {
      ctx.save();
      roundRect(ctx, L.panelX, L.panelY, L.panelW, L.panelH, 10);
      ctx.clip();
      ctx.fillStyle = `rgba(150, 160, 170, ${(s.fog * 0.82).toFixed(3)})`;
      ctx.fillRect(L.panelX, L.panelY, L.panelW, L.panelH);
      // Drifting banks.
      ctx.globalAlpha = s.fog * 0.35;
      ctx.fillStyle = '#dfe4e8';
      for (let i = 0; i < 3; i++) {
        const bx = L.panelX + ((now / (900 + i * 300) + i * 0.37) % 1.4 - 0.2) * L.panelW;
        const by = L.panelY + L.panelH * (0.25 + i * 0.25);
        ctx.beginPath();
        ctx.ellipse(bx, by, L.panelW * 0.3, cell * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- HUD ---
    drawPanel(ctx, 8, 6, width - 16, L.hudH - 10, 10);
    const score = scoreOf(s);
    const remain = Math.max(0, s.durationMs - s.elapsedMs);
    const mm = Math.floor(remain / 60000);
    const ss = Math.floor((remain % 60000) / 1000);
    const hudY = 6 + (L.hudH - 10) / 2;
    const small = width < 520;
    const font = `bold ${small ? 13 : 16}px Georgia, serif`;
    outlinedText(ctx, `${s.points} pts`, 20, hudY, font, PARCH, 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, score.label, 20 + (small ? 70 : 100), hudY, `${small ? 12 : 14}px Georgia, serif`, BRASS, 'rgba(0,0,0,0.6)', 'left');
    outlinedText(ctx, `${mm}:${ss < 10 ? '0' : ''}${ss}`, width - 20, hudY, font, remain < 15000 ? '#ff8a8e' : PARCH, 'rgba(0,0,0,0.6)', 'right');
    // Fog meter.
    const mw = small ? 80 : 140;
    const mx = width - 20 - (small ? 56 : 70) - mw;
    const my = hudY - 7;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, mx, my, mw, 14, 7);
    ctx.fill();
    const fw = Math.max(0, mw * clamp(s.fog, 0, 1));
    if (fw > 0) {
      ctx.fillStyle = s.fog > 0.8 ? '#e5484d' : s.fog > 0.5 ? '#c9cfd6' : '#8fa3b5';
      roundRect(ctx, mx, my, Math.max(fw, 8), 14, 7);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(240,217,168,0.5)';
    ctx.lineWidth = 1;
    roundRect(ctx, mx + 0.5, my + 0.5, mw - 1, 13, 6.5);
    ctx.stroke();
    ctx.restore();
    outlinedText(ctx, `Fog ${Math.round(s.fog * 100)}%`, mx - 6, hudY, `${small ? 11 : 13}px Georgia, serif`, s.fog > 0.8 ? '#ff8a8e' : PARCH, 'rgba(0,0,0,0.6)', 'right');

    // --- Flash ---
    if (flash && flashT < 1) {
      const pop = flashT < 0.15 ? lerp(0.6, 1.15, flashT / 0.15) : flashT < 0.3 ? lerp(1.15, 1, (flashT - 0.15) / 0.15) : 1;
      const fy = L.gridY + cell * s.h * 0.45 - flashT * 20;
      ctx.save();
      ctx.globalAlpha = flashT < 0.75 ? 1 : 1 - (flashT - 0.75) / 0.25;
      ctx.translate(L.boardX + L.boardW / 2, fy);
      ctx.scale(pop, pop);
      outlinedText(ctx, flash.text, 0, 0, `bold ${Math.round(cell * 0.55)}px Georgia, serif`, GOLD_LIGHT, 'rgba(40,20,0,0.85)');
      ctx.restore();
    } else if (flash && flashT >= 1) {
      flashRef.current = null;
    }

    // --- Over ---
    if (s.over) {
      ctx.fillStyle = 'rgba(13,27,42,0.55)';
      ctx.fillRect(0, L.hudH, width, height - L.hudH);
      const lost = s.fog >= 1;
      outlinedText(ctx, lost ? 'Lost in the fog' : 'Watch over', width / 2, L.gridY + (cell * s.h) / 2 - 14, 'bold 28px Georgia, serif', lost ? '#ff8a8e' : PARCH);
      outlinedText(ctx, `${s.points} points — ${score.label}`, width / 2, L.gridY + (cell * s.h) / 2 + 18, '16px Georgia, serif', PARCH);
    }

    // --- Hint ---
    outlinedText(
      ctx,
      small ? 'Click/tap: turn • Right-click/Shift: back • Arrows + E/Q' : 'Click or tap: turn clockwise • Right-click / Shift-click: anticlockwise • Arrows move, E/Space turn, Q back',
      width / 2,
      height - 12,
      `${small ? 10 : 12}px Georgia, serif`,
      'rgba(240,217,168,0.75)',
      'rgba(0,0,0,0.5)',
    );
  }, [state, now, width, height, focused]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', touchAction: 'none', cursor: focused && !state.over ? 'pointer' : 'default' }}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

/** Mirrors the engine's score() (perf minus fog penalty) so the HUD needs no runtime import of the engine. */
function scoreOf(s: State): { label: string; performance: number } {
  const p = Math.max(0, Math.min(1, s.perf - s.fog * 0.3));
  return { label: ratingLabel(p), performance: p };
}
