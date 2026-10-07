import { useState } from 'react';
import type { PuzzleId, CommodityId } from '@tidebound/shared';
import { COMMODITIES, ISLANDS, ISLAND_BY_ID, SHIP_TYPES, STATIONS, STATION_INFO, ratingLabel } from '@tidebound/shared';
import { useStore } from '../../store';
import { OceanMap } from '../../ui/OceanMap';
import { play } from '../../lib/audio';

export function ShipPanel({ onTakeStation }: { onTakeStation: (id: PuzzleId) => void }) {
  const room = useStore((s) => s.room);
  const pirate = useStore((s) => s.pirate);
  const send = useStore((s) => s.send);
  const [chart, setChart] = useState(false);
  const [trade, setTrade] = useState(false);
  const [dest, setDest] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 700);
  if (room?.kind !== 'ship' || !pirate) return null;
  const ship = room.ship;
  const type = SHIP_TYPES[ship.type];
  const captain = ship.aboard.includes(ship.ownerId) ? ship.ownerId : ship.aboard[0];
  const isCaptain = captain === pirate.id;
  const hull = Math.max(0, 1 - ship.stats.damage / type.hull);
  const st = ship.status;
  const remaining = st.kind === 'sailing' ? st.path.length - st.index : 0;
  const myStation = pirate.location.kind === 'ship' ? pirate.location.station : null;

  return (
    <div className="overlay-right">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>{ship.name}</h3>
            <div className="muted" style={{ fontSize: 12 }}>{type.name} · {ship.ownerId === 'navy' ? 'Navy vessel' : `Owner: ${ship.crewNames[ship.ownerId] ?? 'ashore'}`} · Captain: {captain ? ship.crewNames[captain] : '—'}</div>
          </div>
          <button className="btn ghost small x" onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▸' : '▾'}</button>
        </div>
        {!collapsed && <div className="panel-body col">
          <div className="kv">
            <span className="k">Status</span>
            <span>
              {st.kind === 'docked' && <>Docked at <b>{ISLAND_BY_ID[st.islandId]?.name}</b></>}
              {st.kind === 'sailing' && <>Bound for <b>{ISLAND_BY_ID[st.to]?.name}</b> · {remaining} league{remaining === 1 ? '' : 's'} to go</>}
              {st.kind === 'battle' && <span className="tag bad">In battle!</span>}
              {st.kind === 'adrift' && 'Adrift'}
            </span>
          </div>
          {st.kind === 'sailing' && <div className="bar gold"><i style={{ width: `${Math.round(((st.index + st.progress) / st.path.length) * 100)}%` }} /></div>}
          <Stat label="Hull" v={hull} cls={hull < 0.4 ? 'red' : 'green'} hint={`${Math.round(ship.stats.damage)} damage`} />
          <Stat label="Bilge" v={ship.stats.bilge / 100} cls={ship.stats.bilge > 60 ? 'red' : ''} hint={`${Math.round(ship.stats.bilge)}% water`} />
          <Stat label="Sails" v={ship.stats.sailPower} cls="gold" hint={ratingLabel(ship.stats.sailPower)} />
          <Stat label="Helm" v={ship.stats.nav} cls="gold" hint={ratingLabel(ship.stats.nav)} />
          <div className="kv"><span className="k">Guns</span><span>{ship.stats.loaded} / {type.cannons * 2} loaded</span></div>
          <div className="kv"><span className="k">Hold</span><span>{Object.entries(ship.hold.goods).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty'}</span></div>

          <h3 style={{ marginTop: 6 }}>Stations</h3>
          <div className="station-grid">
            {STATIONS.map((id) => {
              const who = ship.stations[id];
              const mine = who === pirate.id;
              const taken = !!who && !mine;
              const duty = who ? ship.duty[who] : undefined;
              const hand = who ? ship.hands.find((h) => h.id === who) : undefined;
              return (
                <div key={id} className={`station ${mine ? 'mine' : ''} ${taken && !hand ? 'taken' : ''}`} onClick={() => (!taken || hand) && onTakeStation(id)} title={STATION_INFO[id].verb}>
                  <div className="name">{STATION_INFO[id].icon} {STATION_INFO[id].name}</div>
                  <div className="who">{who ? `${ship.crewNames[who] ?? '?'}${hand ? ' (hand)' : ''}${duty !== undefined ? ` · ${ratingLabel(duty)}` : ''}` : 'open — click to work'}</div>
                  {!who && isCaptain && <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); play('coin'); send({ t: 'hireHand', station: id as Exclude<PuzzleId, 'swordfight'> }); }}>Hire hand · 150</button>}
                  {hand && isCaptain && <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); send({ t: 'dismissHand', handId: hand.id }); }}>Dismiss</button>}
                </div>
              );
            })}
          </div>
          {myStation && <button className="btn secondary small" onClick={() => { play('tap'); send({ t: 'takeStation', station: null }); }}>Leave station</button>}

          <h3 style={{ marginTop: 6 }}>Crew aboard ({ship.aboard.length + ship.hands.length}/{type.maxCrew})</h3>
          <div className="list">
            {ship.aboardPirates.map((p) => (
              <div key={p.id} className="list-item" style={{ padding: '4px 8px' }}>
                <span>{p.name}{p.id === captain ? ' ⭐' : ''}</span>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{STATIONS.find((s) => ship.stations[s] === p.id) ? STATION_INFO[STATIONS.find((s) => ship.stations[s] === p.id)!].name : 'idle'}</span>
              </div>
            ))}
          </div>

          <div className="row wrap" style={{ marginTop: 6 }}>
            {isCaptain && st.kind === 'docked' && <button className="btn" onClick={() => { play('tap'); setChart(true); }}>🗺 Set sail</button>}
            {isCaptain && st.kind === 'docked' && <button className="btn secondary" onClick={() => setTrade(true)}>⚖ Trade hold</button>}
            {isCaptain && st.kind === 'sailing' && remaining <= 1 && <button className="btn" onClick={() => send({ t: 'dock' })}>⚓ Dock</button>}
            {st.kind === 'docked' && <button className="btn secondary" onClick={() => { play('tap'); send({ t: 'leaveShip' }); }}>Go ashore</button>}
            {!isCaptain && st.kind === 'docked' && <span className="muted" style={{ fontSize: 12 }}>Waiting for the captain to set sail.</span>}
          </div>
        </div>}
      </div>

      {chart && (
        <div className="modal-backdrop" style={{ zIndex: 45 }} onClick={() => setChart(false)}>
          <div className="panel parchment modal" style={{ width: 'min(900px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="panel-head"><h2>Set a course</h2><span className="muted">Click an island</span><button className="btn ghost small x" onClick={() => setChart(false)}>✕</button></div>
            <div className="panel-body col">
              <OceanMap width={Math.min(860, window.innerWidth - 80)} height={Math.min(520, window.innerHeight - 220)} ship={ship} selected={dest} highlight={st.kind === 'docked' ? st.islandId : null} onPick={(id) => { play('tap'); setDest(id); }} />
              <div className="row wrap">
                {ISLANDS.map((i) => <button key={i.id} className={`btn small ${dest === i.id ? '' : 'ghost'}`} style={dest === i.id ? {} : { color: '#4a2f12' }} onClick={() => setDest(i.id)} disabled={st.kind === 'docked' && st.islandId === i.id}>{i.name}</button>)}
              </div>
              {dest && <p className="fell">{ISLAND_BY_ID[dest]?.name}: <i>{ISLAND_BY_ID[dest]?.tagline}</i>. Beware brigands on the open water — take your stations!</p>}
              <button className="btn" disabled={!dest} onClick={() => { if (dest) { send({ t: 'setSail', islandId: dest }); play('bell'); setChart(false); } }}>⚓ Anchors aweigh</button>
            </div>
          </div>
        </div>
      )}
      {trade && st.kind === 'docked' && <TradeModal islandId={st.islandId} onClose={() => setTrade(false)} />}
    </div>
  );
}

function Stat({ label, v, cls, hint }: { label: string; v: number; cls: string; hint: string }) {
  return (
    <div className="kv" style={{ alignItems: 'center' }}>
      <span className="k">{label}</span>
      <span className="row"><span className={`bar ${cls}`} style={{ flex: 1 }}><i style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} /></span><span className="muted" style={{ fontSize: 11, width: 80, textAlign: 'right' }}>{hint}</span></span>
    </div>
  );
}

function TradeModal({ islandId, onClose }: { islandId: string; onClose: () => void }) {
  const room = useStore((s) => s.room);
  const pirate = useStore((s) => s.pirate);
  const send = useStore((s) => s.send);
  const [qty, setQty] = useState(10);
  if (room?.kind !== 'ship' || !pirate) return null;
  const isl = ISLAND_BY_ID[islandId]!;
  const ship = room.ship;
  const held = (c: CommodityId) => ship.hold.goods[c] ?? 0;
  const total = Object.values(ship.hold.goods).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <div className="modal-backdrop" style={{ zIndex: 45 }} onClick={onClose}>
      <div className="panel parchment modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2>{isl.market ? 'Market' : ''} at {isl.name}</h2><span className="muted">Hold {total}/{SHIP_TYPES[ship.type].holdSize}</span><button className="btn ghost small x" onClick={onClose}>✕</button></div>
        <div className="panel-body col">
          <div className="row"><span>Quantity</span>{[1, 10, 25].map((q) => <button key={q} className={`btn small ${qty === q ? '' : 'ghost'}`} style={qty === q ? {} : { color: '#4a2f12' }} onClick={() => setQty(q)}>{q}</button>)}<span className="muted" style={{ marginLeft: 'auto' }}>You have {pirate.poe.toLocaleString()} PoE</span></div>
          <div className="list">
            {COMMODITIES.map((c) => {
              const price = isl.market[c.id];
              const tag = price < c.base * 0.85 ? 'cheap' : price > c.base * 1.2 ? 'dear' : '';
              return (
                <div key={c.id} className="list-item">
                  <b style={{ width: 70 }}>{c.name}</b>
                  <span>{price} PoE {tag && <span className={`tag ${tag === 'cheap' ? 'good' : 'bad'}`}>{tag}</span>}</span>
                  <span className="muted" style={{ marginLeft: 'auto' }}>holding {held(c.id)}</span>
                  <button className="btn small" onClick={() => send({ t: 'trade', commodity: c.id, qty, side: 'buy' })}>Buy</button>
                  <button className="btn small secondary" disabled={held(c.id) === 0} onClick={() => send({ t: 'trade', commodity: c.id, qty: Math.min(qty, held(c.id)), side: 'sell' })}>Sell</button>
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Buy where it's cheap, sail, sell where it's dear. Booty from brigands lands in the hold too.</p>
        </div>
      </div>
    </div>
  );
}
