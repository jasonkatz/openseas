import { PUZZLE_IDS, STATION_INFO, ratingLabel } from '@tidebound/shared';
import { useStore } from '../../store';
import { Tag } from './Tag';

export function BankPanel() {
  const pirate = useStore((s) => s.pirate);
  const crew = useStore((s) => s.crew);
  if (!pirate) return null;
  return (
    <div className="col">
      <div className="card">
        <div className="kv">
          <span className="k">Pirate</span><span><b>{pirate.name}</b> <Tag variant="gold">{pirate.title}</Tag></span>
          <span className="k">Pieces of eight</span><span style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#6a4b16', lineHeight: 1 }}>{pirate.poe.toLocaleString()}</span>
          <span className="k">Crew</span><span>{crew ? <>{crew.name} · fame {crew.fame.toLocaleString()}</> : <span className="muted">none — visit the tavern</span>}</span>
        </div>
      </div>
      <h3>Service record</h3>
      <div className="list">
        {PUZZLE_IDS.map((id) => {
          const st = pirate.stats[id];
          const rating = st?.rating ?? 0;
          return (
            <div key={id} className="list-item" style={{ gap: 12 }}>
              <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{STATION_INFO[id].icon}</span>
              <div style={{ flex: 1 }}>
                <div className="row"><b style={{ flex: 1 }}>{STATION_INFO[id].name}</b><span className="muted" style={{ fontSize: 12 }}>{st?.games ?? 0} games · best {Math.round(st?.best ?? 0).toLocaleString()}</span></div>
                <div className="row" style={{ gap: 8 }}>
                  <span className={`bar ${rating >= 0.7 ? 'green' : rating < 0.3 ? 'red' : 'gold'}`} style={{ flex: 1 }}><i style={{ width: `${Math.round(rating * 100)}%` }} /></span>
                  <span style={{ fontSize: 12, width: 86, textAlign: 'right' }}>{Math.round(rating * 100)}% {ratingLabel(rating)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
