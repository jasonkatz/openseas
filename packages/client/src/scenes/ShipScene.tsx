import { useEffect, useRef, useState } from 'react';
import type { PuzzleId } from '@tidebound/shared';
import { ISLAND_BY_ID, SHIP_TYPES, STATIONS, STATION_INFO, ratingLabel } from '@tidebound/shared';
import { useStore } from '../store';
import { fitCanvas } from '../lib/canvas';
import { drawPirate } from '../lib/avatar';
import { play } from '../lib/audio';
import { deckSpec, drawHull, drawStationMarker } from './ship/deck';
import { ShipPanel } from './ship/ShipPanel';
import { BattlePanel } from './battle/BattlePanel';

/** The deck of the ship you are aboard: stations, crew, and the sea around. */
export function ShipScene() {
  const room = useStore((s) => s.room);
  const pirate = useStore((s) => s.pirate);
  const battle = useStore((s) => s.battle);
  const battleEnd = useStore((s) => s.battleEnd);
  const puzzle = useStore((s) => s.puzzle);
  const send = useStore((s) => s.send);
  const startPuzzle = useStore((s) => s.startPuzzle);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<PuzzleId | null>(null);
  const [battleOpen, setBattleOpen] = useState(true);
  const stateRef = useRef({ room, pirate, hover });
  stateRef.current = { room, pirate, hover };

  // Open the battle panel whenever a new battle starts.
  const battleId = battle?.id ?? null;
  useEffect(() => { if (battleId) { setBattleOpen(true); play('cannon'); } }, [battleId]);

  const ship = room?.kind === 'ship' ? room.ship : null;

  // Deck transform: hull centred, scaled to fit.
  const layout = (w: number, h: number) => {
    if (!ship) return { cx: w / 2, cy: h / 2, scale: 1 };
    const spec = deckSpec(ship.type);
    const avail = Math.min(w - 420, w * 0.72);
    const scale = Math.min(1.1, (h - 120) / (spec.length + 120), avail / (spec.width + 160));
    return { cx: Math.max(avail / 2 + 20, (w - 380) / 2), cy: h / 2 + 10, scale: Math.max(0.5, scale) };
  };

  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current, host = hostRef.current;
      const { room, pirate, hover } = stateRef.current;
      if (!c || !host || room?.kind !== 'ship' || !pirate) return;
      const ship = room.ship;
      const w = host.clientWidth, h = host.clientHeight;
      const ctx = fitCanvas(c, w, h);
      const sailing = ship.status.kind === 'sailing' || ship.status.kind === 'battle';
      // sea
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1b5f8f'); g.addColorStop(1, '#0f3a5c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      const speed = sailing ? t / 9 : t / 40;
      for (let i = 0; i < 26; i++) {
        const y = ((i * 53 + speed) % (h + 60)) - 30;
        const x0 = (i * 173) % w;
        ctx.beginPath();
        for (let x = 0; x <= 120; x += 10) ctx.lineTo(x0 + x, y + Math.sin((x + t / 200) / 15) * 3);
        ctx.stroke();
      }
      const { cx, cy, scale } = layout(w, h);
      ctx.save();
      ctx.translate(cx, cy + Math.sin(t / 900) * 3);
      ctx.scale(scale, scale);
      ctx.rotate(Math.sin(t / 1300) * 0.01);
      // wake
      if (sailing) {
        const spec = deckSpec(ship.type);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 6;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(s * spec.width * 0.45, spec.length * 0.55);
          ctx.lineTo(s * spec.width * 1.3, spec.length * 1.2 + ((t / 10) % 40));
          ctx.stroke();
        }
      }
      const type = SHIP_TYPES[ship.type];
      drawHull(ctx, ship.type, t, ship.stats.sailPower, ship.stats.damage / type.hull);
      // bilge water sloshing over the deck when high
      if (ship.stats.bilge > 40) {
        const spec = deckSpec(ship.type);
        ctx.fillStyle = `rgba(58,143,199,${(ship.stats.bilge - 40) / 150})`;
        ctx.fillRect(-spec.width / 2 + 16, -spec.length / 2 + 30 + Math.sin(t / 400) * 4, spec.width - 32, spec.length - 60);
      }
      const spec = deckSpec(ship.type);
      for (const st of spec.stations) {
        const who = ship.stations[st.id];
        const state = who === pirate.id ? 'mine' : who ? 'taken' : 'free';
        drawStationMarker(ctx, st, state, t / 300 + (hover === st.id ? 1 : 0), STATION_INFO[st.id].icon);
        if (hover === st.id && state !== 'taken') {
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(st.x, st.y, 34, 0, Math.PI * 2); ctx.stroke();
        }
      }
      // crew
      const idle = ship.aboardPirates.filter((p) => !STATIONS.some((s) => ship.stations[s] === p.id));
      ship.aboardPirates.forEach((p) => {
        const st = spec.stations.find((s) => ship.stations[s.id] === p.id);
        let x: number, y: number;
        if (st) { x = st.x; y = st.y + 26; }
        else {
          const i = idle.indexOf(p);
          x = -spec.width * 0.3 + (i % 4) * (spec.width * 0.2);
          y = spec.length * 0.15 + Math.floor(i / 4) * 50;
        }
        const walk = st ? ((t / 500) % 1) * 0.3 : 0;
        drawPirate(ctx, x, y, 52, p.avatar, 2, walk, { outline: p.id === pirate.id ? '#8ff0a0' : undefined });
        ctx.font = '700 11px Nunito'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
        ctx.strokeText(p.name, x, y - 62); ctx.fillText(p.name, x, y - 62);
        const duty = ship.duty[p.id];
        if (duty !== undefined && st) {
          ctx.fillStyle = duty >= 0.7 ? '#8ff0a0' : duty >= 0.4 ? '#f0c76a' : '#ff8a8e';
          ctx.font = '700 10px Nunito';
          ctx.fillText(ratingLabel(duty), x, y - 50);
        }
      });
      ctx.restore();
      // name plate
      ctx.font = '700 13px Nunito'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(240,217,168,0.9)';
      ctx.fillText(`${ship.name} · ${type.name}`, 14, h - 16);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stationAt = (ev: React.MouseEvent<HTMLCanvasElement>): PuzzleId | null => {
    if (!ship) return null;
    const host = hostRef.current!;
    const { cx, cy, scale } = layout(host.clientWidth, host.clientHeight);
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = (ev.clientX - rect.left - cx) / scale, y = (ev.clientY - rect.top - cy) / scale;
    for (const st of deckSpec(ship.type).stations) if (Math.hypot(st.x - x, st.y - y) < 34) return st.id;
    return null;
  };

  const takeStation = (id: PuzzleId) => {
    if (!ship || !pirate) return;
    const who = ship.stations[id];
    if (who && who !== pirate.id) return;
    play('tap');
    if (id === 'swordfight') return;
    send({ t: 'takeStation', station: id });
    // Start the duty puzzle right away (server validates the station assignment first).
    setTimeout(() => startPuzzle(id, false), 120);
  };

  if (!ship || !pirate) return null;
  const showBattle = (battle || battleEnd) && battleOpen;
  return (
    <div className="scene" ref={hostRef}>
      <canvas ref={canvasRef} onMouseMove={(e) => setHover(stationAt(e))} onClick={(e) => { const s = stationAt(e); if (s) takeStation(s); }} style={{ cursor: hover ? 'pointer' : 'default' }} />
      <ShipPanel onTakeStation={takeStation} />
      {(battle || battleEnd) && !showBattle && (
        <div className="prompt" style={{ bottom: 'auto', top: 60, zIndex: 36 }}>
          ⚔️ {battle ? `Battle · turn ${battle.turn} · ${battle.phase}` : 'Battle over'} <button className="btn small" onClick={() => setBattleOpen(true)}>Show</button>
        </div>
      )}
      {showBattle && (
        <div className="modal-backdrop" style={{ zIndex: puzzle ? 35 : 28, padding: 12, alignItems: 'stretch' }}>
          <div className="panel" style={{ width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="panel-head">
              <h2>⚔️ Sea battle</h2>
              <span className="muted">Keep working your station — the puzzles still drive the ship.</span>
              <button className="btn ghost small x" onClick={() => setBattleOpen(false)}>Hide ▾</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: 10 }}>
              <BattlePanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { ISLAND_BY_ID };
