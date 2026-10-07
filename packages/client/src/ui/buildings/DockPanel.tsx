import type { Island, Ship } from '@tidebound/shared';
import { SHIP_TYPES } from '@tidebound/shared';
import { useStore } from '../../store';
import { play } from '../../lib/audio';
import { Tag } from './Tag';

export function DockPanel({ island }: { island: Island }) {
  const ships = useStore((s) => s.ships);
  const pirate = useStore((s) => s.pirate);
  const crew = useStore((s) => s.crew);
  const crews = useStore((s) => s.crews);
  const send = useStore((s) => s.send);
  const here = ships.filter((s) => s.status.kind === 'docked' && s.status.islandId === island.id);

  const ownerTag = (s: Ship) => {
    if (s.ownerId === 'navy') return <Tag>Navy</Tag>;
    if (pirate && s.ownerId === pirate.id) return <Tag variant="good">Yours</Tag>;
    const name = (crew && s.crewId === crew.id ? crew.name : crews.find((c) => c.id === s.crewId)?.name) ?? null;
    return <Tag variant="gold">{name ?? 'Private'}</Tag>;
  };

  const board = (s: Ship) => { play('tap'); send({ t: 'boardShip', shipId: s.id }); };

  return (
    <div className="col">
      <h3>Ships in harbour</h3>
      <p className="muted">Navy sloops are free for anyone. The first aboard is captain.</p>
      {here.length === 0 && <div className="card muted">No ships moored here. Try the shipwright, or wait for the navy to send one.</div>}
      <div className="list">
        {here.map((s) => {
          const t = SHIP_TYPES[s.type];
          const hull = Math.max(0, 1 - s.stats.damage / t.hull);
          const full = s.aboard.length >= t.maxCrew;
          return (
            <div key={s.id} className="list-item" style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px' }}>
                <div className="row" style={{ gap: 8 }}><b>{s.name}</b> {ownerTag(s)}</div>
                <div className="muted" style={{ fontSize: 13 }}>{t.name} · {s.aboard.length}/{t.maxCrew} aboard · {t.cannons * 2} guns</div>
              </div>
              <div className="col" style={{ gap: 4, flex: '0 0 130px', fontSize: 11 }}>
                <div className="row" style={{ gap: 6 }}><span className="muted" style={{ width: 34 }}>Hull</span><span className={`bar ${hull < 0.4 ? 'red' : 'green'}`} style={{ flex: 1, height: 8 }}><i style={{ width: `${Math.round(hull * 100)}%` }} /></span></div>
                <div className="row" style={{ gap: 6 }}><span className="muted" style={{ width: 34 }}>Bilge</span><span className={`bar ${s.stats.bilge > 60 ? 'red' : ''}`} style={{ flex: 1, height: 8 }}><i style={{ width: `${Math.round(s.stats.bilge)}%` }} /></span></div>
              </div>
              <button className="btn small" disabled={full} onClick={() => board(s)}>{full ? 'Full' : 'Board'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
