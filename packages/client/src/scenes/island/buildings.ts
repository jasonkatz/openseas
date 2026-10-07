import type { Building, BuildingKind } from '@tidebound/shared';
import { outlinedText, roundRect } from '../../lib/canvas';

interface Look { roof: string; roofDark: string; wall: string; wallDark: string; trim: string; roofFrac: number }

const LOOKS: Record<BuildingKind, Look> = {
  tavern: { roof: '#a83232', roofDark: '#7a2222', wall: '#d2ad74', wallDark: '#a58552', trim: '#4a2f12', roofFrac: 0.5 },
  shipwright: { roof: '#75705f', roofDark: '#55513f', wall: '#8f6a42', wallDark: '#6b4c2b', trim: '#3b2a1a', roofFrac: 0.42 },
  market: { roof: '#8a6a3c', roofDark: '#6b4c2b', wall: '#e2cf9e', wallDark: '#bda87a', trim: '#5a3d22', roofFrac: 0.38 },
  bank: { roof: '#5a6b7a', roofDark: '#3f4d59', wall: '#c4bfb0', wallDark: '#9f998a', trim: '#4a4a4a', roofFrac: 0.45 },
  palace: { roof: '#3f5f8b', roofDark: '#2c4463', wall: '#e8dcc0', wallDark: '#c7b791', trim: '#6b4c2b', roofFrac: 0.55 },
  dock: { roof: '#2f6f9f', roofDark: '#1f4c70', wall: '#a07c52', wallDark: '#7c5c37', trim: '#3b2a1a', roofFrac: 0.45 },
};

export const DOOR_RANGE = 70;

/** Draws a building with its label; `near` adds the pulsing "you can enter" halo. */
export function drawBuilding(ctx: CanvasRenderingContext2D, b: Building, near: boolean, now: number): void {
  const L = LOOKS[b.kind];
  const { x, y, w, h } = b;
  const roofH = h * L.roofFrac;
  const wallY = y + roofH;
  const wallH = h - roofH;

  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, x + 8, y + 12, w, h, 6); ctx.fill();

  // Walls.
  ctx.fillStyle = L.wall;
  ctx.fillRect(x, wallY, w, wallH);
  ctx.fillStyle = L.wallDark;
  ctx.fillRect(x, y + h - 6, w, 6);
  ctx.strokeStyle = L.trim; ctx.lineWidth = 2;
  ctx.strokeRect(x, wallY, w, wallH);

  switch (b.kind) {
    case 'tavern': drawTavern(ctx, b, L, wallY, wallH, now); break;
    case 'shipwright': drawShipwright(ctx, b, L, wallY, wallH); break;
    case 'market': drawMarket(ctx, b, L, wallY, wallH); break;
    case 'bank': drawBank(ctx, b, L, wallY, wallH); break;
    case 'palace': drawPalace(ctx, b, L, wallY, wallH, now); break;
    case 'dock': drawDock(ctx, b, L, wallY, wallH, now); break;
  }

  // Roof (drawn after walls so eaves overlap them). Palace/bank get special roofs inside their draw fns.
  if (b.kind !== 'market') drawGableRoof(ctx, x, y, w, roofH, L, b.kind === 'shipwright');

  // Door.
  drawDoor(ctx, b.door.x, y + h, b.kind === 'palace' ? 36 : 26, b.kind === 'palace' ? 48 : 34, L.trim, near, now);

  // Entry halo.
  if (near) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 260);
    ctx.strokeStyle = `rgba(240,199,106,${0.35 + 0.4 * pulse})`;
    ctx.lineWidth = 3;
    roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 10); ctx.stroke();
    ctx.strokeStyle = `rgba(240,199,106,${0.15 * pulse})`;
    ctx.lineWidth = 10;
    roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 12); ctx.stroke();
  }

  // Label.
  outlinedText(ctx, b.name, x + w / 2, y - 14, "18px 'Pirata One', serif", near ? '#ffe9a8' : '#f0d9a8', 'rgba(20,12,4,0.85)');
}

function drawGableRoof(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, roofH: number, L: Look, shed: boolean): void {
  const eave = 7;
  const ridge = y + roofH * (shed ? 0.2 : 0.42);
  // Back slope (darker, foreshortened) and front slope.
  ctx.fillStyle = L.roofDark;
  roundRect(ctx, x - eave, y, w + eave * 2, ridge - y + 2, 4); ctx.fill();
  ctx.fillStyle = L.roof;
  ctx.fillRect(x - eave, ridge, w + eave * 2, y + roofH - ridge);
  // Tile courses.
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let ty = ridge + 9; ty < y + roofH; ty += 9) { ctx.moveTo(x - eave, ty); ctx.lineTo(x + w + eave, ty); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  for (let tx = x - eave + 11; tx < x + w + eave; tx += 22) { ctx.moveTo(tx, ridge); ctx.lineTo(tx, y + roofH); }
  ctx.stroke();
  // Ridge line + eave shadow.
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x - eave, ridge - 1, w + eave * 2, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - eave, y + roofH - 2, w + eave * 2, 3);
  // Chimney.
  ctx.fillStyle = '#6e6260'; ctx.fillRect(x + w - 34, y - 6, 12, roofH * 0.45);
  ctx.fillStyle = '#4e4442'; ctx.fillRect(x + w - 36, y - 8, 16, 4);
}

function drawDoor(ctx: CanvasRenderingContext2D, cx: number, bottom: number, dw: number, dh: number, trim: string, near: boolean, now: number): void {
  ctx.fillStyle = trim;
  roundRect(ctx, cx - dw / 2 - 2, bottom - dh - 2, dw + 4, dh + 2, dw / 2); ctx.fill();
  ctx.fillStyle = near ? `rgba(255,205,110,${0.75 + 0.25 * Math.sin(now / 200)})` : '#5a3d22';
  roundRect(ctx, cx - dw / 2, bottom - dh, dw, dh, dw / 2 - 1); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(cx - 1, bottom - dh + 6, 2, dh - 6);
  ctx.fillStyle = '#c89b3c';
  ctx.beginPath(); ctx.arc(cx + 4, bottom - dh * 0.45, 2, 0, Math.PI * 2); ctx.fill();
  // Step.
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(cx - dw / 2 - 6, bottom, dw + 12, 4);
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glow: number, trim: string): void {
  ctx.fillStyle = trim; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const r = Math.round(90 + 165 * glow), g = Math.round(130 + 80 * glow), b = Math.round(160 - 60 * glow);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = trim; ctx.fillRect(x + w / 2 - 1, y, 2, h); ctx.fillRect(x, y + h / 2 - 1, w, 2);
}

function drawTavern(ctx: CanvasRenderingContext2D, b: Building, L: Look, wallY: number, wallH: number, now: number): void {
  // Timber framing.
  ctx.fillStyle = L.trim;
  for (let bx = b.x + 24; bx < b.x + b.w - 10; bx += 48) ctx.fillRect(bx, wallY, 4, wallH);
  ctx.fillRect(b.x, wallY + wallH * 0.5, b.w, 3);
  const glow = 0.8 + 0.2 * Math.sin(now / 320);
  const n = Math.max(2, Math.floor(b.w / 70));
  for (let i = 0; i < n; i++) {
    const wx = b.x + 18 + (i * (b.w - 36)) / (n - 1) - 11;
    if (Math.abs(wx + 11 - b.door.x) < 30) continue;
    drawWindow(ctx, wx, wallY + 14, 22, 20, glow, L.trim);
    // Warm light spill.
    ctx.fillStyle = `rgba(255,190,90,${0.12 * glow})`;
    ctx.beginPath(); ctx.ellipse(wx + 11, wallY + 40, 24, 10, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Hanging sign on a bracket beside the door.
  const sx = b.door.x + 36, sy = wallY + 10;
  ctx.save();
  ctx.fillStyle = L.trim; ctx.fillRect(sx - 2, sy - 6, 28, 3);
  ctx.translate(sx + 14, sy - 3);
  ctx.rotate(Math.sin(now / 900) * 0.06);
  ctx.fillStyle = '#6b3f22'; roundRect(ctx, -14, 0, 28, 22, 3); ctx.fill();
  ctx.strokeStyle = '#c89b3c'; ctx.lineWidth = 1.5; roundRect(ctx, -12, 2, 24, 18, 2); ctx.stroke();
  // Mug.
  ctx.fillStyle = '#f0d9a8'; roundRect(ctx, -6, 6, 10, 11, 2); ctx.fill();
  ctx.strokeStyle = '#f0d9a8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(5, 11, 3.5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-6, 5, 10, 3);
  ctx.restore();
}

function drawShipwright(ctx: CanvasRenderingContext2D, b: Building, L: Look, wallY: number, wallH: number): void {
  // Plank walls.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let py = wallY + 8; py < wallY + wallH; py += 8) { ctx.moveTo(b.x, py); ctx.lineTo(b.x + b.w, py); }
  ctx.stroke();
  // Open shed front showing a hull under construction.
  const ox = b.x + 14, oy = wallY + 8, ow = b.w * 0.5, oh = wallH - 14;
  ctx.fillStyle = '#2a1d0f'; ctx.fillRect(ox, oy, ow, oh);
  ctx.strokeStyle = '#d9b97c'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const keelY = oy + oh - 10;
  ctx.beginPath(); ctx.moveTo(ox + 12, keelY); ctx.lineTo(ox + ow - 12, keelY); ctx.stroke();
  const ribs = Math.max(4, Math.floor(ow / 18));
  for (let i = 0; i < ribs; i++) {
    const rx = ox + 16 + (i * (ow - 32)) / (ribs - 1);
    const rh = oh * (0.45 + 0.35 * Math.sin((i / (ribs - 1)) * Math.PI));
    ctx.beginPath(); ctx.moveTo(rx - 7, keelY - rh); ctx.quadraticCurveTo(rx - 9, keelY - 4, rx, keelY); ctx.quadraticCurveTo(rx + 9, keelY - 4, rx + 7, keelY - rh); ctx.stroke();
  }
  // Sawhorse and planks to the right.
  const px = ox + ow + 16, py = wallY + wallH - 16;
  ctx.fillStyle = '#c9a46a';
  for (let i = 0; i < 4; i++) ctx.fillRect(px, py - i * 5, 60, 4);
  ctx.fillStyle = L.trim; ctx.fillRect(px + 6, py - 8, 3, 10); ctx.fillRect(px + 48, py - 8, 3, 10);
  drawWindow(ctx, b.x + b.w - 44, wallY + 12, 24, 18, 0.2, L.trim);
}

function drawMarket(ctx: CanvasRenderingContext2D, b: Building, L: Look, wallY: number, wallH: number): void {
  // Flat roof with a parapet.
  ctx.fillStyle = L.roofDark; ctx.fillRect(b.x - 4, b.y, b.w + 8, wallY - b.y);
  ctx.fillStyle = L.roof; ctx.fillRect(b.x, b.y + 6, b.w, wallY - b.y - 10);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let tx = b.x + 16; tx < b.x + b.w; tx += 16) { ctx.moveTo(tx, b.y + 6); ctx.lineTo(tx, wallY - 4); }
  ctx.stroke();
  // Striped awnings along the front: left and right of the door.
  const stripes: [string, string][] = [['#d94c4c', '#f6e7c8'], ['#2f8f6a', '#f6e7c8'], ['#3a74b5', '#f6e7c8']];
  const aw = (ax: number, awW: number, idx: number) => {
    const [c1, c2] = stripes[idx % stripes.length]!;
    const ay = wallY + 6, ah = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(ax, ay + ah, awW, 5);
    for (let sx = 0; sx < awW; sx += 12) {
      ctx.fillStyle = (sx / 12) % 2 ? c2 : c1;
      ctx.fillRect(ax + sx, ay, Math.min(12, awW - sx), ah);
    }
    // Scalloped hem.
    ctx.fillStyle = c1;
    for (let sx = 6; sx < awW; sx += 12) { ctx.beginPath(); ctx.arc(ax + sx, ay + ah, 6, 0, Math.PI); ctx.fill(); }
    // Stall table with goods.
    ctx.fillStyle = '#8a6a3c'; ctx.fillRect(ax + 6, ay + ah + 22, awW - 12, 6);
    ctx.fillStyle = L.trim; ctx.fillRect(ax + 8, ay + ah + 28, 3, 10); ctx.fillRect(ax + awW - 11, ay + ah + 28, 3, 10);
    const goods = ['#e5484d', '#f5a524', '#3fb950', '#a371f7', '#f0d9a8'];
    for (let g = 0; g < Math.floor((awW - 20) / 12); g++) {
      ctx.fillStyle = goods[(g + idx) % goods.length]!;
      ctx.beginPath(); ctx.arc(ax + 14 + g * 12, ay + ah + 19, 4.5, 0, Math.PI * 2); ctx.fill();
    }
  };
  const doorL = b.door.x - 22, doorR = b.door.x + 22;
  aw(b.x + 8, doorL - b.x - 16, 0);
  aw(doorR + 8, b.x + b.w - doorR - 16, 1);
  // Crates stacked at the corner.
  ctx.fillStyle = '#a3703d'; ctx.fillRect(b.x + b.w - 30, wallY + wallH - 22, 18, 18); ctx.fillRect(b.x + b.w - 26, wallY + wallH - 38, 14, 14);
  ctx.strokeStyle = '#6b4320'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x + b.w - 30, wallY + wallH - 22, 18, 18); ctx.strokeRect(b.x + b.w - 26, wallY + wallH - 38, 14, 14);
}

function drawBank(ctx: CanvasRenderingContext2D, b: Building, L: Look, wallY: number, wallH: number): void {
  // Stone courses.
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let py = wallY + 10; py < wallY + wallH; py += 10) { ctx.moveTo(b.x, py); ctx.lineTo(b.x + b.w, py); }
  for (let px = b.x + 20; px < b.x + b.w; px += 40) { ctx.moveTo(px, wallY); ctx.lineTo(px, wallY + wallH); }
  ctx.stroke();
  // Steps.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? '#d9d4c6' : '#bdb7a8';
    ctx.fillRect(b.x + 10 - i * 4, wallY + wallH - 6 - i * 4, b.w - 20 + i * 8, 4);
  }
  // Columns.
  const cols = Math.max(4, Math.floor(b.w / 48));
  for (let i = 0; i < cols; i++) {
    const cx = b.x + 18 + (i * (b.w - 36)) / (cols - 1);
    if (Math.abs(cx - b.door.x) < 24) continue;
    ctx.fillStyle = '#e9e4d6'; roundRect(ctx, cx - 6, wallY - 2, 12, wallH - 8, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(cx + 2, wallY, 4, wallH - 10);
    ctx.fillStyle = '#cfc9ba'; ctx.fillRect(cx - 8, wallY - 4, 16, 5); ctx.fillRect(cx - 8, wallY + wallH - 12, 16, 4);
  }
  // Pediment over the roof.
  ctx.fillStyle = L.roofDark;
  ctx.beginPath(); ctx.moveTo(b.x - 6, b.y + 6); ctx.lineTo(b.x + b.w / 2, b.y - 22); ctx.lineTo(b.x + b.w + 6, b.y + 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e9e4d6';
  ctx.beginPath(); ctx.moveTo(b.x + 4, b.y + 4); ctx.lineTo(b.x + b.w / 2, b.y - 16); ctx.lineTo(b.x + b.w - 4, b.y + 4); ctx.closePath(); ctx.fill();
  // Coin emblem.
  ctx.fillStyle = '#c89b3c'; ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y - 3, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f0c76a'; ctx.beginPath(); ctx.arc(b.x + b.w / 2, b.y - 3, 4, 0, Math.PI * 2); ctx.fill();
}

function drawPalace(ctx: CanvasRenderingContext2D, b: Building, L: Look, wallY: number, wallH: number, now: number): void {
  // Arched windows row.
  const n = Math.max(3, Math.floor(b.w / 60));
  for (let i = 0; i < n; i++) {
    const wx = b.x + 24 + (i * (b.w - 48)) / (n - 1);
    if (Math.abs(wx - b.door.x) < 34) continue;
    ctx.fillStyle = L.trim; roundRect(ctx, wx - 9, wallY + 10, 18, 30, 9); ctx.fill();
    ctx.fillStyle = '#7fb0d8'; roundRect(ctx, wx - 7, wallY + 12, 14, 26, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; roundRect(ctx, wx - 5, wallY + 14, 4, 10, 2); ctx.fill();
  }
  // Banners flanking the door.
  for (const side of [-1, 1]) {
    const bx = b.door.x + side * 40;
    ctx.fillStyle = '#7a1f22'; ctx.fillRect(bx - 7, wallY + 6, 14, 34);
    ctx.beginPath(); ctx.moveTo(bx - 7, wallY + 40); ctx.lineTo(bx, wallY + 48); ctx.lineTo(bx + 7, wallY + 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f0c76a'; ctx.beginPath(); ctx.arc(bx, wallY + 22, 4, 0, Math.PI * 2); ctx.fill();
  }
  // Towers at both ends, rising above the roof, with waving flags.
  for (const side of [0, 1]) {
    const tx = side ? b.x + b.w - 30 : b.x + 2;
    const th = b.h * 0.95;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(tx + 6, b.y + b.h - th + 8, 28, th);
    ctx.fillStyle = L.wall; ctx.fillRect(tx, b.y + b.h - th, 28, th);
    ctx.fillStyle = L.wallDark; ctx.fillRect(tx + 20, b.y + b.h - th, 8, th);
    ctx.strokeStyle = L.trim; ctx.lineWidth = 2; ctx.strokeRect(tx, b.y + b.h - th, 28, th);
    // Conical cap.
    ctx.fillStyle = L.roofDark;
    ctx.beginPath(); ctx.moveTo(tx - 6, b.y + b.h - th + 2); ctx.lineTo(tx + 14, b.y + b.h - th - 30); ctx.lineTo(tx + 34, b.y + b.h - th + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = L.roof;
    ctx.beginPath(); ctx.moveTo(tx - 6, b.y + b.h - th + 2); ctx.lineTo(tx + 14, b.y + b.h - th - 30); ctx.lineTo(tx + 14, b.y + b.h - th + 2); ctx.closePath(); ctx.fill();
    // Flag pole + flag.
    const fx = tx + 14, fy = b.y + b.h - th - 30;
    ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 22); ctx.stroke();
    const wave = Math.sin(now / 240 + side * 2) * 3;
    ctx.fillStyle = side ? '#e5484d' : '#f0c76a';
    ctx.beginPath(); ctx.moveTo(fx, fy - 22); ctx.quadraticCurveTo(fx + 9, fy - 20 + wave, fx + 18, fy - 17 + wave); ctx.lineTo(fx, fy - 11); ctx.closePath(); ctx.fill();
    // Tower slit windows.
    ctx.fillStyle = L.trim;
    for (let k = 0; k < 3; k++) ctx.fillRect(tx + 11, b.y + b.h - th + 18 + k * 26, 5, 12);
  }
}

function drawDock(ctx: CanvasRenderingContext2D, b: Building, L: Look, wallY: number, wallH: number, now: number): void {
  drawWindow(ctx, b.x + 18, wallY + 12, 22, 18, 0.6 + 0.2 * Math.sin(now / 400), L.trim);
  drawWindow(ctx, b.x + b.w - 40, wallY + 12, 22, 18, 0.6 + 0.2 * Math.sin(now / 400 + 1), L.trim);
  // Anchor sign over the door.
  const ax = b.door.x, ay = wallY + 12;
  ctx.strokeStyle = '#1b2a3b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(ax, ay - 4, 3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax, ay - 1); ctx.lineTo(ax, ay + 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax - 7, ay + 3); ctx.lineTo(ax + 7, ay + 3); ctx.stroke();
  ctx.beginPath(); ctx.arc(ax, ay + 8, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  // Lamp on a post at the corner and a coil of rope.
  const lx = b.x + b.w + 10, ly = b.y + b.h;
  ctx.fillStyle = '#3b2a1a'; ctx.fillRect(lx - 2, ly - 44, 4, 44);
  ctx.fillStyle = '#2a1d0f'; roundRect(ctx, lx - 6, ly - 56, 12, 13, 2); ctx.fill();
  const flick = 0.8 + 0.2 * Math.sin(now / 150);
  ctx.fillStyle = '#ffd27a'; ctx.fillRect(lx - 4, ly - 54, 8, 9);
  ctx.fillStyle = `rgba(255,190,90,${0.18 * flick})`; ctx.beginPath(); ctx.arc(lx, ly - 50, 22, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c9a46a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(b.x - 14, ly - 6, 9, 5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(b.x - 14, ly - 6, 5, 2.5, 0, 0, Math.PI * 2); ctx.stroke();
}
