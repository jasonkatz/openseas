import { useEffect, useRef } from 'react';
import type { Hex, Ship } from '@tidebound/shared';
import { ISLANDS, OCEAN, hexToPixel, pixelToHex, islandAt, hexDistance, ISLAND_BY_ID } from '@tidebound/shared';
import { fitCanvas } from '../lib/canvas';

const BIOME_COLOR: Record<string, string> = { tropical: '#5fae5a', rocky: '#8d8f86', volcanic: '#5a3b3b', atoll: '#e7d9a8', misty: '#6e8a7a', jungle: '#2f7a3d', };

export interface OceanMapProps {
  width: number;
  height: number;
  ship?: Ship | null;
  selected?: string | null;
  highlight?: string | null;
  onPick?: (islandId: string) => void;
  /** Other ships to draw (id, hex, heading, name). */
  others?: { hex: Hex; name: string; mine?: boolean }[];
}

/** Hex ocean chart drawn on parchment. */
export function OceanMap({ width, height, ship, selected, highlight, onPick, others }: OceanMapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = Math.min(width / ((OCEAN.width + OCEAN.height / 2) * Math.sqrt(3)), height / (OCEAN.height * 1.5 + 1)) * 0.98;
  const ox = 10 + size, oy = 10 + size;

  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      const c = ref.current;
      if (!c) return;
      const ctx = fitCanvas(c, width, height);
      ctx.fillStyle = '#e7d3a1';
      ctx.fillRect(0, 0, width, height);
      // water hexes
      for (let r = 0; r < OCEAN.height; r++) for (let q = 0; q < OCEAN.width; q++) {
        const p = hexToPixel({ q, r }, size);
        const shade = ((q * 7 + r * 13) % 5) / 5;
        ctx.fillStyle = `rgba(58,143,199,${0.35 + shade * 0.12})`;
        hexPath(ctx, ox + p.x, oy + p.y, size * 0.96);
        ctx.fill();
      }
      // rocks
      ctx.fillStyle = '#6b6b63';
      for (const rk of OCEAN.rocks) {
        const p = hexToPixel(rk, size);
        ctx.beginPath();
        ctx.moveTo(ox + p.x - size * 0.4, oy + p.y + size * 0.3);
        ctx.lineTo(ox + p.x, oy + p.y - size * 0.4);
        ctx.lineTo(ox + p.x + size * 0.4, oy + p.y + size * 0.3);
        ctx.closePath();
        ctx.fill();
      }
      // voyage path
      if (ship && ship.status.kind === 'sailing') {
        ctx.strokeStyle = 'rgba(42,29,15,0.6)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        const start = hexToPixel(ship.hex, size);
        ctx.moveTo(ox + start.x, oy + start.y);
        for (let i = ship.status.index; i < ship.status.path.length; i++) {
          const p = hexToPixel(ship.status.path[i]!, size);
          ctx.lineTo(ox + p.x, oy + p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // islands
      for (const isl of ISLANDS) {
        const p = hexToPixel(isl.hex, size);
        const x = ox + p.x, y = oy + p.y;
        const sel = selected === isl.id, hi = highlight === isl.id;
        ctx.fillStyle = BIOME_COLOR[isl.biome] ?? '#5fae5a';
        ctx.beginPath();
        ctx.ellipse(x, y, size * 1.1, size * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = sel ? '#c0392b' : hi ? '#c89b3c' : 'rgba(42,29,15,0.6)';
        ctx.lineWidth = sel || hi ? 3 : 1.5;
        ctx.stroke();
        ctx.fillStyle = '#2a1d0f';
        ctx.font = `${Math.max(10, size * 0.95)}px "IM Fell English", serif`;
        ctx.textAlign = 'center';
        ctx.fillText(isl.name, x, y + size * 1.9);
      }
      // other ships
      for (const o of others ?? []) {
        const p = hexToPixel(o.hex, size);
        ctx.fillStyle = o.mine ? '#c0392b' : '#2a1d0f';
        ctx.beginPath();
        ctx.arc(ox + p.x, oy + p.y, size * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      // my ship
      if (ship) {
        const p = hexToPixel(ship.hex, size);
        const x = ox + p.x, y = oy + p.y;
        const bob = Math.sin(t / 400) * 1.5;
        ctx.save();
        ctx.translate(x, y + bob);
        ctx.fillStyle = '#2a1d0f';
        ctx.beginPath();
        ctx.moveTo(-size * 0.6, 0); ctx.lineTo(size * 0.6, 0); ctx.lineTo(size * 0.35, size * 0.4); ctx.lineTo(-size * 0.35, size * 0.4); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f0d9a8';
        ctx.beginPath(); ctx.moveTo(0, -size * 0.9); ctx.lineTo(size * 0.45, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, size * 0.9, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // compass
      ctx.save();
      ctx.translate(width - 34, 34);
      ctx.strokeStyle = 'rgba(42,29,15,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1d0f'; ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(5, 0); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill();
      ctx.font = '11px Nunito'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -26);
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, ship, selected, highlight, others, size, ox, oy]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const h = pixelToHex(e.clientX - rect.left - ox, e.clientY - rect.top - oy, size);
    // Find nearest island within 2 hexes.
    let best: string | null = null, bd = 3;
    for (const isl of ISLANDS) { const d = hexDistance(isl.hex, h); if (d < bd) { bd = d; best = isl.id; } }
    if (best) onPick(best);
  };

  return <canvas ref={ref} onClick={onClick} style={{ borderRadius: 10, border: '2px solid #8a6a3c', cursor: onPick ? 'pointer' : 'default', display: 'block' }} />;
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function islandName(id: string): string { return ISLAND_BY_ID[id]?.name ?? id; }
export { islandAt };
