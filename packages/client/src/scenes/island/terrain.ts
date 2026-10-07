import type { Biome, Island } from '@tidebound/shared';
import { rngFromSeed, rngNext, type Rng } from '@tidebound/shared';
import { roundRect } from '../../lib/canvas';
import { coastPoint, distToPaths, inRect, landValue, makeCoast, makePaths, makePier, traceCoast, type Coast, type Paths, type Pier, type Pt } from './geometry';

interface Palette {
  sea: string; seaDeep: string; shallow: string; shallow2: string; sand: string; sandDark: string;
  ground: string; groundLight: string; groundDark: string; foam: string;
}

const PALETTES: Record<Biome, Palette> = {
  tropical: { sea: '#1f5f8b', seaDeep: '#174a70', shallow: '#2f8fb8', shallow2: '#49b5cf', sand: '#e6cf98', sandDark: '#cdb27a', ground: '#5f9e3f', groundLight: '#78b654', groundDark: '#4b8231', foam: '#dff5ff' },
  rocky: { sea: '#1d4f72', seaDeep: '#163d5a', shallow: '#2a7093', shallow2: '#3f8fae', sand: '#c9bb95', sandDark: '#ad9f7a', ground: '#728a5c', groundLight: '#879e70', groundDark: '#5c7149', foam: '#e3f0f7' },
  volcanic: { sea: '#1b3f5c', seaDeep: '#122d44', shallow: '#2e6a85', shallow2: '#3f8299', sand: '#8a8078', sandDark: '#6f665f', ground: '#4a4440', groundLight: '#5c5450', groundDark: '#3a3431', foam: '#d9e6ee' },
  atoll: { sea: '#2a86b4', seaDeep: '#1f6f99', shallow: '#4fc3d9', shallow2: '#8ae4ea', sand: '#f4e6bd', sandDark: '#dccb9b', ground: '#a9c982', groundLight: '#c3da9d', groundDark: '#8fb06a', foam: '#ffffff' },
  misty: { sea: '#2b5068', seaDeep: '#213f54', shallow: '#4a7f93', shallow2: '#6b9aa8', sand: '#cfc5a6', sandDark: '#b3a88a', ground: '#6f8f6a', groundLight: '#86a37f', groundDark: '#5a7556', foam: '#e8eef0' },
  jungle: { sea: '#1e6281', seaDeep: '#174d68', shallow: '#2f93ae', shallow2: '#4fb6c4', sand: '#d8c48e', sandDark: '#bda871', ground: '#2f7a3a', groundLight: '#3f9448', groundDark: '#24602d', foam: '#dcf3f5' },
};

type DecoKind = 'palm' | 'boulder' | 'crate' | 'barrel' | 'lantern' | 'bush' | 'leaf' | 'vent' | 'shell' | 'tuft' | 'flowers' | 'driftwood';
interface Deco { kind: DecoKind; x: number; y: number; s: number; v: number }

const DECO_WEIGHTS: Record<Biome, [DecoKind, number][]> = {
  tropical: [['palm', 7], ['bush', 3], ['tuft', 4], ['flowers', 2], ['crate', 1], ['barrel', 1], ['lantern', 1], ['boulder', 1]],
  rocky: [['boulder', 8], ['tuft', 3], ['bush', 1], ['crate', 1], ['barrel', 1], ['lantern', 1], ['driftwood', 1]],
  volcanic: [['vent', 5], ['boulder', 5], ['tuft', 1], ['crate', 1], ['barrel', 1], ['lantern', 2]],
  atoll: [['palm', 4], ['shell', 4], ['tuft', 3], ['driftwood', 2], ['crate', 1], ['barrel', 1], ['lantern', 2]],
  misty: [['bush', 4], ['tuft', 4], ['boulder', 2], ['lantern', 3], ['crate', 1], ['barrel', 1], ['driftwood', 1]],
  jungle: [['leaf', 8], ['palm', 3], ['bush', 3], ['flowers', 2], ['crate', 1], ['barrel', 1], ['lantern', 1]],
};

/** Everything animated in the overlay is pre-placed here so the frame loop allocates nothing. */
export interface TerrainAnim {
  waves: { x: number; y: number; nx: number; ny: number; phase: number; len: number }[];
  sparkles: { x: number; y: number; phase: number }[];
  glows: { x: number; y: number; r: number; phase: number; kind: 'lantern' | 'vent' }[];
  fog: { x: number; y: number; rx: number; ry: number; phase: number }[];
}

export interface Terrain {
  canvas: HTMLCanvasElement;
  /** Cache pixels per world px. */
  res: number;
  coast: Coast;
  pier: Pier;
  paths: Paths;
  palette: Palette;
  anim: TerrainAnim;
}

/** Renders the static island into an offscreen canvas. Called once per island (and per resolution). */
export function buildTerrain(island: Island, res: number): Terrain {
  const coast = makeCoast(island);
  const pier = makePier(island);
  const paths = makePaths(island);
  const palette = PALETTES[island.biome];
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(island.width * res);
  canvas.height = Math.round(island.height * res);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(res, 0, 0, res, 0, 0);
  let rng = rngFromSeed(island.seed);

  rng = drawSea(ctx, island, palette, rng);
  drawLand(ctx, coast, palette, island.biome);
  rng = drawGroundTexture(ctx, coast, palette, island, rng);
  drawPaths(ctx, paths, island.biome);
  let decos: Deco[];
  [rng, decos] = placeDecor(island, coast, paths, pier, rng);
  for (const d of decos) drawDeco(ctx, d, island.biome);
  drawPier(ctx, pier);

  const anim = buildAnim(island, coast, decos, rng);
  return { canvas, res, coast, pier, paths, palette, anim };
}

function drawSea(ctx: CanvasRenderingContext2D, island: Island, p: Palette, rng: Rng): Rng {
  const g = ctx.createLinearGradient(0, 0, 0, island.height);
  g.addColorStop(0, p.seaDeep);
  g.addColorStop(0.5, p.sea);
  g.addColorStop(1, p.seaDeep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, island.width, island.height);
  // Soft streaks for texture.
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    let a: number, b: number, c: number;
    [rng, a] = rngNext(rng); [rng, b] = rngNext(rng); [rng, c] = rngNext(rng);
    const x = a * island.width, y = b * island.height, len = 10 + c * 40;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + 1); ctx.stroke();
  }
  return rng;
}

function drawLand(ctx: CanvasRenderingContext2D, coast: Coast, p: Palette, biome: Biome): void {
  // Shallows (two rings), sand, ground.
  ctx.fillStyle = p.shallow; traceCoast(ctx, coast, 1.11); ctx.fill();
  ctx.fillStyle = p.shallow2; traceCoast(ctx, coast, 1.05); ctx.fill();
  if (biome === 'atoll') { ctx.fillStyle = 'rgba(255,255,255,0.25)'; traceCoast(ctx, coast, 1.03); ctx.fill(); }
  ctx.fillStyle = p.sand; traceCoast(ctx, coast, 1.0); ctx.fill();
  ctx.fillStyle = p.sandDark; ctx.globalAlpha = 0.35; traceCoast(ctx, coast, 0.965); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = p.ground; traceCoast(ctx, coast, 0.93); ctx.fill();
  ctx.strokeStyle = p.groundDark; ctx.lineWidth = 3; ctx.globalAlpha = 0.5; traceCoast(ctx, coast, 0.93); ctx.stroke(); ctx.globalAlpha = 1;
}

function drawGroundTexture(ctx: CanvasRenderingContext2D, coast: Coast, p: Palette, island: Island, rng: Rng): Rng {
  for (let i = 0; i < 260; i++) {
    let a: number, b: number, c: number, d: number;
    [rng, a] = rngNext(rng); [rng, b] = rngNext(rng); [rng, c] = rngNext(rng); [rng, d] = rngNext(rng);
    const x = a * island.width, y = b * island.height;
    if (landValue(coast, x, y) > 0.9) continue;
    ctx.fillStyle = d < 0.5 ? p.groundLight : p.groundDark;
    ctx.globalAlpha = 0.18 + c * 0.12;
    ctx.beginPath();
    ctx.ellipse(x, y, 14 + c * 36, 8 + d * 18, a * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (island.biome === 'volcanic') {
    // Ash drifts and cracks.
    ctx.strokeStyle = 'rgba(255,120,40,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      let a: number, b: number, c: number;
      [rng, a] = rngNext(rng); [rng, b] = rngNext(rng); [rng, c] = rngNext(rng);
      const x = a * island.width, y = b * island.height;
      if (landValue(coast, x, y) > 0.85) continue;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 1; k <= 4; k++) ctx.lineTo(x + k * 9 + Math.sin(c * 9 + k) * 6, y + k * 4 + Math.cos(c * 7 + k) * 6);
      ctx.stroke();
    }
  }
  return rng;
}

function drawPaths(ctx: CanvasRenderingContext2D, paths: Paths, biome: Biome): void {
  const stone = biome === 'volcanic' ? '#5a5451' : biome === 'atoll' ? '#d9ccab' : '#a69a86';
  const stoneDark = biome === 'volcanic' ? '#3e3936' : biome === 'atoll' ? '#bba98a' : '#7f7465';
  const stoneLight = biome === 'volcanic' ? '#6e6762' : biome === 'atoll' ? '#efe4c6' : '#bfb3a0';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Base: a dark edge then the lighter bed.
  for (const [w, col] of [[30, stoneDark], [24, stone]] as const) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    for (const line of paths.lines) {
      ctx.beginPath();
      line.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(paths.plaza.x, paths.plaza.y, paths.plazaR + (w === 30 ? 3 : 0), 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  }
  // Cobbles: little rounded stones along every segment.
  let rng = rngFromSeed(0xc0bb1e5);
  const cobble = (x: number, y: number, r: number) => {
    let v: number; [rng, v] = rngNext(rng);
    ctx.fillStyle = v < 0.5 ? stoneLight : stoneDark;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
  };
  for (const line of paths.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (let t = 6; t < len; t += 9) {
        for (let o = -7; o <= 7; o += 7) {
          let j: number; [rng, j] = rngNext(rng);
          const x = a.x + ux * t - uy * (o + (j - 0.5) * 3), y = a.y + uy * t + ux * (o + (j - 0.5) * 3);
          cobble(x, y, 2.6 + j * 1.2);
        }
      }
    }
  }
  for (let ring = 10; ring < paths.plazaR; ring += 11) {
    const n = Math.floor(ring * 0.75);
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      cobble(paths.plaza.x + Math.cos(ang) * ring, paths.plaza.y + Math.sin(ang) * ring, 2.8);
    }
  }
  ctx.globalAlpha = 1;
  // Plaza centre: a compass rose inlay.
  ctx.strokeStyle = stoneDark; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(paths.plaza.x, paths.plaza.y, 10, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 4; k++) {
    const ang = (k / 4) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(paths.plaza.x, paths.plaza.y); ctx.lineTo(paths.plaza.x + Math.cos(ang) * 22, paths.plaza.y + Math.sin(ang) * 22); ctx.stroke();
  }
}

function placeDecor(island: Island, coast: Coast, paths: Paths, pier: Pier, rng: Rng): [Rng, Deco[]] {
  const weights = DECO_WEIGHTS[island.biome];
  const total = weights.reduce((s, w) => s + w[1], 0);
  const out: Deco[] = [];
  const target = island.biome === 'jungle' ? 150 : island.biome === 'volcanic' ? 90 : 110;
  let tries = 0;
  while (out.length < target && tries++ < 1800) {
    let a: number, b: number, c: number, d: number, e: number;
    [rng, a] = rngNext(rng); [rng, b] = rngNext(rng); [rng, c] = rngNext(rng); [rng, d] = rngNext(rng); [rng, e] = rngNext(rng);
    const x = a * island.width, y = b * island.height;
    let kind: DecoKind = 'tuft';
    let acc = c * total;
    for (const [k, w] of weights) { acc -= w; if (acc <= 0) { kind = k; break; } }
    const lv = landValue(coast, x, y);
    const beachy = kind === 'shell' || kind === 'driftwood' || kind === 'palm';
    if (beachy ? lv > 0.98 || lv < 0.6 : lv > 0.9) continue;
    if (island.buildings.some((bl) => inRect(bl, x, y, kind === 'palm' || kind === 'leaf' ? 34 : 22))) continue;
    if (distToPaths(paths, x, y) < (kind === 'crate' || kind === 'barrel' || kind === 'lantern' ? 14 : 24)) continue;
    if (inRect(pier.jetty, x, y, 20) || inRect(pier.quay, x, y, 20)) continue;
    if (Math.hypot(x - island.spawn.x, y - island.spawn.y) < 60) continue;
    if (kind === 'lantern' && distToPaths(paths, x, y) > 40) continue; // lanterns line the streets
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < (kind === 'tuft' || kind === 'shell' ? 14 : 30))) continue;
    out.push({ kind, x, y, s: 0.8 + d * 0.5, v: e });
  }
  out.sort((p, q) => p.y - q.y);
  return [rng, out];
}

function drawDeco(ctx: CanvasRenderingContext2D, d: Deco, biome: Biome): void {
  const { x, y, s, v } = d;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  switch (d.kind) {
    case 'palm': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(6, 4, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6 + v * 6, -22, 4, -46); ctx.stroke();
      ctx.strokeStyle = '#5b3a1f'; ctx.lineWidth = 1.5;
      for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(-3 + k * 0.8, -k * 8); ctx.lineTo(4 + k * 0.8, -k * 8 - 1); ctx.stroke(); }
      ctx.fillStyle = biome === 'jungle' ? '#2d8a3e' : '#3f9e4a';
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * Math.PI * 2 + v;
        ctx.save(); ctx.translate(4, -46); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(16, -8, 30, 2); ctx.quadraticCurveTo(16, 6, 0, 0); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#8a5a2a';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(1 + k * 3, -42 + (k % 2) * 2, 2.5, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'boulder': {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(3, 5, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = biome === 'volcanic' ? '#55504d' : '#8d8f86';
      ctx.beginPath(); ctx.moveTo(-18, 2); ctx.quadraticCurveTo(-16, -14, -4, -16); ctx.quadraticCurveTo(10, -20, 17, -8); ctx.quadraticCurveTo(22, 4, 10, 6); ctx.lineTo(-12, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(-4, -9, 8, 4, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(6, 0, 9, 4, 0.3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crate': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-9, 1, 20, 5);
      ctx.fillStyle = '#a3703d'; ctx.fillRect(-9, -16, 18, 18);
      ctx.strokeStyle = '#6b4320'; ctx.lineWidth = 2; ctx.strokeRect(-9, -16, 18, 18);
      ctx.beginPath(); ctx.moveTo(-9, -16); ctx.lineTo(9, 2); ctx.moveTo(9, -16); ctx.lineTo(-9, 2); ctx.stroke();
      break;
    }
    case 'barrel': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(1, 2, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7d5230'; roundRect(ctx, -7, -18, 14, 20, 5); ctx.fill();
      ctx.fillStyle = '#4a2f12'; ctx.fillRect(-7, -14, 14, 2); ctx.fillRect(-7, -4, 14, 2);
      ctx.fillStyle = '#9a6a3f'; ctx.beginPath(); ctx.ellipse(0, -18, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'lantern': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(1, 1, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3b2a1a'; ctx.fillRect(-2, -34, 4, 34); ctx.fillRect(-5, -36, 10, 3);
      ctx.fillStyle = '#2a1d0f'; roundRect(ctx, -5, -46, 10, 11, 2); ctx.fill();
      ctx.fillStyle = '#ffd27a'; ctx.fillRect(-3, -44, 6, 7);
      break;
    }
    case 'bush': {
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(2, 3, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = biome === 'misty' ? '#4f7a4a' : '#3d8f3d';
      for (const [bx, by, r] of [[-8, -6, 9], [6, -7, 10], [0, -12, 9], [-2, -3, 8]] as const) { ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(-3, -13, 5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(2, 3, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 6; k++) {
        const ang = -Math.PI / 2 + (k - 2.5) * 0.55 + v * 0.3;
        ctx.fillStyle = k % 2 ? '#1f6b2c' : '#2a8a38';
        ctx.save(); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -14, 34, -4); ctx.quadraticCurveTo(12, 8, 0, 0); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(30, -4); ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'vent': {
      ctx.fillStyle = '#2b2624'; ctx.beginPath(); ctx.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1614'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff6a1a'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'shell': {
      ctx.fillStyle = v < 0.5 ? '#f6e9d2' : '#f2c9c0';
      ctx.beginPath(); ctx.moveTo(-5, 2); ctx.quadraticCurveTo(0, -8, 5, 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-3, -3); ctx.moveTo(0, 2); ctx.lineTo(0, -5); ctx.moveTo(0, 2); ctx.lineTo(3, -3); ctx.stroke();
      break;
    }
    case 'tuft': {
      ctx.strokeStyle = biome === 'volcanic' ? '#6a5f55' : biome === 'atoll' ? '#9ab878' : '#3e8a3a';
      ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 2, 0); ctx.quadraticCurveTo(k * 3, -5, k * 4, -9 - Math.abs(k)); ctx.stroke(); }
      break;
    }
    case 'flowers': {
      const cols = ['#ff8a8e', '#ffd27a', '#ffffff', '#d7bcff'];
      for (let k = 0; k < 5; k++) {
        const ang = k * 1.3 + v * 6, r = 4 + (k % 3) * 4;
        ctx.fillStyle = cols[(k + Math.floor(v * 4)) % cols.length]!;
        ctx.beginPath(); ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r * 0.6, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'driftwood': {
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(0, 2, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a08a6a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.quadraticCurveTo(0, -4 + v * 6, 16, -1); ctx.stroke();
      ctx.strokeStyle = '#7a6448'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(4, -2); ctx.lineTo(10, -9); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawPier(ctx: CanvasRenderingContext2D, pier: Pier): void {
  for (const r of [pier.jetty, pier.quay]) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(r.x + 3, r.y + 4, r.w, r.h);
    ctx.fillStyle = '#7a4c2a'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#4a2f12'; ctx.lineWidth = 1;
    const horizontal = r.w > r.h;
    const step = 9;
    ctx.beginPath();
    if (horizontal) for (let x = r.x + step; x < r.x + r.w; x += step) { ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); }
    else for (let y = r.y + step; y < r.y + r.h; y += step) { ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); }
    ctx.stroke();
    ctx.strokeStyle = '#9a6a3f'; ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }
  // Bollards and mooring posts along the quay.
  for (let x = pier.quay.x + 12; x < pier.quay.x + pier.quay.w; x += 70) {
    ctx.fillStyle = '#3b2a1a'; ctx.beginPath(); ctx.arc(x, pier.quay.y + pier.quay.h - 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a3d22'; ctx.beginPath(); ctx.arc(x, pier.quay.y + pier.quay.h - 5, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  // Crab pots and a coil of rope by the jetty.
  ctx.strokeStyle = '#c9a46a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(pier.jetty.x + pier.jetty.w + 14, pier.jetty.y + 26, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(pier.jetty.x + pier.jetty.w + 14, pier.jetty.y + 26, 3, 0, Math.PI * 2); ctx.stroke();
}

function buildAnim(island: Island, coast: Coast, decos: Deco[], rng: Rng): TerrainAnim {
  const waves: TerrainAnim['waves'] = [];
  const p: Pt = { x: 0, y: 0 }, q: Pt = { x: 0, y: 0 };
  const N = 64;
  for (let i = 0; i < N; i++) {
    const phi = (i / N) * Math.PI * 2;
    let a: number, b: number;
    [rng, a] = rngNext(rng); [rng, b] = rngNext(rng);
    coastPoint(coast, phi, 1.06 + a * 0.08, p);
    coastPoint(coast, phi + 0.02, 1.06 + a * 0.08, q);
    const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    waves.push({ x: p.x, y: p.y, nx: -dy / len, ny: dx / len, phase: b * Math.PI * 2, len: 14 + a * 14 });
  }
  const sparkles: TerrainAnim['sparkles'] = [];
  let tries = 0;
  while (sparkles.length < 70 && tries++ < 600) {
    let a: number, b: number, c: number;
    [rng, a] = rngNext(rng); [rng, b] = rngNext(rng); [rng, c] = rngNext(rng);
    const x = a * island.width, y = b * island.height;
    if (landValue(coast, x, y) < 1.04) continue;
    sparkles.push({ x, y, phase: c * Math.PI * 2 });
  }
  const glows: TerrainAnim['glows'] = [];
  for (const d of decos) {
    if (d.kind === 'lantern') glows.push({ x: d.x, y: d.y - 40 * d.s, r: 26, phase: d.v * 6, kind: 'lantern' });
    if (d.kind === 'vent') glows.push({ x: d.x, y: d.y, r: 22 * d.s, phase: d.v * 6, kind: 'vent' });
  }
  const fog: TerrainAnim['fog'] = [];
  if (island.biome === 'misty') {
    for (let i = 0; i < 9; i++) {
      let a: number, b: number, c: number;
      [rng, a] = rngNext(rng); [rng, b] = rngNext(rng); [rng, c] = rngNext(rng);
      fog.push({ x: 100 + a * (island.width - 200), y: 60 + b * (island.height - 160), rx: 120 + c * 120, ry: 40 + a * 40, phase: b * Math.PI * 2 });
    }
  }
  return { waves, sparkles, glows, fog };
}

/**
 * Animated layer drawn over the cached terrain each frame. `view` is the visible
 * world rect so off-screen effects are skipped. Allocation-free.
 */
export function drawTerrainOverlay(ctx: CanvasRenderingContext2D, t: Terrain, now: number, view: { x: number; y: number; w: number; h: number }, biome: Biome): void {
  const vx0 = view.x - 60, vy0 = view.y - 60, vx1 = view.x + view.w + 60, vy1 = view.y + view.h + 60;
  // Waves lapping the shore.
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = t.palette.foam;
  const waves = t.anim.waves;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i]!;
    if (w.x < vx0 || w.x > vx1 || w.y < vy0 || w.y > vy1) continue;
    const k = (now / 1400 + w.phase) % (Math.PI * 2);
    const travel = Math.sin(k) * 10;
    const alpha = 0.18 + 0.32 * Math.max(0, Math.cos(k));
    ctx.globalAlpha = alpha;
    const cx = w.x + w.nx * travel, cy = w.y + w.ny * travel;
    ctx.beginPath();
    ctx.moveTo(cx - w.ny * w.len, cy + w.nx * w.len);
    ctx.quadraticCurveTo(cx + w.nx * 4, cy + w.ny * 4, cx + w.ny * w.len, cy - w.nx * w.len);
    ctx.stroke();
  }
  // Sun sparkle on open water.
  ctx.fillStyle = '#ffffff';
  const sp = t.anim.sparkles;
  for (let i = 0; i < sp.length; i++) {
    const s = sp[i]!;
    if (s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
    const a = Math.sin(now / 600 + s.phase);
    if (a <= 0.3) continue;
    ctx.globalAlpha = (a - 0.3) * 0.9;
    ctx.fillRect(s.x, s.y, 3, 1.5);
  }
  if (biome === 'atoll') {
    // Shimmering rings in the lagoon shallows.
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    for (let i = 0; i < waves.length; i += 3) {
      const w = waves[i]!;
      if (w.x < vx0 || w.x > vx1 || w.y < vy0 || w.y > vy1) continue;
      const k = ((now / 2600 + w.phase) % 1);
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.beginPath(); ctx.ellipse(w.x + w.nx * 20, w.y + w.ny * 20, 6 + k * 22, 3 + k * 10, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // Lantern and ember glows.
  const gl = t.anim.glows;
  for (let i = 0; i < gl.length; i++) {
    const g = gl[i]!;
    if (g.x < vx0 || g.x > vx1 || g.y < vy0 || g.y > vy1) continue;
    const flick = 0.75 + 0.25 * Math.sin(now / 170 + g.phase) * Math.sin(now / 410 + g.phase * 2);
    if (g.kind === 'lantern') {
      ctx.fillStyle = '#ffb347';
      ctx.globalAlpha = 0.18 * flick;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.28 * flick;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 0.45, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#ff5a1a';
      ctx.globalAlpha = 0.22 * flick;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, g.r, g.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd27a';
      ctx.globalAlpha = 0.5 * flick;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, g.r * 0.25, g.r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      // A spark or two drifting up.
      const sy = (now / 9 + g.phase * 100) % 60;
      ctx.globalAlpha = (1 - sy / 60) * 0.8;
      ctx.fillRect(g.x + Math.sin(now / 300 + g.phase) * 6, g.y - sy, 2, 2);
    }
  }
  // Drifting fog.
  const fog = t.anim.fog;
  if (fog.length) {
    ctx.fillStyle = '#dfe8ea';
    for (let i = 0; i < fog.length; i++) {
      const f = fog[i]!;
      const x = f.x + Math.sin(now / 5000 + f.phase) * 60, y = f.y + Math.cos(now / 7000 + f.phase) * 16;
      if (x + f.rx < vx0 || x - f.rx > vx1 || y + f.ry < vy0 || y - f.ry > vy1) continue;
      ctx.globalAlpha = 0.13 + 0.05 * Math.sin(now / 3000 + f.phase);
      ctx.beginPath(); ctx.ellipse(x, y, f.rx, f.ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - f.rx * 0.4, y + 10, f.rx * 0.6, f.ry * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
