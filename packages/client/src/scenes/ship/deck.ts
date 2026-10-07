import type { PuzzleId, ShipTypeId } from '@tidebound/shared';
import { roundRect } from '../../lib/canvas';

export interface StationSpot { id: PuzzleId; x: number; y: number; label: string }

/** Deck geometry in deck-local coordinates: the hull is centred at (0,0), bow at -y. */
export function deckSpec(type: ShipTypeId): { length: number; width: number; masts: number[]; stations: StationSpot[] } {
  const length = { sloop: 420, cutter: 480, brig: 560, frigate: 640 }[type];
  const width = { sloop: 170, cutter: 190, brig: 220, frigate: 250 }[type];
  const masts = { sloop: [-30], cutter: [-70, 70], brig: [-110, 60], frigate: [-150, 0, 150] }[type];
  const l = length / 2, w = width / 2;
  const stations: StationSpot[] = [
    { id: 'navigation', x: 0, y: l - 70, label: 'Helm' },
    { id: 'sailing', x: 0, y: masts[0]! + 50, label: 'Sails' },
    { id: 'gunnery', x: -w + 42, y: 0, label: 'Guns' },
    { id: 'carpentry', x: w - 42, y: 20, label: 'Carpentry' },
    { id: 'bilging', x: 0, y: -l + 110, label: 'Bilge' },
  ];
  return { length, width, masts, stations };
}

/** Draws the hull/deck in deck-local coords. */
export function drawHull(ctx: CanvasRenderingContext2D, type: ShipTypeId, t: number, sailPower: number, damage: number): void {
  const { length, width, masts } = deckSpec(type);
  const l = length / 2, w = width / 2;
  // hull outline (pointed bow at -y, flat-ish stern at +y)
  const hull = () => {
    ctx.beginPath();
    ctx.moveTo(0, -l - 30);
    ctx.quadraticCurveTo(w * 1.15, -l * 0.5, w, l * 0.65);
    ctx.quadraticCurveTo(w, l + 10, w * 0.8, l + 10);
    ctx.lineTo(-w * 0.8, l + 10);
    ctx.quadraticCurveTo(-w, l + 10, -w, l * 0.65);
    ctx.quadraticCurveTo(-w * 1.15, -l * 0.5, 0, -l - 30);
    ctx.closePath();
  };
  // shadow on water
  ctx.save();
  ctx.translate(8, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  hull(); ctx.fill();
  ctx.restore();
  // hull sides (dark)
  ctx.fillStyle = '#3d2412';
  hull(); ctx.fill();
  // deck planks (clipped)
  ctx.save();
  hull(); ctx.clip();
  const inset = 14;
  ctx.fillStyle = '#9a6a3f';
  ctx.fillRect(-w + inset, -l - 10, (w - inset) * 2, l * 2 + 20);
  for (let i = 0; i < 14; i++) {
    const x = -w + inset + (i / 14) * (w - inset) * 2;
    ctx.fillStyle = i % 2 ? '#a9784a' : '#8f6038';
    ctx.fillRect(x, -l - 30, ((w - inset) * 2) / 14, l * 2 + 60);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  for (let y = -l; y < l; y += 26) {
    ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // damage: dark splintered patches
  const n = Math.min(8, Math.floor(damage * 8));
  for (let i = 0; i < n; i++) {
    const px = Math.sin(i * 12.9) * w * 0.7, py = Math.cos(i * 7.3) * l * 0.8;
    ctx.fillStyle = 'rgba(20,10,4,0.75)';
    ctx.beginPath(); ctx.ellipse(px, py, 16, 10, i, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // rail
  ctx.strokeStyle = '#2a1d0f';
  ctx.lineWidth = 6;
  hull(); ctx.stroke();
  ctx.strokeStyle = '#c89b3c';
  ctx.lineWidth = 1.5;
  hull(); ctx.stroke();
  // hatches & cannons
  ctx.fillStyle = '#2a1d0f';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -l * 0.5 + i * (l * 0.5);
      roundRect(ctx, side * (w - 24) - 8, y - 6, 16, 12, 2);
      ctx.fill();
      ctx.fillRect(side * (w - 12) - 2, y - 2, side * 14, 4);
    }
  }
  // masts with sails
  for (const my of masts) {
    const billow = 10 + sailPower * 26 + Math.sin(t / 700 + my) * 2;
    ctx.fillStyle = 'rgba(240,217,168,0.92)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.75, my);
    ctx.quadraticCurveTo(0, my + billow, w * 0.75, my);
    ctx.quadraticCurveTo(0, my + billow * 0.35, -w * 0.75, my);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w * 0.75, my); ctx.lineTo(w * 0.75, my); ctx.stroke();
    ctx.fillStyle = '#4a2f12';
    ctx.beginPath(); ctx.arc(0, my, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c89b3c';
    ctx.beginPath(); ctx.arc(0, my, 3, 0, Math.PI * 2); ctx.fill();
  }
  // helm wheel
  ctx.save();
  ctx.translate(0, l - 42);
  ctx.rotate(t / 1500);
  ctx.strokeStyle = '#4a2f12'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); ctx.stroke(); }
  ctx.restore();
  // bow lantern
  ctx.fillStyle = `rgba(255,200,90,${0.5 + Math.sin(t / 300) * 0.15})`;
  ctx.beginPath(); ctx.arc(0, -l - 8, 6, 0, Math.PI * 2); ctx.fill();
}

export function drawStationMarker(ctx: CanvasRenderingContext2D, s: StationSpot, state: 'free' | 'mine' | 'taken', pulse: number, icon: string): void {
  ctx.save();
  ctx.translate(s.x, s.y);
  const r = 30 + (state === 'free' ? Math.sin(pulse) * 2 : 0);
  ctx.fillStyle = state === 'mine' ? 'rgba(63,185,80,0.35)' : state === 'taken' ? 'rgba(0,0,0,0.25)' : 'rgba(240,199,106,0.28)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = state === 'mine' ? '#8ff0a0' : state === 'taken' ? 'rgba(255,255,255,0.3)' : '#f0c76a';
  ctx.lineWidth = 2;
  ctx.setLineDash(state === 'free' ? [6, 5] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '22px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, 0, -2);
  ctx.font = '700 12px Nunito';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeText(s.label, 0, r + 12);
  ctx.fillText(s.label, 0, r + 12);
  ctx.restore();
}
