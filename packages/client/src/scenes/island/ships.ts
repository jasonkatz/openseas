import type { Ship } from '@tidebound/shared';
import { SHIP_TYPES } from '@tidebound/shared';
import { outlinedText, roundRect } from '../../lib/canvas';

const HULL_LEN: Record<Ship['type'], number> = { sloop: 84, cutter: 96, brig: 114, frigate: 134 };
const MASTS: Record<Ship['type'], number> = { sloop: 1, cutter: 1, brig: 2, frigate: 3 };

/** X positions for `n` ships moored along the quay, centred, never closer than the hull allows. */
export function shipSlotX(i: number, n: number, x0: number, x1: number): number {
  if (n <= 1) return (x0 + x1) / 2;
  const span = x1 - x0;
  const spacing = Math.min(170, span / (n - 1));
  const start = (x0 + x1) / 2 - (spacing * (n - 1)) / 2;
  return start + i * spacing;
}

/** A small side-view ship moored at (x, y) = midship at the waterline, bow to the left. */
export function drawDockedShip(ctx: CanvasRenderingContext2D, ship: Ship, x: number, y: number, now: number, index: number, localPirateId: string | null): void {
  const type = SHIP_TYPES[ship.type];
  const L = HULL_LEN[ship.type];
  const half = L / 2;
  const bob = Math.sin(now / 1100 + index * 1.7) * 1.6;
  const roll = Math.sin(now / 1600 + index) * 0.018;
  const navy = ship.ownerId === 'navy';
  const flag = navy ? '#2f81f7' : ship.ownerId === localPirateId ? '#3fb950' : '#e5484d';
  const hull = navy ? '#5a4330' : '#6b3f22';
  const strake = navy ? '#f0d9a8' : '#c89b3c';
  const mastH = 36 + type.maxCrew * 0.9;

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(roll);

  // Reflection (squashed, faint) below the waterline.
  ctx.save();
  ctx.scale(1, -0.45);
  ctx.globalAlpha = 0.18;
  hullPath(ctx, half);
  ctx.fillStyle = hull; ctx.fill();
  ctx.restore();

  // Hull.
  hullPath(ctx, half);
  ctx.fillStyle = hull; ctx.fill();
  ctx.strokeStyle = '#2a1d0f'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = strake; ctx.fillRect(-half + 8, -9, L - 14, 2.5);
  // Gun ports.
  ctx.fillStyle = '#1b1b1b';
  for (let g = 0; g < type.cannons; g++) ctx.fillRect(-half + 18 + g * ((L - 40) / Math.max(1, type.cannons - 1)) - 2, -5, 5, 4);
  // Deck line + rail.
  ctx.fillStyle = '#9a6a3f'; ctx.fillRect(-half + 4, -14, L - 6, 3);
  ctx.fillStyle = '#4a2f12'; ctx.fillRect(-half + 4, -17, L - 6, 2);
  // Bowsprit.
  ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-half + 2, -14); ctx.lineTo(-half - 18, -24); ctx.stroke();
  ctx.strokeStyle = 'rgba(240,217,168,0.7)'; ctx.lineWidth = 1;
  // Masts with furled sails and a pennant.
  const n = MASTS[ship.type];
  for (let m = 0; m < n; m++) {
    const mx = n === 1 ? 4 : -half * 0.55 + (m * (L * 0.55)) / (n - 1);
    const h = mastH * (n > 1 && m === n - 1 ? 0.85 : 1);
    ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(mx, -14); ctx.lineTo(mx, -14 - h); ctx.stroke();
    // Yards + furled canvas.
    for (let yd = 0; yd < (ship.type === 'frigate' ? 2 : 1); yd++) {
      const yy = -14 - h * (0.72 - yd * 0.28);
      const yw = 14 + L * 0.12;
      ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx - yw, yy); ctx.lineTo(mx + yw, yy); ctx.stroke();
      ctx.fillStyle = '#efe6d2'; roundRect(ctx, mx - yw + 2, yy - 4, yw * 2 - 4, 7, 3.5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); for (let t = -yw + 8; t < yw - 4; t += 8) { ctx.moveTo(mx + t, yy - 4); ctx.lineTo(mx + t + 2, yy + 3); } ctx.stroke();
    }
    // Rigging.
    ctx.strokeStyle = 'rgba(240,217,168,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, -14 - h); ctx.lineTo(-half + 6, -15); ctx.moveTo(mx, -14 - h); ctx.lineTo(half - 8, -15); ctx.stroke();
    // Pennant on the tallest mast.
    if (m === 0) {
      const wave = Math.sin(now / 200 + index) * 2;
      ctx.fillStyle = flag;
      ctx.beginPath(); ctx.moveTo(mx, -14 - h); ctx.lineTo(mx + 16, -14 - h + 3 + wave); ctx.lineTo(mx, -14 - h + 7); ctx.closePath(); ctx.fill();
    }
  }
  // Stern lantern.
  ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(half - 4, -19, 2.5, 0, Math.PI * 2); ctx.fill();
  // Mooring line to the quay.
  ctx.strokeStyle = '#c9a46a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(half - 10, -15); ctx.quadraticCurveTo(half + 8, -22, half + 14, -38 - bob); ctx.stroke();
  ctx.restore();

  // Label above the rig.
  const labelY = y - 14 - mastH - 16;
  outlinedText(ctx, ship.name, x, labelY, "bold 13px 'Nunito', sans-serif", '#f5ead2', 'rgba(10,20,30,0.8)');
  outlinedText(ctx, navy ? `Navy ${type.name}` : type.name, x, labelY + 13, "600 10px 'Nunito', sans-serif", navy ? '#8dc0ff' : '#f0c76a', 'rgba(10,20,30,0.8)');
}

function hullPath(ctx: CanvasRenderingContext2D, half: number): void {
  ctx.beginPath();
  ctx.moveTo(-half - 4, -14);
  ctx.lineTo(half, -16);
  ctx.quadraticCurveTo(half + 6, -4, half - 6, 6);
  ctx.lineTo(-half + 14, 8);
  ctx.quadraticCurveTo(-half - 2, 4, -half - 4, -14);
  ctx.closePath();
}
