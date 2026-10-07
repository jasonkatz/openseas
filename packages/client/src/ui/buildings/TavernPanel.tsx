import { useEffect, useState } from 'react';
import type { PuzzleId } from '@tidebound/shared';
import { PUZZLE_IDS, STATION_INFO } from '@tidebound/shared';
import { useStore } from '../../store';
import { play } from '../../lib/audio';
import { Tag } from './Tag';

type Tab = 'crews' | 'leaderboard' | 'practice' | 'duel';

export function TavernPanel() {
  const [tab, setTab] = useState<Tab>('crews');
  const send = useStore((s) => s.send);
  useEffect(() => { send({ t: 'listCrews' }); send({ t: 'leaderboard' }); }, [send]);

  return (
    <div className="col">
      <div className="row" style={{ gap: 6 }}>
        {(['crews', 'duel', 'leaderboard', 'practice'] as Tab[]).map((t) => (
          <button key={t} className={`btn small ${tab === t ? '' : 'ghost'}`} style={tab === t ? undefined : { color: 'var(--ink)', borderColor: '#8a6a3c' }} onClick={() => { play('tap'); setTab(t); }}>
            {t === 'crews' ? 'Crews' : t === 'duel' ? 'Duel' : t === 'leaderboard' ? 'Leaderboard' : 'Practice'}
          </button>
        ))}
      </div>
      {tab === 'crews' && <CrewsTab />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'practice' && <PracticeTab />}
      {tab === 'duel' && <DuelTab />}
    </div>
  );
}

function CrewsTab() {
  const crew = useStore((s) => s.crew);
  const crews = useStore((s) => s.crews);
  const pirate = useStore((s) => s.pirate);
  const send = useStore((s) => s.send);
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');

  if (crew) {
    return (
      <div className="card col">
        <div className="row"><h3 style={{ flex: 1 }}>{crew.name}</h3>{crew.captainId === pirate?.id && <Tag variant="gold">Captain</Tag>}</div>
        {crew.motto && <p className="fell" style={{ fontStyle: 'italic' }}>“{crew.motto}”</p>}
        <div className="kv">
          <span className="k">Members</span><span>{crew.members.length}</span>
          <span className="k">Fame</span><span>{crew.fame.toLocaleString()}</span>
          <span className="k">Treasury</span><span>{crew.treasury.toLocaleString()} PoE</span>
        </div>
        <div><button className="btn danger small" onClick={() => { play('tap'); send({ t: 'leaveCrew' }); }}>Leave crew</button></div>
      </div>
    );
  }

  const found = () => {
    const n = name.trim();
    if (n.length < 2) return;
    play('tap');
    send({ t: 'createCrew', name: n, motto: motto.trim() || undefined });
    setName(''); setMotto('');
  };

  return (
    <div className="col">
      <h3>Crews hiring</h3>
      {crews.length === 0 && <div className="muted">No crews yet — found the first one below.</div>}
      <div className="list">
        {crews.map((c) => (
          <div key={c.id} className="list-item">
            <div style={{ flex: 1 }}>
              <b>{c.name}</b>{c.motto && <span className="muted"> — {c.motto}</span>}
              <div className="muted" style={{ fontSize: 12 }}>{c.members.length} members · fame {c.fame.toLocaleString()}</div>
            </div>
            <button className="btn small" onClick={() => { play('tap'); send({ t: 'joinCrew', crewId: c.id }); }}>Join</button>
          </div>
        ))}
      </div>
      <div className="card col">
        <h3>Found a crew</h3>
        <input className="input" placeholder="Crew name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') found(); }} />
        <input className="input" placeholder="Motto (optional)" value={motto} maxLength={60} onChange={(e) => setMotto(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') found(); }} />
        <div><button className="btn small" disabled={name.trim().length < 2} onClick={found}>Raise the colours</button></div>
      </div>
    </div>
  );
}

function LeaderboardTab() {
  const rows = useStore((s) => s.leaderboard);
  return (
    <div className="col">
      <h3>Leaderboard</h3>
      {rows.length === 0 && <div className="muted">No scores posted yet. Go run a shift.</div>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #8a6a3c' }}>
              <th style={{ padding: '4px 6px' }}>Pirate</th><th style={{ padding: '4px 6px' }}>Puzzle</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Best</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}:${r.puzzle}:${i}`} style={{ borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                <td style={{ padding: '4px 6px' }}><b>{r.name}</b></td>
                <td style={{ padding: '4px 6px' }}>{STATION_INFO[r.puzzle].icon} {STATION_INFO[r.puzzle].name}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{Math.round(r.best).toLocaleString()}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{Math.round(r.rating * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PracticeTab() {
  const startPuzzle = useStore((s) => s.startPuzzle);
  const setOpenBuilding = useStore((s) => s.setOpenBuilding);
  const pending = useStore((s) => s.puzzlePending);
  const go = (id: PuzzleId) => { play('tap'); setOpenBuilding(null); startPuzzle(id, true); };
  return (
    <div className="col">
      <h3>Practice</h3>
      <p className="muted">Learn the duty puzzles at your own pace. Practice pays a little, but counts for nothing on a ship.</p>
      <div className="station-grid">
        {PUZZLE_IDS.map((id) => (
          <button key={id} className="station" style={{ color: 'var(--ink)', background: 'rgba(255,255,255,0.3)', borderColor: '#b08f5c', textAlign: 'left' }} disabled={pending !== null} onClick={() => go(id)}>
            <span className="name"><span style={{ fontSize: 20 }}>{STATION_INFO[id].icon}</span>{STATION_INFO[id].name}</span>
            <span className="who" style={{ color: '#7a6442' }}>{STATION_INFO[id].verb}{id === 'swordfight' ? ' (vs. a brigand)' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DuelTab() {
  const presence = useStore((s) => s.presence);
  const pirate = useStore((s) => s.pirate);
  const send = useStore((s) => s.send);
  const others = presence.filter((p) => p.id !== pirate?.id);
  return (
    <div className="col">
      <h3>Duels</h3>
      <p className="muted">Cross blades with anyone on the island — a friendly swordfight for honour and a little coin. Islanders never refuse.</p>
      {others.length === 0 && <p className="muted">Nobody else is about. Try the practice yard.</p>}
      <div className="list">
        {others.map((p) => (
          <div key={p.id} className="list-item">
            <b>{p.name}</b>
            <span className="muted" style={{ fontSize: 12 }}>{p.id.startsWith('bot') ? 'islander' : p.title ?? 'pirate'}{p.crewName ? ` · ${p.crewName}` : ''}</span>
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => { play('sword'); send({ t: 'duelChallenge', pirateId: p.id }); }}>Challenge</button>
          </div>
        ))}
      </div>
    </div>
  );
}
