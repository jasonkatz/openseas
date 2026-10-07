import type { Avatar } from '@tidebound/shared';

export const SKIN = ['#f6d3b3', '#e8b48c', '#c98a5b', '#a0683f', '#73482a', '#4a2e1b'];
export const HAIR = ['#2b1b10', '#5a3a1e', '#a0652d', '#d9a441', '#e8e2d6', '#b23a2b'];
export const CLOTH = ['#e5484d', '#2f81f7', '#3fb950', '#f5a524', '#a371f7', '#29c6d6', '#f0d9a8', '#2a2a2a', '#f06ab2', '#8a6a3c'];
export const HAT_NAMES = ['None', 'Bandana', 'Tricorne', 'Bicorne', 'Straw hat', 'Captain\'s hat'];
export const HAIR_NAMES = ['Short', 'Long', 'Ponytail', 'Mohawk', 'Bald', 'Curly', 'Braids', 'Bun'];

/**
 * Draws a chunky procedural pirate at (x, y) = feet position, `h` tall.
 * facing: 0 up, 1 right, 2 down, 3 left. walk: 0..1 phase (0 = standing).
 */
export function drawPirate(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, av: Avatar, facing = 2, walk = 0, opts: { outline?: string; alpha?: number } = {}): void {
  const s = h / 48; // base unit
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.translate(x, y);
  const skin = SKIN[av.skin % SKIN.length]!;
  const hair = HAIR[av.hairColor % HAIR.length]!;
  const shirt = CLOTH[av.shirt % CLOTH.length]!;
  const pants = CLOTH[av.pants % CLOTH.length]!;
  const swing = walk ? Math.sin(walk * Math.PI * 2) : 0;
  const flip = facing === 3 ? -1 : 1;
  ctx.scale(flip, 1);
  const bob = walk ? Math.abs(Math.sin(walk * Math.PI * 2)) * 1.5 * s : 0;
  ctx.translate(0, -bob);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, bob + 1 * s, 11 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.fillStyle = pants;
  const legW = 6 * s, legH = 12 * s;
  rr(ctx, -7 * s, -legH + swing * 2 * s, legW, legH, 2 * s);
  rr(ctx, 1 * s, -legH - swing * 2 * s, legW, legH, 2 * s);
  // boots
  ctx.fillStyle = '#2a1d0f';
  rr(ctx, -7.5 * s, -3 * s + swing * 2 * s, 7 * s, 3.5 * s, 1.5 * s);
  rr(ctx, 0.5 * s, -3 * s - swing * 2 * s, 7 * s, 3.5 * s, 1.5 * s);

  // body
  ctx.fillStyle = shirt;
  rr(ctx, -9 * s, -28 * s, 18 * s, 18 * s, 4 * s);
  // belt
  ctx.fillStyle = '#4a2f12';
  ctx.fillRect(-9 * s, -13 * s, 18 * s, 2.5 * s);
  ctx.fillStyle = '#c89b3c';
  ctx.fillRect(-1.5 * s, -13.3 * s, 3 * s, 3 * s);
  // stripes on shirt for some colours
  if (av.shirt % 3 === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 3; i++) ctx.fillRect(-9 * s, (-26 + i * 5) * s, 18 * s, 1.6 * s);
  }
  // arms
  ctx.fillStyle = shirt;
  rr(ctx, -13 * s, -27 * s + swing * 1.5 * s, 4.5 * s, 13 * s, 2 * s);
  rr(ctx, 8.5 * s, -27 * s - swing * 1.5 * s, 4.5 * s, 13 * s, 2 * s);
  ctx.fillStyle = skin;
  rr(ctx, -13 * s, -15 * s + swing * 1.5 * s, 4.5 * s, 3.5 * s, 1.5 * s);
  rr(ctx, 8.5 * s, -15 * s - swing * 1.5 * s, 4.5 * s, 3.5 * s, 1.5 * s);

  // head
  ctx.fillStyle = skin;
  rr(ctx, -8 * s, -44 * s, 16 * s, 16 * s, 5 * s);
  // face (not when facing up)
  if (facing !== 0) {
    ctx.fillStyle = '#1b1b1b';
    const ex = facing === 2 ? [-3.5, 2] : [2.5];
    for (const e of ex) rr(ctx, e * s, -37 * s, 2 * s, 2.5 * s, 1 * s);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (facing === 2) rr(ctx, -2 * s, -32 * s, 4 * s, 1.2 * s, 0.6 * s);
    else rr(ctx, 3 * s, -32 * s, 3 * s, 1.2 * s, 0.6 * s);
  }
  // hair
  ctx.fillStyle = hair;
  switch (av.hair % 8) {
    case 0: rr(ctx, -8.5 * s, -45 * s, 17 * s, 6 * s, 4 * s); break; // short
    case 1: rr(ctx, -9 * s, -45 * s, 18 * s, 7 * s, 4 * s); rr(ctx, -9.5 * s, -42 * s, 4 * s, 16 * s, 2 * s); rr(ctx, 5.5 * s, -42 * s, 4 * s, 16 * s, 2 * s); break; // long
    case 2: rr(ctx, -8.5 * s, -45 * s, 17 * s, 6 * s, 4 * s); rr(ctx, -2 * s, -44 * s, 4 * s, 16 * s, 2 * s); break; // ponytail
    case 3: rr(ctx, -2.5 * s, -49 * s, 5 * s, 10 * s, 2 * s); break; // mohawk
    case 4: break; // bald
    case 5: for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(i * 2.6 * s, -44 * s, 3 * s, 0, Math.PI * 2); ctx.fill(); } break; // curly
    case 6: rr(ctx, -8.5 * s, -45 * s, 17 * s, 6 * s, 4 * s); for (const bx of [-8, 5]) rr(ctx, bx * s, -41 * s, 3 * s, 14 * s, 1.5 * s); break; // braids
    case 7: rr(ctx, -8.5 * s, -45 * s, 17 * s, 6 * s, 4 * s); ctx.beginPath(); ctx.arc(0, -47 * s, 4 * s, 0, Math.PI * 2); ctx.fill(); break; // bun
  }
  // hat
  switch (av.hat % 6) {
    case 1: ctx.fillStyle = CLOTH[(av.shirt + 1) % CLOTH.length]!; rr(ctx, -9 * s, -46 * s, 18 * s, 6 * s, 3 * s); rr(ctx, 6 * s, -44 * s, 6 * s, 3 * s, 1 * s); break; // bandana
    case 2: ctx.fillStyle = '#1b1b1b'; rr(ctx, -12 * s, -47 * s, 24 * s, 5 * s, 2.5 * s); ctx.beginPath(); ctx.moveTo(-9 * s, -46 * s); ctx.lineTo(0, -56 * s); ctx.lineTo(9 * s, -46 * s); ctx.closePath(); ctx.fill(); break; // tricorne
    case 3: ctx.fillStyle = '#1b2a3b'; rr(ctx, -13 * s, -50 * s, 26 * s, 7 * s, 3 * s); ctx.fillStyle = '#c89b3c'; rr(ctx, -2 * s, -49 * s, 4 * s, 4 * s, 1 * s); break; // bicorne
    case 4: ctx.fillStyle = '#d9b97c'; rr(ctx, -14 * s, -46 * s, 28 * s, 4 * s, 2 * s); rr(ctx, -8 * s, -52 * s, 16 * s, 7 * s, 3 * s); break; // straw
    case 5: ctx.fillStyle = '#7a1f22'; rr(ctx, -12 * s, -47 * s, 24 * s, 5 * s, 2.5 * s); rr(ctx, -9 * s, -55 * s, 18 * s, 9 * s, 3 * s); ctx.fillStyle = '#f0d9a8'; ctx.beginPath(); ctx.arc(0, -51 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill(); break; // captain
  }
  if (opts.outline) {
    ctx.strokeStyle = opts.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, bob + 1 * s, 12 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}
