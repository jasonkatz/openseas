import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  BATTLE_H, BATTLE_RESOLVE_MS, BATTLE_W, CANNON_RANGE, SEGMENTS, SQ_DIRS,
  type BattleEvent, type BattleShip, type BattleState, type Cell, type TurnOrders,
} from '@tidebound/shared';
import { clamp, easeInOut, easeOut, fitCanvas, lerp, outlinedText } from '../../lib/canvas';
import { play } from '../../lib/audio';

export interface BattleBoardProps {
  state: BattleState;
  myShipId: string;
  width: number;
  height: number;
  /** Server-clock time in ms (same clock as `state.phaseEndsAt`). */
  now: number;
  /** Pending orders to ghost on the board during the 'orders' phase. */
  preview?: TurnOrders;
}

// ---------------------------------------------------------------------------
// Timing of the resolve animation. Four ~1.1s segment windows + a tail for
// grapple ropes / sink fades, all inside BATTLE_RESOLVE_MS.

const SEG_MS = 1100;
const STEP_MS = 300;
const TURN_MS = 160;
const SHOT_GAP_MS = 90;
const BALL_MS_PER_CELL = 70;
const SPLASH_MS = 520;
const SUNK_MS = 700;
const SHAKE_MS = 320;
const SOUND_LATE_MS = 400;

const UI_FONT = 'Nunito, system-ui, sans-serif';
const DISPLAY_FONT = '"Pirata One", "IM Fell English", serif';

const SHIP_LEN = [0.58, 0.66, 0.76, 0.86] as const;
const SHIP_BEAM = [0.26, 0.29, 0.33, 0.37] as const;
const SHIP_MASTS = [1, 1, 2, 3] as const;
const ROPE_DASH = [6, 4];
const ROUTE_DASH = [4, 5];
const NO_DASH: number[] = [];

interface Wave { x: number; y: number; len: number; phase: number; speed: number }
const WAVES: readonly Wave[] = buildWaves();
function buildWaves(): Wave[] {
  let s = 1234567;
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out: Wave[] = [];
  for (let i = 0; i < 56; i++) out.push({ x: rnd(), y: rnd(), len: 0.25 + rnd() * 0.35, phase: rnd() * Math.PI * 2, speed: 0.6 + rnd() * 0.8 });
  return out;
}

interface RockShape { q: number; r: number; pts: Float32Array; tilt: number }
function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a + 17, 73856093) ^ Math.imul(b + 31, 19349663) ^ Math.imul(c + 7, 83492791)) >>> 0;
  h = (Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489917)) >>> 0;
  return (h % 10007) / 10007;
}
function buildRocks(rocks: Cell[]): RockShape[] {
  return rocks.map((c) => {
    const pts = new Float32Array(18);
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2 + (hash01(c.q, c.r, i) - 0.5) * 0.4;
      const rad = 0.28 + hash01(c.q, c.r, i + 100) * 0.16;
      pts[i * 2] = Math.cos(ang) * rad;
      pts[i * 2 + 1] = Math.sin(ang) * rad;
    }
    return { q: c.q, r: c.r, pts, tilt: hash01(c.q, c.r, 999) * Math.PI };
  });
}

// ---------------------------------------------------------------------------
// Timeline: schedule each event of the last resolved turn on a clock that
// starts at `phaseEndsAt - BATTLE_RESOLVE_MS`.

interface Anim {
  idx: number;
  ev: BattleEvent;
  start: number;
  dur: number;
  hFrom: number;
  hTo: number;
  splashQ: number;
  splashR: number;
  shotFromQ: number;
  shotFromR: number;
  shotToQ: number;
  shotToR: number;
}
interface ShipStart { q: number; r: number; heading: number; hull: number; sunk: boolean }
interface Timeline { anims: Anim[]; starts: Map<string, ShipStart>; movable: boolean }

function inBounds(q: number, r: number): boolean { return q >= 0 && r >= 0 && q < BATTLE_W && r < BATTLE_H; }
function dirOf(h: number): Cell { return SQ_DIRS[((h % 4) + 4) % 4]!; }

function buildTimeline(state: BattleState, snapshot: Map<string, ShipStart>): Timeline {
  const evs = state.lastEvents;
  const starts = new Map<string, ShipStart>();

  // Previous positions: walk the ship's events to find where it started this turn.
  for (const s of state.ships) {
    const st: ShipStart = { q: s.cell.q, r: s.cell.r, heading: s.heading, hull: s.hull, sunk: s.sunk };
    let firstMove: BattleEvent | undefined;
    let firstHeading: BattleEvent | undefined;
    for (const ev of evs) {
      if (ev.shipId === s.id) {
        if (!firstMove && ev.kind === 'move' && ev.from) firstMove = ev;
        if (!firstHeading && (ev.kind === 'move' || ev.kind === 'turn') && ev.heading !== undefined) firstHeading = ev;
        if (ev.kind === 'sunk') st.sunk = false;
        if ((ev.kind === 'ram' || ev.kind === 'rock') && ev.dmg) st.hull += ev.dmg;
      }
      if (ev.kind === 'hit' && ev.targetId === s.id && ev.dmg) st.hull += ev.dmg;
    }
    if (firstMove?.from) { st.q = firstMove.from.q; st.r = firstMove.from.r; }
    if (firstHeading && firstHeading.heading !== undefined) {
      if (firstHeading.kind === 'move') st.heading = firstHeading.heading;
      else {
        // A 'turn' only records the new heading; use the orders-phase snapshot if we have one.
        const sn = snapshot.get(s.id);
        st.heading = sn ? sn.heading : (firstHeading.heading + 3) % 4;
      }
    }
    st.hull = Math.min(s.maxHull, st.hull);
    starts.set(s.id, st);
  }

  // Schedule.
  const anims: Anim[] = [];
  const lastEnd = new Map<string, number>();
  const moveCount = new Map<string, number>();
  const headingNow = new Map<string, number>();
  for (const [id, st] of starts) headingNow.set(id, st.heading);
  let curSeg = -1;
  let shotIdx = 0;
  let lastShot: Anim | null = null;
  evs.forEach((ev, idx) => {
    const seg = clamp(ev.seg | 0, 0, SEGMENTS - 1);
    if (seg !== curSeg) { curSeg = seg; moveCount.clear(); shotIdx = 0; }
    const base = seg * SEG_MS;
    const a: Anim = { idx, ev, start: base, dur: STEP_MS, hFrom: 0, hTo: 0, splashQ: 0, splashR: 0, shotFromQ: 0, shotFromR: 0, shotToQ: 0, shotToR: 0 };
    switch (ev.kind) {
      case 'move': case 'blocked': case 'ram': case 'rock': {
        const n = moveCount.get(ev.shipId) ?? 0;
        moveCount.set(ev.shipId, n + 1);
        a.start = base + (n === 0 ? 0 : STEP_MS + TURN_MS);
        a.dur = ev.kind === 'move' ? STEP_MS : SHAKE_MS;
        if (ev.kind === 'move' && ev.heading !== undefined) headingNow.set(ev.shipId, ev.heading);
        break;
      }
      case 'turn': {
        a.start = base + STEP_MS;
        a.dur = TURN_MS;
        a.hFrom = headingNow.get(ev.shipId) ?? ev.heading ?? 0;
        a.hTo = ev.heading ?? a.hFrom;
        headingNow.set(ev.shipId, a.hTo);
        break;
      }
      case 'shot': {
        a.start = base + STEP_MS * 2 + TURN_MS + shotIdx * SHOT_GAP_MS;
        shotIdx++;
        const cells = ev.path?.length ?? 0;
        a.dur = Math.max(1, cells) * BALL_MS_PER_CELL;
        a.shotFromQ = ev.from?.q ?? 0;
        a.shotFromR = ev.from?.r ?? 0;
        const last = cells > 0 ? ev.path![cells - 1]! : undefined;
        if (last) { a.shotToQ = last.q; a.shotToR = last.r; }
        else {
          const d = dirOf(ev.heading ?? 0);
          a.shotToQ = a.shotFromQ + d.q * 0.5;
          a.shotToR = a.shotFromR + d.r * 0.5;
        }
        lastShot = a;
        break;
      }
      case 'hit': case 'miss': {
        a.start = lastShot ? lastShot.start + lastShot.dur : base + STEP_MS * 2 + TURN_MS;
        a.dur = SPLASH_MS;
        const last = ev.kind === 'hit' ? ev.to : (ev.path && ev.path.length > 0 ? ev.path[ev.path.length - 1] : undefined);
        if (last) { a.splashQ = last.q; a.splashR = last.r; }
        else if (lastShot) { a.splashQ = lastShot.shotToQ; a.splashR = lastShot.shotToR; }
        break;
      }
      case 'sunk': {
        a.start = lastEnd.get(ev.shipId) ?? base;
        a.dur = SUNK_MS;
        break;
      }
      case 'grapple': {
        a.start = SEGMENTS * SEG_MS;
        a.dur = BATTLE_RESOLVE_MS - SEGMENTS * SEG_MS;
        break;
      }
    }
    anims.push(a);
    const affected = ev.kind === 'hit' ? ev.targetId : ev.shipId;
    if (affected) {
      const end = ev.kind === 'hit' ? a.start + 120 : a.start + a.dur;
      lastEnd.set(affected, Math.max(lastEnd.get(affected) ?? 0, end));
    }
  });
  anims.sort((x, y) => x.start - y.start || x.idx - y.idx);

  // Verify by replaying forward; if the result disagrees with the current state, hold positions static.
  let movable = evs.length > 0;
  const pos = new Map<string, { q: number; r: number; h: number }>();
  for (const [id, st] of starts) pos.set(id, { q: st.q, r: st.r, h: st.heading });
  for (const ev of evs) {
    const p = pos.get(ev.shipId);
    if (!p) continue;
    if (ev.kind === 'move' && ev.from && ev.to) {
      if (p.q !== ev.from.q || p.r !== ev.from.r) movable = false;
      p.q = ev.to.q; p.r = ev.to.r;
    } else if (ev.kind === 'turn' && ev.heading !== undefined) {
      p.h = ev.heading;
    }
  }
  for (const s of state.ships) {
    const p = pos.get(s.id);
    if (!p || p.q !== s.cell.q || p.r !== s.cell.r || ((p.h % 4) + 4) % 4 !== ((s.heading % 4) + 4) % 4) movable = false;
  }
  return { anims, starts, movable };
}

// ---------------------------------------------------------------------------
// Per-frame display state (mutated in place; no per-frame allocation).

interface Disp { x: number; y: number; heading: number; hull: number; alpha: number; shake: number; flash: number; sunk: boolean; sunkAt: number }

function shortestTurn(from: number, to: number): number {
  let d = (((to - from) % 4) + 4) % 4;
  if (d === 3) d = -1;
  return d;
}

function computeDisplay(state: BattleState, tl: Timeline, t: number, animating: boolean, disp: Map<string, Disp>): void {
  for (const s of state.ships) {
    let d = disp.get(s.id);
    if (!d) { d = { x: 0, y: 0, heading: 0, hull: 0, alpha: 1, shake: 0, flash: 0, sunk: false, sunkAt: -1 }; disp.set(s.id, d); }
    d.shake = 0; d.flash = 0;
    if (!animating) {
      d.x = s.cell.q; d.y = s.cell.r; d.heading = s.heading; d.hull = s.hull; d.sunk = s.sunk; d.alpha = s.sunk ? 0 : 1;
      continue;
    }
    const st = tl.starts.get(s.id);
    if (!st || !tl.movable) { d.x = s.cell.q; d.y = s.cell.r; d.heading = s.heading; }
    else { d.x = st.q; d.y = st.r; d.heading = st.heading; }
    d.hull = st ? st.hull : s.hull;
    d.sunk = st ? st.sunk : s.sunk;
    d.alpha = d.sunk ? 0 : 1;
  }
  if (!animating) return;
  for (const a of tl.anims) {
    if (a.start > t) break;
    const p = clamp((t - a.start) / a.dur, 0, 1);
    const ev = a.ev;
    const d = disp.get(ev.kind === 'hit' ? (ev.targetId ?? '') : ev.shipId);
    if (!d) continue;
    switch (ev.kind) {
      case 'move':
        if (tl.movable && ev.from && ev.to) {
          const e = easeInOut(p);
          d.x = lerp(ev.from.q, ev.to.q, e);
          d.y = lerp(ev.from.r, ev.to.r, e);
        }
        break;
      case 'turn':
        if (tl.movable) d.heading = a.hFrom + shortestTurn(a.hFrom, a.hTo) * easeInOut(p);
        break;
      case 'blocked':
        if (p < 1) d.shake = Math.max(d.shake, (1 - p) * 0.6);
        break;
      case 'ram': case 'rock':
        if (p < 1) { d.shake = Math.max(d.shake, 1 - p); d.flash = Math.max(d.flash, 1 - p); }
        if (ev.dmg) d.hull = Math.max(0, d.hull - ev.dmg);
        break;
      case 'hit':
        if (ev.dmg) d.hull = Math.max(0, d.hull - ev.dmg);
        if (p < 1) d.flash = Math.max(d.flash, 1 - p);
        break;
      case 'sunk':
        d.alpha = 1 - easeOut(p);
        if (p >= 1) { d.sunk = true; d.sunkAt = a.start + a.dur; }
        break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing primitives.

function hullPath(ctx: CanvasRenderingContext2D, L: number, B: number, dx = 0, dy = 0): void {
  ctx.beginPath();
  ctx.moveTo(dx, dy - L);
  ctx.bezierCurveTo(dx + B, dy - L * 0.45, dx + B, dy + L * 0.35, dx + B * 0.8, dy + L);
  ctx.lineTo(dx - B * 0.8, dy + L);
  ctx.bezierCurveTo(dx - B, dy + L * 0.35, dx - B, dy - L * 0.45, dx, dy - L);
  ctx.closePath();
}

function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, headingRad: number, sprite: number, mine: boolean, alpha: number, flash: number, ghost: boolean): void {
  const si = clamp(sprite | 0, 0, 3);
  const L = (cell * SHIP_LEN[si]!) / 2;
  const B = (cell * SHIP_BEAM[si]!) / 2;
  const masts = SHIP_MASTS[si]!;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(headingRad);
  ctx.globalAlpha = alpha;
  if (ghost) {
    ctx.setLineDash(NO_DASH);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = mine ? 'rgba(240,217,168,0.9)' : 'rgba(255,255,255,0.7)';
    ctx.fillStyle = mine ? 'rgba(41,198,214,0.18)' : 'rgba(0,0,0,0.2)';
    hullPath(ctx, L, B);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.9);
    ctx.lineTo(0, L * 0.9);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // Shadow / wake.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  hullPath(ctx, L * 1.04, B * 1.12, 2, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-B * 0.9, L * 1.05);
  ctx.lineTo(-B * 1.6, L * 1.9);
  ctx.moveTo(B * 0.9, L * 1.05);
  ctx.lineTo(B * 1.6, L * 1.9);
  ctx.stroke();
  // Hull.
  hullPath(ctx, L, B);
  ctx.fillStyle = '#7a4a24';
  ctx.fill();
  ctx.lineWidth = Math.max(1, cell * 0.035);
  ctx.strokeStyle = '#2a170a';
  ctx.stroke();
  // Gunwale highlight on the port side.
  ctx.strokeStyle = 'rgba(255,220,160,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-B * 0.05, -L * 0.92);
  ctx.bezierCurveTo(-B * 0.85, -L * 0.45, -B * 0.85, L * 0.35, -B * 0.7, L * 0.9);
  ctx.stroke();
  // Deck.
  hullPath(ctx, L * 0.8, B * 0.6);
  ctx.fillStyle = '#b8864f';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,20,0.5)';
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(-B * 0.5, (i * L) / 3); ctx.lineTo(B * 0.5, (i * L) / 3); }
  ctx.stroke();
  // Bowsprit.
  ctx.strokeStyle = '#3a2410';
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.beginPath();
  ctx.moveTo(0, -L);
  ctx.lineTo(0, -L * 1.25);
  ctx.stroke();
  // Masts & sails.
  const sailFill = mine ? '#f0d9a8' : '#1c1c22';
  const sailEdge = mine ? '#29c6d6' : '#5c5c66';
  const sw = B * 1.9;
  const mastR = Math.max(1.5, B * 0.2);
  for (let i = 0; i < masts; i++) {
    const my = masts === 1 ? -L * 0.05 : masts === 2 ? (i === 0 ? -L * 0.38 : L * 0.3) : (i - 1) * L * 0.46;
    ctx.beginPath();
    ctx.moveTo(-sw / 2, my);
    ctx.quadraticCurveTo(0, my + L * 0.34, sw / 2, my);
    ctx.quadraticCurveTo(0, my + L * 0.14, -sw / 2, my);
    ctx.closePath();
    ctx.fillStyle = sailFill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = sailEdge;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, my, mastR, 0, Math.PI * 2);
    ctx.fillStyle = '#3a2410';
    ctx.fill();
  }
  // Pennant from the foremost mast.
  {
    const my = masts === 1 ? -L * 0.05 : masts === 2 ? -L * 0.38 : -L * 0.46;
    ctx.beginPath();
    ctx.moveTo(0, my - 1);
    ctx.lineTo(B * 1.1, my - L * 0.12);
    ctx.lineTo(0, my - L * 0.16);
    ctx.closePath();
    ctx.fillStyle = mine ? '#29c6d6' : '#e5484d';
    ctx.fill();
  }
  if (flash > 0) {
    ctx.globalAlpha = alpha * flash * 0.75;
    ctx.fillStyle = '#ff3b3b';
    hullPath(ctx, L * 1.02, B * 1.05);
    ctx.fill();
  }
  ctx.restore();
}

function drawWreck(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, now: number, seed: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#2a1a10';
  ctx.rotate(0.5 + seed);
  ctx.fillRect(-cell * 0.22, -cell * 0.05, cell * 0.44, cell * 0.1);
  ctx.rotate(1.3);
  ctx.fillRect(-cell * 0.16, -cell * 0.04, cell * 0.32, cell * 0.08);
  ctx.restore();
  // Bubbles.
  for (let i = 0; i < 3; i++) {
    const ph = ((now / 1100) + i * 0.37 + seed) % 1;
    const bx = x + (i - 1) * cell * 0.14 + Math.sin(now / 300 + i) * 2;
    const by = y + cell * 0.12 - ph * cell * 0.5;
    ctx.beginPath();
    ctx.arc(bx, by, 1.5 + i * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - ph)).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, p: number, hot: boolean): void {
  const r = cell * (0.12 + 0.42 * easeOut(p));
  ctx.save();
  ctx.globalAlpha = (1 - p) * 0.9;
  ctx.lineWidth = Math.max(1.5, cell * 0.06 * (1 - p));
  ctx.strokeStyle = hot ? '#ffd27a' : '#e8f6ff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (p < 0.5) {
    ctx.globalAlpha = (1 - p * 2) * 0.8;
    ctx.fillStyle = hot ? '#ff8a3c' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.12 * (1 - p), 0, Math.PI * 2);
    ctx.fill();
  }
  // Droplets.
  ctx.fillStyle = hot ? '#ffd27a' : '#e8f6ff';
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + 0.4;
    const dist = cell * (0.1 + 0.5 * easeOut(p));
    const rise = Math.sin(p * Math.PI) * cell * 0.25;
    ctx.globalAlpha = (1 - p) * 0.8;
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist * 0.6 - rise, Math.max(1, cell * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, head: number): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(ang - 0.5) * head, y1 - Math.sin(ang - 0.5) * head);
  ctx.lineTo(x1 - Math.cos(ang + 0.5) * head, y1 - Math.sin(ang + 0.5) * head);
  ctx.closePath();
  ctx.fill();
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,20,33,0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(240,217,168,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Minor points.
  ctx.fillStyle = '#8a6a3c';
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate(Math.PI / 4 + (i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.6);
    ctx.lineTo(r * 0.12, 0);
    ctx.lineTo(0, r * 0.6);
    ctx.lineTo(-r * 0.12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Major points.
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.88);
    ctx.lineTo(r * 0.16, 0);
    ctx.lineTo(0, r * 0.2);
    ctx.lineTo(-r * 0.16, 0);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? '#f0c76a' : '#c89b3c';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.88);
    ctx.lineTo(r * 0.16, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = '#f0d9a8';
  ctx.fill();
  ctx.restore();
  outlinedText(ctx, 'N', x, y - r * 1.15, `${Math.max(9, r * 0.5)}px ${DISPLAY_FONT}`, '#f0c76a', 'rgba(0,0,0,0.7)');
}

// ---------------------------------------------------------------------------

export function BattleBoard({ state, myShipId, width, height, now, preview }: BattleBoardProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dispRef = useRef<Map<string, Disp>>(new Map());
  const snapshotRef = useRef<Map<string, ShipStart>>(new Map());
  const soundRef = useRef<{ key: string; played: Set<number> }>({ key: '', played: new Set() });

  const rockShapes = useMemo(() => buildRocks(state.rocks), [state.rocks]);
  const rockSet = useMemo(() => new Set(state.rocks.map((c) => `${c.q},${c.r}`)), [state.rocks]);
  const eventsKey = `${state.id}:${state.lastEvents[0]?.turn ?? state.turn}:${state.lastEvents.length}`;
  // Snapshot positions seen during the orders phase so a leading 'turn' event can be rewound.
  if (state.phase === 'orders') {
    const snap = snapshotRef.current;
    for (const s of state.ships) {
      let e = snap.get(s.id);
      if (!e) { e = { q: 0, r: 0, heading: 0, hull: 0, sunk: false }; snap.set(s.id, e); }
      e.q = s.cell.q; e.r = s.cell.r; e.heading = s.heading; e.hull = s.hull; e.sunk = s.sunk;
    }
  }
  const timeline = useMemo(() => buildTimeline(state, snapshotRef.current), [state]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas, width, height);
    const size = Math.min(width, height);
    const pad = Math.max(8, size * 0.025);
    const cell = (size - pad * 2) / BATTLE_W;
    const ox = (width - cell * BATTLE_W) / 2;
    const oy = (height - cell * BATTLE_H) / 2;
    const boardW = cell * BATTLE_W;
    const boardH = cell * BATTLE_H;
    const px = (q: number): number => ox + (q + 0.5) * cell;
    const py = (r: number): number => oy + (r + 0.5) * cell;

    // ---- Resolve clock ----
    const resolveStart = state.phaseEndsAt - BATTLE_RESOLVE_MS;
    const rel = now - resolveStart;
    const animating = state.phase !== 'orders' && state.lastEvents.length > 0 && rel >= -1500 && rel <= BATTLE_RESOLVE_MS + 600;
    const t = clamp(rel, 0, BATTLE_RESOLVE_MS + 600);
    const disp = dispRef.current;
    computeDisplay(state, timeline, t, animating, disp);

    // ---- Sounds (once per event) ----
    const snd = soundRef.current;
    if (snd.key !== eventsKey) { snd.key = eventsKey; snd.played.clear(); }
    if (animating) {
      for (const a of timeline.anims) {
        if (a.start > t) break;
        if (snd.played.has(a.idx)) continue;
        snd.played.add(a.idx);
        if (t - a.start > SOUND_LATE_MS) continue;
        switch (a.ev.kind) {
          case 'shot': play('cannon'); break;
          case 'hit': play('hit'); break;
          case 'miss': play('splash'); break;
          case 'ram': case 'rock': play('bad'); break;
          case 'sunk': play('splash'); break;
          case 'grapple': play('bell'); break;
          default: break;
        }
      }
    }

    // ---- Background ----
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, width, height);
    const seaG = ctx.createLinearGradient(ox, oy, ox + boardW, oy + boardH);
    seaG.addColorStop(0, '#2468a0');
    seaG.addColorStop(0.5, '#1f5f8b');
    seaG.addColorStop(1, '#174a70');
    ctx.fillStyle = seaG;
    ctx.fillRect(ox, oy, boardW, boardH);
    // Wave shimmer.
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.lineCap = 'round';
    for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i]!;
      const a = 0.05 + 0.1 * (0.5 + 0.5 * Math.sin(now * 0.0014 * w.speed + w.phase));
      const wx = ox + w.x * boardW;
      const wy = oy + w.y * boardH + Math.sin(now * 0.0007 + w.phase) * cell * 0.06;
      const wl = w.len * cell;
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(wx - wl / 2, wy);
      ctx.quadraticCurveTo(wx, wy - cell * 0.12, wx + wl / 2, wy);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // Grid.
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= BATTLE_W; i++) { const x = Math.round(ox + i * cell) + 0.5; ctx.moveTo(x, oy); ctx.lineTo(x, oy + boardH); }
    for (let j = 0; j <= BATTLE_H; j++) { const y = Math.round(oy + j * cell) + 0.5; ctx.moveTo(ox, y); ctx.lineTo(ox + boardW, y); }
    ctx.stroke();

    // ---- Rocks ----
    for (const rk of rockShapes) {
      const x = px(rk.q);
      const y = py(rk.r);
      const foam = 0.22 + 0.14 * Math.sin(now * 0.003 + rk.tilt * 3);
      ctx.strokeStyle = `rgba(255,255,255,${foam.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.44 + Math.sin(now * 0.004 + rk.tilt) * cell * 0.02, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const vx = x + rk.pts[i * 2]! * cell;
        const vy = y + rk.pts[i * 2 + 1]! * cell;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = '#5f646d';
      ctx.fill();
      ctx.strokeStyle = '#2f3339';
      ctx.lineWidth = Math.max(1, cell * 0.04);
      ctx.stroke();
      // Highlight facet.
      ctx.beginPath();
      ctx.moveTo(x + rk.pts[0]! * cell * 0.6, y + rk.pts[1]! * cell * 0.6);
      ctx.lineTo(x + rk.pts[4]! * cell * 0.6, y + rk.pts[5]! * cell * 0.6);
      ctx.lineTo(x + rk.pts[8]! * cell * 0.55, y + rk.pts[9]! * cell * 0.55);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();
    }

    const me = state.ships.find((s) => s.id === myShipId);
    const mySide = me ? me.side : 0;

    // ---- Planned path preview ----
    if (state.phase === 'orders' && preview && me && !me.sunk) {
      let q = me.cell.q, r = me.cell.r, h = me.heading;
      const free = (cq: number, cr: number): boolean => inBounds(cq, cr) && !rockSet.has(`${cq},${cr}`);
      ctx.save();
      ctx.setLineDash(ROUTE_DASH);
      ctx.strokeStyle = 'rgba(240,217,168,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px(q), py(r));
      const ghosts: { q: number; r: number; h: number; seg: number; moved: boolean }[] = [];
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const tok = preview.moves[seg] ?? null;
        let moved = false;
        if (tok) {
          const d = dirOf(h);
          if (free(q + d.q, r + d.r)) { q += d.q; r += d.r; moved = true; ctx.lineTo(px(q), py(r)); }
          if (tok === 'L' || tok === 'R') {
            h = tok === 'L' ? (h + 3) % 4 : (h + 1) % 4;
            const d2 = dirOf(h);
            if (free(q + d2.q, r + d2.r)) { q += d2.q; r += d2.r; moved = true; ctx.lineTo(px(q), py(r)); }
          }
        }
        ghosts.push({ q, r, h, seg, moved: moved || !!tok });
      }
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      // Shot lanes.
      for (const g of ghosts) {
        const so = preview.shots[g.seg];
        if (!so) continue;
        for (let side = 0; side < 2; side++) {
          if (!(side === 0 ? so.port : so.starboard)) continue;
          const dir = dirOf(side === 0 ? g.h + 3 : g.h + 1);
          let eq = g.q, er = g.r, n = 0;
          for (let i = 0; i < CANNON_RANGE; i++) {
            const nq = eq + dir.q, nr = er + dir.r;
            if (!free(nq, nr)) break;
            eq = nq; er = nr; n++;
          }
          ctx.strokeStyle = 'rgba(229,72,77,0.45)';
          ctx.fillStyle = 'rgba(229,72,77,0.55)';
          ctx.lineWidth = Math.max(2, cell * 0.08);
          const sx = px(g.q) + dir.q * cell * 0.3;
          const sy = py(g.r) + dir.r * cell * 0.3;
          if (n > 0) drawArrow(ctx, sx, sy, px(eq) - dir.q * cell * 0.15, py(er) - dir.r * cell * 0.15, cell * 0.22);
          else {
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + dir.q * cell * 0.2, sy + dir.r * cell * 0.2);
            ctx.stroke();
          }
        }
      }
      // Ghost ships + segment numbers.
      for (const g of ghosts) {
        if (!g.moved) continue;
        drawShip(ctx, px(g.q), py(g.r), cell, (g.h * Math.PI) / 2, me.sprite, true, 0.55, 0, true);
        outlinedText(ctx, String(g.seg + 1), px(g.q) + cell * 0.32, py(g.r) - cell * 0.3, `bold ${Math.max(9, cell * 0.26)}px ${UI_FONT}`, '#f0d9a8', 'rgba(0,0,0,0.75)');
      }
      ctx.restore();
    }

    // ---- Grapple rope (under ships) ----
    if (animating) {
      for (const a of timeline.anims) {
        if (a.start > t) break;
        if (a.ev.kind !== 'grapple') continue;
        const A = disp.get(a.ev.shipId);
        const Bd = a.ev.targetId ? disp.get(a.ev.targetId) : undefined;
        if (!A || !Bd) continue;
        const p = clamp((t - a.start) / a.dur, 0, 1);
        const ax = px(A.x), ay = py(A.y), bx = px(Bd.x), by = py(Bd.y);
        const reach = clamp(p * 3, 0, 1);
        const ex = lerp(ax, bx, reach), ey = lerp(ay, by, reach);
        ctx.save();
        ctx.setLineDash(ROPE_DASH);
        ctx.lineDashOffset = -now * 0.02;
        ctx.strokeStyle = '#c89b3c';
        ctx.lineWidth = Math.max(2, cell * 0.06);
        ctx.beginPath();
        ctx.moveTo(ax - 3, ay - 3); ctx.lineTo(ex - 3, ey - 3);
        ctx.moveTo(ax + 3, ay + 3); ctx.lineTo(ex + 3, ey + 3);
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
        ctx.restore();
        if (reach >= 1) {
          const pulse = 0.7 + 0.3 * Math.sin(now * 0.01);
          outlinedText(ctx, 'Grapple!', (ax + bx) / 2, (ay + by) / 2 - cell * 0.55, `${Math.max(14, cell * 0.5)}px ${DISPLAY_FONT}`, `rgba(240,199,106,${pulse.toFixed(2)})`, 'rgba(0,0,0,0.8)');
        }
      }
    }

    // ---- Ships (wrecks, then enemies, then mine) ----
    const drawShipAt = (s: BattleShip): void => {
      const d = disp.get(s.id);
      if (!d) return;
      const x = px(d.x);
      const y = py(d.y);
      if (d.sunk && d.alpha <= 0.02) {
        drawWreck(ctx, x, y, cell, now, hash01(s.cell.q, s.cell.r, 3) * 3);
        outlinedText(ctx, s.name, x, Math.max(oy + 8, y - cell * 0.62), `bold ${Math.max(9, cell * 0.24)}px ${UI_FONT}`, 'rgba(245,234,210,0.55)', 'rgba(0,0,0,0.6)');
        return;
      }
      const sh = d.shake > 0 ? Math.sin(now * 0.09) * d.shake * cell * 0.12 : 0;
      const sv = d.shake > 0 ? Math.cos(now * 0.11) * d.shake * cell * 0.08 : 0;
      drawShip(ctx, x + sh, y + sv, cell, (d.heading * Math.PI) / 2, s.sprite, s.side === mySide, d.alpha, d.flash, false);
      // Hull bar + name.
      const bw = cell * 0.8;
      const bh = Math.max(3, cell * 0.09);
      const by = Math.max(oy + 14, y - cell * 0.6);
      const ratio = clamp(d.hull / Math.max(1, s.maxHull), 0, 1);
      ctx.save();
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = ratio > 0.5 ? '#3fb950' : ratio > 0.25 ? '#f5a524' : '#e5484d';
      ctx.fillRect(x - bw / 2, by, bw * ratio, bh);
      if (d.flash > 0) { ctx.globalAlpha = d.alpha * d.flash; ctx.fillStyle = '#ff8a8e'; ctx.fillRect(x - bw / 2, by, bw, bh); }
      ctx.restore();
      outlinedText(ctx, s.name, x, by - Math.max(7, cell * 0.16), `bold ${Math.max(9, cell * 0.24)}px ${UI_FONT}`, s.side === mySide ? '#f0d9a8' : '#ffb3b3', 'rgba(0,0,0,0.75)');
      // Lower the global alpha if sinking.
    };
    for (const s of state.ships) { const d = disp.get(s.id); if (d && d.sunk && d.alpha <= 0.02) drawShipAt(s); }
    for (const s of state.ships) { const d = disp.get(s.id); if (d && !(d.sunk && d.alpha <= 0.02) && s.side !== mySide) drawShipAt(s); }
    for (const s of state.ships) { const d = disp.get(s.id); if (d && !(d.sunk && d.alpha <= 0.02) && s.side === mySide) drawShipAt(s); }

    // ---- Effects (cannonballs, splashes, floating damage) ----
    if (animating) {
      const dmgFont = `bold ${Math.max(11, cell * 0.36)}px ${UI_FONT}`;
      for (const a of timeline.anims) {
        if (a.start > t) break;
        const age = t - a.start;
        const p = clamp(age / a.dur, 0, 1);
        const ev = a.ev;
        switch (ev.kind) {
          case 'shot': {
            // Muzzle puff.
            const dir = dirOf(ev.heading ?? 0);
            const mx = px(a.shotFromQ) + dir.q * cell * 0.32;
            const my = py(a.shotFromR) + dir.r * cell * 0.32;
            if (age < 260) {
              const k = age / 260;
              ctx.save();
              ctx.globalAlpha = 0.65 * (1 - k);
              ctx.fillStyle = k < 0.25 ? '#ffd27a' : '#d9d9d9';
              ctx.beginPath();
              ctx.arc(mx + dir.q * cell * 0.2 * k, my + dir.r * cell * 0.2 * k, cell * (0.08 + 0.22 * k), 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
            if (p < 1) {
              const bx = lerp(px(a.shotFromQ), px(a.shotToQ), p);
              const bby = lerp(py(a.shotFromR), py(a.shotToR), p);
              const arc = Math.sin(p * Math.PI) * cell * 0.18;
              ctx.save();
              ctx.fillStyle = 'rgba(0,0,0,0.3)';
              ctx.beginPath();
              ctx.arc(bx, bby + 3, cell * 0.08, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#15171c';
              ctx.beginPath();
              ctx.arc(bx, bby - arc, cell * 0.09, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.45)';
              ctx.beginPath();
              ctx.arc(bx - cell * 0.03, bby - arc - cell * 0.03, cell * 0.03, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
            break;
          }
          case 'hit': {
            if (p >= 1) break;
            const x = px(a.splashQ), y = py(a.splashR);
            drawSplash(ctx, x, y, cell, p, true);
            if (ev.dmg) {
              ctx.save();
              ctx.globalAlpha = 1 - p * p;
              outlinedText(ctx, `-${ev.dmg}`, x, y - cell * 0.35 - easeOut(p) * cell * 0.6, dmgFont, '#ff8a8e', 'rgba(0,0,0,0.85)');
              ctx.restore();
            }
            break;
          }
          case 'miss': {
            if (p >= 1) break;
            drawSplash(ctx, px(a.splashQ), py(a.splashR), cell, p, false);
            break;
          }
          case 'ram': case 'rock': {
            if (p >= 1) break;
            const d = disp.get(ev.shipId);
            if (!d) break;
            const x = px(d.x), y = py(d.y);
            if (p < 0.6) drawSplash(ctx, x, y, cell, p / 0.6, ev.kind === 'ram');
            if (ev.dmg) {
              ctx.save();
              ctx.globalAlpha = 1 - p * p;
              outlinedText(ctx, `-${ev.dmg}`, x, y - cell * 0.35 - easeOut(p) * cell * 0.6, dmgFont, ev.kind === 'rock' ? '#d9d9d9' : '#ffb347', 'rgba(0,0,0,0.85)');
              ctx.restore();
            }
            break;
          }
          case 'sunk': {
            if (p >= 1) break;
            const d = disp.get(ev.shipId);
            if (!d) break;
            drawSplash(ctx, px(d.x), py(d.y), cell, p, false);
            break;
          }
          default: break;
        }
      }
      // Segment pips.
      const seg = Math.min(SEGMENTS, Math.floor(t / SEG_MS) + 1);
      const pipR = Math.max(3, cell * 0.1);
      for (let i = 0; i < SEGMENTS; i++) {
        ctx.beginPath();
        ctx.arc(ox + 12 + i * pipR * 3, oy + 12, pipR, 0, Math.PI * 2);
        ctx.fillStyle = i < seg ? '#f0c76a' : 'rgba(0,0,0,0.4)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(240,217,168,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      outlinedText(ctx, t < SEGMENTS * SEG_MS ? `Segment ${seg}` : 'Resolved', ox + 12 + SEGMENTS * pipR * 3 + 4, oy + 12, `bold ${Math.max(10, cell * 0.26)}px ${UI_FONT}`, '#f0d9a8', 'rgba(0,0,0,0.75)', 'left');
    }

    // ---- Compass + frame ----
    drawCompass(ctx, ox + boardW - cell * 0.85, oy + boardH - cell * 0.95, cell * 0.55);
    ctx.strokeStyle = 'rgba(240,217,168,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox - 1, oy - 1, boardW + 2, boardH + 2);
  }, [state, myShipId, width, height, now, preview, timeline, rockShapes, rockSet, eventsKey]);

  return <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }} />;
}
