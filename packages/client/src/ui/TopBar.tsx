import { useStore } from '../store';
import { ISLAND_BY_ID, STATION_INFO } from '@tidebound/shared';

export function TopBar() {
  const pirate = useStore((s) => s.pirate);
  const crew = useStore((s) => s.crew);
  const room = useStore((s) => s.room);
  const status = useStore((s) => s.status);
  const muted = useStore((s) => s.muted);
  const setMuted = useStore((s) => s.setMuted);
  const logout = useStore((s) => s.logout);
  if (!pirate) return null;
  let where = '';
  if (room?.kind === 'island') where = ISLAND_BY_ID[room.islandId]?.name ?? room.islandId;
  else if (room?.kind === 'ship') {
    const st = room.ship.status;
    where = `${room.ship.name} · ${st.kind === 'docked' ? `docked at ${ISLAND_BY_ID[st.islandId]?.name}` : st.kind === 'sailing' ? `bound for ${ISLAND_BY_ID[st.to]?.name}` : st.kind === 'battle' ? 'in battle!' : 'adrift'}`;
    if (pirate.location.kind === 'ship' && pirate.location.station) where += ` · ${STATION_INFO[pirate.location.station].name}`;
  }
  return (
    <div className="topbar">
      <div className="brand">Tidebound</div>
      <div className="stat"><span className="k">Pirate</span>{pirate.name}{crew && <span className="pill">{crew.name}</span>}</div>
      <div className="stat"><span className="k">PoE</span><span className="poe">{pirate.poe.toLocaleString()}</span></div>
      <div className="stat muted" style={{ fontWeight: 600 }}>{where}</div>
      <div className="spacer" />
      {status !== 'open' && <span className="tag bad">{status === 'connecting' ? 'reconnecting…' : 'offline'}</span>}
      <button className="btn ghost small" onClick={() => setMuted(!muted)} title="Toggle sound">{muted ? '🔇' : '🔊'}</button>
      <button className="btn ghost small" onClick={logout}>Sign out</button>
    </div>
  );
}
