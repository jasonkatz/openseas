import { useEffect, useRef } from 'react';
import type { Island } from '@tidebound/shared';
import { ISLANDS, OCEAN, hexToPixel } from '@tidebound/shared';
import { fitCanvas } from '../../lib/canvas';
import { Tag } from './Tag';

export function PalacePanel({ island }: { island: Island }) {
  return (
    <div className="col">
      <p className="fell" style={{ fontSize: 18, fontStyle: 'italic' }}>“{island.tagline}”</p>
      <p className="muted">The governor keeps the ocean chart here. Every island is a hex on the chart; the rocks are shoals no hull survives.</p>
      <OceanChart current={island} />
      <h3>The islands</h3>
      <div className="list">
        {ISLANDS.map((i) => (
          <div key={i.id} className="list-item" style={i.id === island.id ? { outline: '2px solid #c89b3c' } : undefined}>
            <div style={{ flex: 1 }}><b>{i.name}</b> <span className="muted">— {i.tagline}</span></div>
            <Tag>{i.biome}</Tag>
            {i.id === island.id && <Tag variant="gold">here</Tag>}
          </div>
        ))}
      </div>
    </div>
  );
}

const SQ3 = Math.sqrt(3);

/** The hex ocean, drawn once to fit the panel width. */
function OceanChart({ current }: { current: Island }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const avail = Math.max(280, wrap.clientWidth);
      // Axial coords make the ocean a parallelogram: width in hex units = sqrt3 * (W + H/2).
      const unitsW = SQ3 * (OCEAN.width + OCEAN.height / 2) + 2;
      const size = Math.max(6.5, Math.min(11, avail / unitsW));
      const pad = size * 2;
      const w = Math.ceil(unitsW * size + pad), h = Math.ceil(1.5 * OCEAN.height * size + size * 2 + pad);
      const ctx = fitCanvas(canvas, w, h);
      ctx.fillStyle = '#17405f';
      ctx.fillRect(0, 0, w, h);
      ctx.translate(pad / 2 + size, pad / 2 + size);

      const hexPath = (cx: number, cy: number, r: number) => {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 180) * (60 * k - 30);
          const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      // Water cells.
      ctx.fillStyle = '#1f5f8b';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let r = 0; r < OCEAN.height; r++) {
        for (let q = 0; q < OCEAN.width; q++) {
          const p = hexToPixel({ q, r }, size);
          hexPath(p.x, p.y, size - 0.5);
          ctx.fill(); ctx.stroke();
        }
      }
      // Rocks.
      for (const rk of OCEAN.rocks) {
        const p = hexToPixel(rk, size);
        ctx.fillStyle = '#3b4650';
        hexPath(p.x, p.y, size * 0.8); ctx.fill();
        ctx.fillStyle = '#6b7680';
        ctx.beginPath(); ctx.moveTo(p.x - size * 0.4, p.y + size * 0.3); ctx.lineTo(p.x, p.y - size * 0.4); ctx.lineTo(p.x + size * 0.4, p.y + size * 0.3); ctx.closePath(); ctx.fill();
      }
      // Islands.
      ctx.font = `bold ${Math.round(size * 1.15)}px 'Nunito', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const i of OCEAN.islands) {
        const p = hexToPixel(i.hex, size);
        const here = i.id === current.id;
        ctx.fillStyle = '#e6cf98'; hexPath(p.x, p.y, size * 1.15); ctx.fill();
        ctx.fillStyle = i.biome === 'volcanic' ? '#4a4440' : i.biome === 'atoll' ? '#a9c982' : i.biome === 'rocky' ? '#728a5c' : '#4f9a3f';
        hexPath(p.x, p.y, size * 0.8); ctx.fill();
        if (here) {
          ctx.strokeStyle = '#f0c76a'; ctx.lineWidth = 2.5;
          hexPath(p.x, p.y, size * 1.6); ctx.stroke();
        }
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,20,33,0.85)'; ctx.lineJoin = 'round';
        ctx.strokeText(i.name, p.x, p.y + size * 1.4);
        ctx.fillStyle = here ? '#ffe9a8' : '#f5ead2';
        ctx.fillText(i.name, p.x, p.y + size * 1.4);
      }
      // Compass.
      ctx.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0, Math.min(window.devicePixelRatio || 1, 2), 0, 0);
      ctx.strokeStyle = '#f0d9a8'; ctx.lineWidth = 1.5; ctx.fillStyle = '#f0d9a8';
      ctx.beginPath(); ctx.arc(w - 26, 26, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w - 26, 12); ctx.lineTo(w - 22, 26); ctx.lineTo(w - 30, 26); ctx.closePath(); ctx.fill();
      ctx.font = "bold 9px 'Nunito', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', w - 26, 4);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [current]);

  return (
    <div ref={wrapRef} className="scroll" style={{ borderRadius: 10, border: '2px solid #8a6a3c', background: '#17405f', lineHeight: 0 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
