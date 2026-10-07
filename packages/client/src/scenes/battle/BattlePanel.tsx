import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BATTLE_MAX_TURNS, SEGMENTS, emptyOrders,
  type BattleShip, type BattleState, type ClientMsg, type MoveToken, type ShipView, type TurnOrders,
} from '@tidebound/shared';
import { useStore, type BattleEnd } from '../../store';
import { BattleBoard } from './BattleBoard';

const TOKEN_CYCLE: MoveToken[] = [null, 'F', 'L', 'R'];
const PHASE_LABEL: Record<BattleState['phase'], string> = {
  orders: 'Give orders',
  resolving: 'Resolving',
  boarding: 'Boarding!',
  over: 'Battle over',
};

const rootStyle: CSSProperties = { display: 'flex', gap: 12, width: '100%', height: '100%', minHeight: 0, position: 'relative' };
const leftStyle: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, position: 'relative' };
const rightStyle: CSSProperties = { width: 300, flex: 'none', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto', paddingRight: 2 };
const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

/** Server-clock sampler: 'raf' re-renders every frame, a number re-renders at that interval (ms). */
function useServerClock(serverNow: () => number, mode: 'raf' | number): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    if (mode === 'raf') {
      const frame = (): void => { setNow(serverNow()); raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
    } else {
      setNow(serverNow());
      timer = setInterval(() => setNow(serverNow()), mode);
    }
    return () => { cancelAnimationFrame(raf); if (timer) clearInterval(timer); };
  }, [serverNow, mode]);
  return now;
}

function countTokens(moves: MoveToken[]): { L: number; F: number; R: number } {
  const out = { L: 0, F: 0, R: 0 };
  for (const m of moves) if (m) out[m]++;
  return out;
}
function countShots(shots: TurnOrders['shots']): number {
  let n = 0;
  for (const s of shots) { if (s.port) n++; if (s.starboard) n++; }
  return n;
}
function capitalise(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function BattlePanel(): React.JSX.Element {
  const battle = useStore((s) => s.battle);
  const room = useStore((s) => s.room);
  const battleEnd = useStore((s) => s.battleEnd);
  if (!battle || room?.kind !== 'ship') {
    return <ResultOrWaiting battleEnd={battleEnd} />;
  }
  return <BattlePanelInner battle={battle} ship={room.ship} />;
}

function ResultOrWaiting({ battleEnd }: { battleEnd: BattleEnd | null }): React.JSX.Element {
  const clearBattleEnd = useStore((s) => s.clearBattleEnd);
  return (
    <div style={{ ...rootStyle, alignItems: 'center', justifyContent: 'center' }}>
      {battleEnd ? <ResultCard end={battleEnd} onContinue={clearBattleEnd} /> : <div className="muted">Waiting for the battle to begin…</div>}
    </div>
  );
}

function BattlePanelInner({ battle, ship }: { battle: BattleState; ship: ShipView }): React.JSX.Element {
  const pirate = useStore((s) => s.pirate);
  const send = useStore((s) => s.send);
  const serverNow = useStore((s) => s.serverNow);
  const battleEnd = useStore((s) => s.battleEnd);
  const clearBattleEnd = useStore((s) => s.clearBattleEnd);
  const now = useServerClock(serverNow, 250);

  const myShipId = ship.id;
  const myShip = battle.ships.find((s) => s.id === myShipId) ?? battle.ships.find((s) => s.side === 0) ?? battle.ships[0];
  const mySide = myShip?.side ?? 0;
  const enemy = battle.ships.find((s) => s.side !== mySide);
  const captainId = ship.aboard.includes(ship.ownerId) ? ship.ownerId : ship.aboard[0] ?? null;
  const isCaptain = !!pirate && pirate.id === captainId;
  const ordersPhase = battle.phase === 'orders';
  const editing = isCaptain && ordersPhase;

  // ---- Orders editor state ----
  const [orders, setOrders] = useState<TurnOrders>(() => myShip?.orders ?? emptyOrders());
  const [ready, setReady] = useState(false);
  const turnKey = `${battle.id}:${battle.turn}`;
  const myShipRef = useRef(myShip);
  myShipRef.current = myShip;
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setOrders(myShipRef.current?.orders ?? emptyOrders());
    setReady(false);
    dirtyRef.current = false;
  }, [turnKey]);

  const sendOrders = useCallback((o: TurnOrders) => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    dirtyRef.current = false;
    const msg: ClientMsg = { t: 'battleOrders', moves: o.moves.slice(0, SEGMENTS), shots: o.shots.slice(0, SEGMENTS), grapple: o.grapple };
    send(msg);
  }, [send]);
  // Auto-send (debounced) so a timeout still resolves with the latest plan.
  useEffect(() => {
    if (!editing || !dirtyRef.current) return;
    debounceRef.current = setTimeout(() => sendOrders(orders), 300);
    return () => { if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; } };
  }, [orders, editing, sendOrders]);

  const edit = useCallback((fn: (o: TurnOrders) => TurnOrders) => {
    dirtyRef.current = true;
    setOrders((o) => fn(o));
  }, []);

  const tokens = myShip?.tokens ?? { L: 0, F: 0, R: 0 };
  const used = countTokens(orders.moves);
  const shotsUsed = countShots(orders.shots);
  const loaded = myShip?.loaded ?? 0;
  const cannons = myShip?.cannons ?? 0;
  const canAddShot = shotsUsed < loaded && cannons > 0;

  const cycleMove = (seg: number): void => edit((o) => {
    const cur = o.moves[seg] ?? null;
    const usedNow = countTokens(o.moves);
    let i = TOKEN_CYCLE.indexOf(cur);
    for (let k = 0; k < TOKEN_CYCLE.length; k++) {
      i = (i + 1) % TOKEN_CYCLE.length;
      const next = TOKEN_CYCLE[i] ?? null;
      if (next === null) break;
      const avail = tokens[next] - usedNow[next] + (cur === next ? 1 : 0);
      if (avail > 0) break;
    }
    const moves = o.moves.slice();
    moves[seg] = TOKEN_CYCLE[i] ?? null;
    return { ...o, moves };
  });
  const toggleShot = (seg: number, side: 'port' | 'starboard'): void => edit((o) => {
    const cur = o.shots[seg] ?? { port: false, starboard: false };
    const on = cur[side];
    if (!on && (countShots(o.shots) >= loaded || cannons <= 0)) return o;
    const shots = o.shots.slice();
    shots[seg] = { ...cur, [side]: !on };
    return { ...o, shots };
  });
  const clear = (): void => edit(() => emptyOrders());
  const sendNow = (): void => sendOrders(orders);
  const readyNow = (): void => { sendOrders(orders); send({ t: 'battleReady' }); setReady(true); };

  // Board preview: the captain's live plan while editing, otherwise the plan the server has.
  const preview: TurnOrders | undefined = editing ? orders : (myShip?.orders ?? undefined);

  const secondsLeft = Math.max(0, Math.ceil((battle.phaseEndsAt - now) / 1000));
  const showResult = battle.phase === 'over' || !!battleEnd;
  const log = battle.log.slice(-8);
  const planShown: TurnOrders | null = editing ? orders : (myShip?.orders ?? null);

  return (
    <div style={rootStyle}>
      <div style={leftStyle}>
        <BoardArea state={battle} myShipId={myShipId} preview={preview} serverNow={serverNow} />
      </div>

      <div style={rightStyle}>
        {/* Header */}
        <div className="card" style={sectionStyle}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Turn {battle.turn} / {BATTLE_MAX_TURNS}</h3>
            <span className={`tag ${battle.phase === 'orders' ? 'gold' : battle.phase === 'boarding' ? 'bad' : ''}`}>{PHASE_LABEL[battle.phase]}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="timer">{battle.phase === 'over' ? '—' : `${secondsLeft}s`}</span>
            {enemy && (
              <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
                <div style={{ fontWeight: 800, color: '#ffb3b3' }}>{enemy.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{capitalise(enemy.type)}{enemy.npc ? ' · brigand' : ''}</div>
              </div>
            )}
          </div>
        </div>

        {/* Ships */}
        <div className="card" style={sectionStyle}>
          {myShip && <HullRow ship={myShip} mine />}
          {enemy && <HullRow ship={enemy} mine={false} />}
          {myShip && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Move tokens</span>
                <span className="muted" style={{ fontSize: 12 }}>cannons loaded <b style={{ color: 'var(--text)' }}>{loaded - (editing ? shotsUsed : 0)}</b> / {cannons * 2}</span>
              </div>
              <div className="tokens">
                {(['L', 'F', 'R'] as const).map((k) => {
                  const left = tokens[k] - (editing ? used[k] : 0);
                  return (
                    <span key={k} className="row" style={{ gap: 4 }}>
                      <span className={`token ${k}${left <= 0 ? ' disabled' : ''}`} style={{ cursor: 'default', width: 28, height: 28, fontSize: 13 }}>{k}</span>
                      <b>{left}</b><span className="muted" style={{ fontSize: 12 }}>/{tokens[k]}</span>
                    </span>
                  );
                })}
              </div>
              <div className="bar gold" title="Cannons loaded"><i style={{ width: `${cannons > 0 ? (loaded / (cannons * 2)) * 100 : 0}%` }} /></div>
            </>
          )}
        </div>

        {/* Orders */}
        <div className="card" style={sectionStyle}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 18 }}>Orders</h3>
            {ordersPhase && !isCaptain && <span className="tag">Captain only</span>}
            {ready && ordersPhase && <span className="tag good">Ready</span>}
          </div>
          {ordersPhase || planShown ? (
            <div className="col" style={{ gap: 6 }}>
              {[0, 1, 2, 3].map((seg) => {
                const tok = planShown?.moves[seg] ?? null;
                const so = planShown?.shots[seg] ?? { port: false, starboard: false };
                return (
                  <div key={seg} className="seg">
                    <span className="muted" style={{ fontWeight: 800 }}>{seg + 1}</span>
                    <button
                      type="button"
                      className={`token ${tok ?? 'empty'}${editing ? '' : ' disabled'}`}
                      disabled={!editing}
                      title={editing ? 'Click to cycle: none → F → L → R' : undefined}
                      onClick={() => cycleMove(seg)}
                    >{tok ?? '·'}</button>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className={`shotbtn${so.port ? ' on' : ''}`} disabled={!editing || (!so.port && !canAddShot)} onClick={() => toggleShot(seg, 'port')}>Port</button>
                      <button type="button" className={`shotbtn${so.starboard ? ' on' : ''}`} disabled={!editing || (!so.starboard && !canAddShot)} onClick={() => toggleShot(seg, 'starboard')}>Starboard</button>
                    </div>
                  </div>
                );
              })}
              <label className="row" style={{ gap: 8, cursor: editing ? 'pointer' : 'default', marginTop: 2 }} title="Boards the enemy if we end the turn adjacent to them">
                <input type="checkbox" checked={!!planShown?.grapple} disabled={!editing} onChange={(e) => edit((o) => ({ ...o, grapple: e.target.checked }))} />
                <span style={{ fontWeight: 800 }}>Grapple</span>
                <span className="muted" style={{ fontSize: 12 }}>boards the enemy if adjacent after moving</span>
              </label>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>{battle.phase === 'resolving' ? 'Orders are being carried out…' : battle.phase === 'boarding' ? 'Grapples are thrown — to the swords!' : 'The fight is over.'}</div>
          )}
          {editing && (
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              <button type="button" className="btn ghost small" onClick={clear}>Clear</button>
              <button type="button" className="btn secondary small" onClick={sendNow}>Send orders</button>
              <button type="button" className="btn small" disabled={ready} onClick={readyNow}>{ready ? 'Waiting…' : 'Ready — resolve now'}</button>
            </div>
          )}
          {ordersPhase && !isCaptain && (
            <div className="muted" style={{ fontSize: 13 }}>
              <div>{planShown ? 'The captain has given orders.' : 'The captain is giving orders…'}</div>
              <div style={{ marginTop: 4 }}>Keep working your station — sails give move tokens, guns give shots, carpentry and bilge keep her afloat.</div>
            </div>
          )}
        </div>

        {/* Crews */}
        <div className="card" style={sectionStyle}>
          {myShip && <CrewList ship={myShip} mine />}
          {enemy && <CrewList ship={enemy} mine={false} />}
        </div>

        {/* Log */}
        <div className="card" style={{ ...sectionStyle, gap: 2, fontSize: 13 }}>
          <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Log</span>
          {log.length === 0 && <span className="muted">Nothing yet.</span>}
          {log.map((line, i) => (
            <div key={`${battle.log.length - log.length + i}`} className={i === log.length - 1 ? 'fell' : 'muted'} style={{ lineHeight: 1.3 }}>{line}</div>
          ))}
        </div>
      </div>

      {showResult && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,10,18,0.5)', borderRadius: 12, zIndex: 2 }}>
          <ResultCard end={battleEnd} state={battle} mySide={mySide} onContinue={clearBattleEnd} />
        </div>
      )}
    </div>
  );
}

function HullRow({ ship, mine }: { ship: BattleShip; mine: boolean }): React.JSX.Element {
  const ratio = Math.max(0, Math.min(1, ship.hull / Math.max(1, ship.maxHull)));
  return (
    <div style={sectionStyle}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <span style={{ fontWeight: 800, color: mine ? 'var(--parchment)' : '#ffb3b3' }}>{ship.name}{ship.sunk ? ' (sunk)' : ''}</span>
        <span className="muted">{ship.hull} / {ship.maxHull}</span>
      </div>
      <div className={`bar ${ratio > 0.5 ? 'green' : ratio > 0.25 ? 'gold' : 'red'}`}><i style={{ width: `${ratio * 100}%` }} /></div>
    </div>
  );
}

function CrewList({ ship, mine }: { ship: BattleShip; mine: boolean }): React.JSX.Element {
  return (
    <div style={{ fontSize: 13 }}>
      <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{mine ? 'Our crew' : 'Their crew'}</span>
      <div style={{ color: mine ? 'var(--text)' : 'var(--muted)' }}>{ship.crew.length > 0 ? ship.crew.join(', ') : '—'}</div>
    </div>
  );
}

function ResultCard({ end, state, mySide, onContinue }: { end: BattleEnd | null; state?: BattleState; mySide?: number; onContinue: () => void }): React.JSX.Element {
  let won: boolean | null = null;
  let title = 'Battle over';
  let summary = '';
  if (end) {
    won = end.won;
    summary = end.summary;
  } else if (state) {
    if (state.outcome === 'disengaged') { won = null; summary = 'The ships drift apart and the fight is broken off.'; }
    else if (state.winnerSide !== null && mySide !== undefined) {
      won = state.winnerSide === mySide;
      summary = state.outcome === 'sunk'
        ? (won ? 'The enemy slips beneath the waves!' : 'Your ship is lost to the deep.')
        : (won ? 'Their deck is yours after the boarding.' : 'Your deck was overrun.');
    }
  }
  if (won === true) title = 'Victory!';
  else if (won === false) title = 'Defeat';
  else if (end || state?.outcome === 'disengaged') title = 'Disengaged';
  const goods = end?.booty ? Object.entries(end.booty.goods).filter(([, n]) => (n ?? 0) > 0) : [];
  return (
    <div className="panel parchment" style={{ width: 'min(380px, 100%)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center' }}>
      <h2 style={{ fontSize: 40, lineHeight: 1 }}>{title}</h2>
      {summary && <p className="fell" style={{ fontSize: 16 }}>{summary}</p>}
      {end?.booty && (
        <div className="card" style={{ textAlign: 'left' }}>
          <div className="kv">
            <span className="k">Pieces of eight</span><b>{end.booty.poe}</b>
            {goods.map(([id, n]) => (<span key={id} className="k" style={{ display: 'contents' }}><span className="k">{capitalise(id)}</span><b>{n}</b></span>))}
          </div>
        </div>
      )}
      {end && !end.booty && won === true && <p className="muted">No booty this time — the hold was empty.</p>}
      <button type="button" className="btn" onClick={onContinue}>Continue</button>
    </div>
  );
}

function BoardArea({ state, myShipId, preview, serverNow }: { state: BattleState; myShipId: string; preview?: TurnOrders; serverNow: () => number }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = (): void => {
      const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const now = useServerClock(serverNow, 'raf');
  const side = Math.max(120, Math.min(size.w, size.h));
  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {size.w > 0 && size.h > 0 && <BattleBoard state={state} myShipId={myShipId} width={side} height={side} now={now} preview={preview} />}
    </div>
  );
}
