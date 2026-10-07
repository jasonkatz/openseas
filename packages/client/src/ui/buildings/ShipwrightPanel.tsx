import { useState } from 'react';
import type { ShipType } from '@tidebound/shared';
import { SHIP_TYPES } from '@tidebound/shared';
import { useStore } from '../../store';
import { play } from '../../lib/audio';
import { Tag } from './Tag';

export function ShipwrightPanel() {
  const poe = useStore((s) => s.pirate?.poe ?? 0);
  return (
    <div className="col">
      <p className="muted">Every hull is laid down here and launched straight into the harbour. You have <b style={{ color: '#4a2f12' }}>{poe.toLocaleString()} PoE</b>.</p>
      <div className="grid2">
        {Object.values(SHIP_TYPES).map((t) => <ShipCard key={t.id} type={t} poe={poe} />)}
      </div>
    </div>
  );
}

function ShipCard({ type, poe }: { type: ShipType; poe: number }) {
  const send = useStore((s) => s.send);
  const [name, setName] = useState('');
  const ok = name.trim().length >= 2 && poe >= type.price;
  const buy = () => {
    if (!ok) return;
    play('tap');
    send({ t: 'buyShip', type: type.id, name: name.trim() });
    setName('');
  };
  return (
    <div className="card col" style={{ gap: 8 }}>
      <div className="row"><h3 style={{ flex: 1 }}>{type.name}</h3><Tag variant={poe >= type.price ? 'gold' : 'bad'}>{type.price.toLocaleString()} PoE</Tag></div>
      <div className="kv" style={{ fontSize: 13 }}>
        <span className="k">Crew</span><span>{type.maxCrew}</span>
        <span className="k">Cannons</span><span>{type.cannons} per side</span>
        <span className="k">Hull</span><span>{type.hull}</span>
        <span className="k">Speed</span><span>{type.baseSpeed} hex/min</span>
        <span className="k">Hold</span><span>{type.holdSize}</span>
      </div>
      <input className="input" placeholder="Name her…" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') buy(); }} />
      <button className="btn small" disabled={!ok} onClick={buy}>{poe < type.price ? 'Too dear' : 'Buy'}</button>
    </div>
  );
}
