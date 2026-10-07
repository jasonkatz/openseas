import type { Island } from '@tidebound/shared';
import { COMMODITIES, ISLANDS } from '@tidebound/shared';
import { Tag } from './Tag';

export function MarketPanel({ island }: { island: Island }) {
  return (
    <div className="col">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #8a6a3c' }}>
            <th style={{ padding: '4px 6px' }}>Good</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Base</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Here</th><th style={{ padding: '4px 6px' }}></th>
          </tr>
        </thead>
        <tbody>
          {COMMODITIES.map((c) => {
            const price = island.market[c.id];
            const tag = price < c.base ? <Tag variant="good">cheap</Tag> : price > c.base ? <Tag variant="bad">dear</Tag> : <Tag>fair</Tag>;
            return (
              <tr key={c.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                <td style={{ padding: '5px 6px' }}><b>{c.name}</b></td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }} className="muted">{c.base}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right' }}><b>{price}</b> PoE</td>
                <td style={{ padding: '5px 6px' }}>{tag}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Trade from your docked ship's hold (captain only) — board a ship first.</p>
      <div className="card col" style={{ gap: 4 }}>
        <h3>Trade routes</h3>
        <div className="muted" style={{ fontSize: 12 }}>Where each good fetches the best price elsewhere.</div>
        <div className="kv" style={{ fontSize: 13 }}>
          {COMMODITIES.map((c) => {
            let best = null as Island | null;
            for (const i of ISLANDS) if (i.id !== island.id && (!best || i.market[c.id] > best.market[c.id])) best = i;
            if (!best) return null;
            const margin = best.market[c.id] - island.market[c.id];
            return (
              <span key={c.id} style={{ display: 'contents' }}>
                <span className="k">{c.name}</span>
                <span>{best.name} buys at <b>{best.market[c.id]}</b>{margin > 0 ? <Tag variant="good" style={{ marginLeft: 6 }}>+{margin}</Tag> : <span className="muted"> (no profit from here)</span>}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
