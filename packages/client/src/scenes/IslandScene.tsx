import { useEffect, useRef, useState } from 'react';
import type { Building, BuildingKind, Island, PresenceEntry } from '@tidebound/shared';
import { ISLAND_BY_ID } from '@tidebound/shared';
import { useStore } from '../store';
import { fitCanvas, outlinedText, roundRect } from '../lib/canvas';
import { drawPirate } from '../lib/avatar';
import { play } from '../lib/audio';
import { buildTerrain, drawTerrainOverlay } from './island/terrain';
import { DOOR_RANGE, drawBuilding } from './island/buildings';
import { drawDockedShip, shipSlotX } from './island/ships';
import { canStand, inRect, makeWalkable, slideMove, type Pt } from './island/geometry';
import { BuildingPanel } from '../ui/buildings/BuildingPanel';

const SPEED = 220;          // px/s
const SEND_MS = 100;        // 10 Hz presence
const PIRATE_H = 56;
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const EMOTE_ICONS: Record<string, string> = { wave: '👋', dance: '💃', cheer: '🎉', bow: '🙇', arr: '🏴‍☠️' };

interface Remote { x: number; y: number; tx: number; ty: number; walk: number; moving: boolean }
interface DrawItem { y: number; b: Building | null; p: PresenceEntry | null; r: Remote | null; local: boolean }

/** The island overworld: a scrolling canvas you walk around, plus the building modals. */
export function IslandScene() {
  const islandId = useStore((s) => (s.room?.kind === 'island' ? s.room.islandId : null));
  const island = islandId ? ISLAND_BY_ID[islandId] : undefined;
  if (!island) return <div className="scene" />;
  // Keyed so all per-island state (terrain cache, position) resets on arrival at a new island.
  return <IslandView key={island.id} island={island} />;
}

function IslandView({ island }: { island: Island }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openBuilding = useStore((s) => s.openBuilding);
  const setOpenBuilding = useStore((s) => s.setOpenBuilding);
  const [near, setNear] = useState<Building | null>(null);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;

    const walk = makeWalkable(island);
    const res = Math.min(2, window.devicePixelRatio || 1);
    const terrain = buildTerrain(island, res);
    const store = useStore;

    // ---- local pirate (authoritative for our own rendering; zero latency) ----
    const me = store.getState().pirate;
    const local = { x: island.spawn.x, y: island.spawn.y, facing: 2, moving: false, walk: 0, target: null as Pt | null, targetKind: null as BuildingKind | null, stuckMs: 0 };
    if (me?.location.kind === 'island' && me.location.islandId === island.id && canStand(walk, me.location.x, me.location.y)) {
      local.x = me.location.x; local.y = me.location.y;
    }
    const keys = new Set<string>();
    const cam = { x: local.x, y: local.y };
    const size = { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
    const view = { x: 0, y: 0, w: 1, h: 1 };
    const remotes = new Map<string, Remote>();
    let lastPresence: PresenceEntry[] | null = null;
    let lastSend = 0, wasMoving = false;
    let nearB: Building | null = null;
    const pool: DrawItem[] = [];
    const list: DrawItem[] = [];
    const walkTarget: Pt = { x: 0, y: 0 };

    const scale = () => (size.w < 700 ? 0.75 : 1);
    const uiBusy = () => {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return true;
      if (document.querySelector('.puzzle-host')) return true;
      return store.getState().openBuilding !== null;
    };
    const sendPos = (moving: boolean) => {
      store.getState().send({ t: 'pos', x: Math.round(local.x), y: Math.round(local.y), facing: local.facing, moving });
      lastSend = performance.now();
    };
    const nearestDoor = (): Building | null => {
      let best: Building | null = null, bd = DOOR_RANGE;
      for (const b of island.buildings) {
        const d = Math.hypot(b.door.x - local.x, b.door.y - local.y);
        if (d <= bd) { bd = d; best = b; }
      }
      return best;
    };
    const stop = () => { local.target = null; local.targetKind = null; keys.clear(); };
    const enter = (kind: BuildingKind) => {
      stop();
      play('bell');
      store.getState().setOpenBuilding(kind);
    };
    const walkTo = (x: number, y: number, kind: BuildingKind | null) => {
      walkTarget.x = Math.max(8, Math.min(island.width - 8, x));
      walkTarget.y = Math.max(8, Math.min(island.height - 8, y));
      local.target = walkTarget; local.targetKind = kind; local.stuckMs = 0;
      keys.clear();
    };

    // ---- input ----
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (store.getState().openBuilding) store.getState().setOpenBuilding(null); return; }
      if (uiBusy() || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'e') { const b = nearestDoor(); if (b) enter(b.kind); e.preventDefault(); return; }
      if (MOVE_KEYS.has(k)) { keys.add(k); local.target = null; local.targetKind = null; e.preventDefault(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); };
    const onBlur = () => keys.clear();
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
      if (document.querySelector('.puzzle-host') || store.getState().openBuilding) return;
      const rect = canvas.getBoundingClientRect();
      const sc = scale();
      const wx = view.x + (e.clientX - rect.left) / sc, wy = view.y + (e.clientY - rect.top) / sc;
      for (const b of island.buildings) {
        if (inRect(b, wx, wy, 6) || Math.hypot(b.door.x - wx, b.door.y - wy) < 28) {
          play('tap');
          if (Math.hypot(b.door.x - local.x, b.door.y - local.y) <= DOOR_RANGE) enter(b.kind);
          else walkTo(b.door.x, b.door.y + 14, b.kind);
          return;
        }
      }
      walkTo(wx, wy, null);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    const ro = new ResizeObserver(() => { size.w = Math.max(1, host.clientWidth); size.h = Math.max(1, host.clientHeight); });
    ro.observe(host);

    // ---- frame loop ----
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      const S = store.getState();
      const busy = uiBusy();
      if (busy) keys.clear();

      // Movement: keys win over tap-to-walk.
      let vx = 0, vy = 0;
      if (keys.size) {
        vx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
        vy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      } else if (local.target && !busy) {
        const dx = local.target.x - local.x, dy = local.target.y - local.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) stop(); else { vx = dx / d; vy = dy / d; }
      }
      if (vx !== 0 || vy !== 0) {
        const len = Math.hypot(vx, vy);
        vx /= len; vy /= len;
        local.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0);
        const moved = slideMove(walk, local, vx * SPEED * dt, vy * SPEED * dt);
        if (!moved && local.target) { local.stuckMs += dt * 1000; if (local.stuckMs > 350) stop(); } else local.stuckMs = 0;
        local.moving = moved || keys.size > 0;
        local.walk = (local.walk + dt * 2.4) % 1;
      } else { local.moving = false; local.walk = 0; }
      if (local.targetKind) {
        const b = island.buildings.find((x) => x.kind === local.targetKind);
        if (b && Math.hypot(b.door.x - local.x, b.door.y - local.y) <= DOOR_RANGE - 12) enter(b.kind);
      }

      // Presence out: 10 Hz while moving, once on stop.
      if (local.moving && now - lastSend >= SEND_MS) sendPos(true);
      else if (!local.moving && wasMoving) sendPos(false);
      wasMoving = local.moving;

      // Door prompt.
      const nb = busy ? null : nearestDoor();
      if (nb !== nearB) { nearB = nb; setNear(nb); }

      // Remote pirates: lerp toward their last received position.
      const presence = S.presence;
      const myId = S.pirate?.id ?? null;
      if (presence !== lastPresence) {
        lastPresence = presence;
        for (const id of remotes.keys()) if (!presence.some((p) => p.id === id)) remotes.delete(id);
      }
      const k = 1 - Math.exp(-dt * 12);
      for (let i = 0; i < presence.length; i++) {
        const p = presence[i]!;
        if (p.id === myId) continue;
        let r = remotes.get(p.id);
        if (!r) { r = { x: p.x, y: p.y, tx: p.x, ty: p.y, walk: 0, moving: false }; remotes.set(p.id, r); }
        r.tx = p.x; r.ty = p.y;
        const dx = r.tx - r.x, dy = r.ty - r.y;
        r.x += dx * k; r.y += dy * k;
        r.moving = p.moving || Math.abs(dx) + Math.abs(dy) > 2;
        r.walk = r.moving ? (r.walk + dt * 2.4) % 1 : 0;
      }

      // Camera: smooth follow, clamped to the island.
      const sc = scale();
      const ck = 1 - Math.exp(-dt * 7);
      cam.x += (local.x - cam.x) * ck;
      cam.y += (local.y - cam.y) * ck;
      view.w = size.w / sc; view.h = size.h / sc;
      view.x = view.w >= island.width ? (island.width - view.w) / 2 : Math.max(0, Math.min(island.width - view.w, cam.x - view.w / 2));
      view.y = view.h >= island.height ? (island.height - view.h) / 2 : Math.max(0, Math.min(island.height - view.h, cam.y - view.h / 2));

      // ---- draw ----
      const ctx = fitCanvas(canvas, size.w, size.h);
      ctx.fillStyle = terrain.palette.seaDeep;
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.save();
      ctx.scale(sc, sc);
      ctx.translate(-view.x, -view.y);
      const ix0 = Math.max(view.x, 0), iy0 = Math.max(view.y, 0);
      const ix1 = Math.min(view.x + view.w, island.width), iy1 = Math.min(view.y + view.h, island.height);
      if (ix1 > ix0 && iy1 > iy0) {
        ctx.drawImage(terrain.canvas, ix0 * res, iy0 * res, (ix1 - ix0) * res, (iy1 - iy0) * res, ix0, iy0, ix1 - ix0, iy1 - iy0);
      }
      drawTerrainOverlay(ctx, terrain, now, view, island.biome);

      // Ships moored at the quay.
      const ships = S.ships;
      let n = 0;
      for (let i = 0; i < ships.length; i++) { const st = ships[i]!.status; if (st.kind === 'docked' && st.islandId === island.id) n++; }
      const row = terrain.pier.shipRow;
      for (let i = 0, j = 0; i < ships.length; i++) {
        const sh = ships[i]!;
        if (sh.status.kind !== 'docked' || sh.status.islandId !== island.id) continue;
        const sx = shipSlotX(j++, n, row.x0, row.x1);
        if (sx > view.x - 120 && sx < view.x + view.w + 120 && row.y > view.y - 20) drawDockedShip(ctx, sh, sx, row.y, now, i, myId);
      }

      // Depth-sorted buildings and pirates.
      list.length = 0;
      let pi = 0;
      const item = (): DrawItem => { let it = pool[pi]; if (!it) { it = { y: 0, b: null, p: null, r: null, local: false }; pool[pi] = it; } pi++; it.b = null; it.p = null; it.r = null; it.local = false; list.push(it); return it; };
      for (const b of island.buildings) { const it = item(); it.y = b.y + b.h; it.b = b; }
      for (let i = 0; i < presence.length; i++) {
        const p = presence[i]!;
        if (p.id === myId) continue;
        const r = remotes.get(p.id);
        if (!r) continue;
        if (r.x < view.x - 60 || r.x > view.x + view.w + 60 || r.y < view.y - 20 || r.y > view.y + view.h + 80) continue;
        const it = item(); it.y = r.y; it.p = p; it.r = r;
      }
      { const it = item(); it.y = local.y; it.local = true; }
      list.sort((a, b) => a.y - b.y);
      for (let i = 0; i < list.length; i++) {
        const it = list[i]!;
        if (it.b) drawBuilding(ctx, it.b, it.b === nearB, now);
        else if (it.local) {
          const pirate = S.pirate;
          if (pirate) drawPirateWithTag(ctx, local.x, local.y, pirate.avatar, local.facing, local.walk, pirate.name, S.crew?.name, selfEmote(presence, myId), true);
        } else if (it.p && it.r) {
          drawPirateWithTag(ctx, it.r.x, it.r.y, it.p.avatar, it.p.facing, it.r.walk, it.p.name, it.p.crewName, it.p.emote, false);
        }
      }
      // Walk-target marker.
      if (local.target && !local.targetKind) {
        const pulse = (now / 600) % 1;
        ctx.strokeStyle = `rgba(240,199,106,${0.9 - pulse * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(local.target.x, local.target.y, 6 + pulse * 14, 3 + pulse * 7, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [island]);

  return (
    <div className="scene" ref={hostRef}>
      <canvas ref={canvasRef} />
      {near && !openBuilding && (
        <div className="prompt" style={{ cursor: 'pointer' }} onClick={() => { play('bell'); setOpenBuilding(near.kind); }}>
          Enter <span style={{ color: 'var(--brass-light)' }}>{near.name}</span> — press <kbd>E</kbd>
        </div>
      )}
      <div className="pill muted" style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 22, fontSize: 12, pointerEvents: 'none', background: 'rgba(8,20,33,0.7)' }}>
        <kbd>WASD</kbd> walk · <kbd>E</kbd> enter · <kbd>Enter</kbd> chat
      </div>
      {openBuilding && <BuildingPanel />}
    </div>
  );
}

function selfEmote(presence: PresenceEntry[], myId: string | null): string | undefined {
  if (!myId) return undefined;
  for (let i = 0; i < presence.length; i++) { const p = presence[i]!; if (p.id === myId) return p.emote; }
  return undefined;
}

function drawPirateWithTag(ctx: CanvasRenderingContext2D, x: number, y: number, avatar: PresenceEntry['avatar'], facing: number, walk: number, name: string, crewName: string | undefined, emote: string | undefined, isMe: boolean): void {
  drawPirate(ctx, x, y, PIRATE_H, avatar, facing, walk, isMe ? { outline: 'rgba(240,199,106,0.85)' } : {});
  const top = y - PIRATE_H - 12;
  outlinedText(ctx, name, x, crewName ? top - 7 : top, "bold 12px 'Nunito', sans-serif", isMe ? '#ffe9a8' : '#f5ead2', 'rgba(8,20,33,0.85)');
  if (crewName) outlinedText(ctx, crewName, x, top + 5, "600 9px 'Nunito', sans-serif", '#8ff0a0', 'rgba(8,20,33,0.85)');
  if (emote) {
    const text = EMOTE_ICONS[emote] ?? emote;
    ctx.font = "bold 13px 'Nunito', sans-serif";
    const w = Math.max(28, ctx.measureText(text).width + 16);
    const by = top - 36;
    ctx.fillStyle = 'rgba(245,234,210,0.95)';
    roundRect(ctx, x - w / 2, by - 12, w, 24, 9); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 5, by + 11); ctx.lineTo(x, by + 18); ctx.lineTo(x + 5, by + 11); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a1d0f';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, by + 1);
  }
}
