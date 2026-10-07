import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SwordfightView } from '@tidebound/shared';
import { getPuzzle, ratingLabel } from '@tidebound/shared';
import { useStore } from '../store';
import { puzzleViews } from '../puzzles/registry';
import { play } from '../lib/audio';

/**
 * Boarding action: a server-authoritative multi-board swordfight. The server
 * streams snapshots at ~10Hz; we predict our own board forward between
 * snapshots (ticking the deterministic engine locally and applying our inputs
 * optimistically) so the falling pair feels responsive.
 */
export function SwordfightScene({ view }: { view: SwordfightView }) {
  const pirate = useStore((s) => s.pirate);
  const send = useStore((s) => s.send);
  const clear = useStore((s) => s.clearSwordfight);
  const def = getPuzzle('swordfight');
  const View = puzzleViews.swordfight;
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [, bump] = useState(0);
  const predicted = useRef<unknown>(null);
  const snapAt = useRef(0);
  const lastTick = useRef(0);
  const [focused, setFocused] = useState(true);
  const startedRef = useRef(false);

  const me = view.players.find((p) => p.pirateId === pirate?.id);
  const mySide = me?.side ?? 0;

  // Adopt each new snapshot of our board.
  useEffect(() => {
    if (!me) return;
    predicted.current = me.state;
    snapAt.current = performance.now();
    lastTick.current = snapAt.current;
  }, [me, me?.state]);

  useEffect(() => { if (!startedRef.current) { startedRef.current = true; play('sword'); } }, []);
  useEffect(() => { if (view.phase === 'over') play(view.winnerSide === mySide ? 'win' : 'lose'); }, [view.phase, view.winnerSide, mySide]);

  // Local prediction loop.
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (predicted.current && view.phase === 'fighting') {
        const dt = Math.min(200, Math.floor(t - lastTick.current));
        if (dt > 0) {
          lastTick.current += dt;
          predicted.current = def.tick(predicted.current as never, dt);
        }
      }
      bump((n) => n + 1);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [def, view.phase]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFocus = () => setFocused(!(document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')));
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', () => setTimeout(onFocus, 0));
    return () => document.removeEventListener('focusin', onFocus);
  }, []);

  const dispatch = useCallback((a: unknown) => {
    if (view.phase !== 'fighting' || !me || me.ko) return;
    send({ t: 'sfAction', action: a });
    if (predicted.current) predicted.current = def.reduce(predicted.current as never, a as never);
  }, [def, me, send, view.phase]);

  const others = view.players.map((p) => ({ id: p.pirateId, name: p.name, side: p.side, state: p.state as never, ko: p.ko, isSelf: p.pirateId === pirate?.id }));
  const myState = (predicted.current ?? me?.state ?? view.players[0]?.state) as never;
  const remaining = Math.max(0, view.endsAt - useStore.getState().serverNow());
  const alive = (side: number) => view.players.filter((p) => p.side === side && !p.ko).length;
  const sc = myState ? def.score(myState) : null;

  return (
    <div className="puzzle-host" style={{ zIndex: 45 }} onMouseDown={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }}>
      <div className="puzzle-top">
        <span className="title">⚔️ Boarding action</span>
        <span className="pill" style={{ borderColor: '#29c6d6' }}>{view.sides[0]} · {alive(0)} standing</span>
        <span className="muted">vs</span>
        <span className="pill" style={{ borderColor: '#e5484d' }}>{view.sides[1]} · {alive(1)} standing</span>
        {sc && <span className={`tag ${sc.performance >= 0.6 ? 'good' : 'gold'}`}>{ratingLabel(sc.performance)}</span>}
        <span className="muted">{Math.ceil(remaining / 1000)}s</span>
        <span style={{ flex: 1 }} />
        {view.phase === 'over' && <button className="btn small" onClick={clear}>Continue</button>}
      </div>
      <div className="puzzle-area" ref={areaRef}>
        {View && myState ? <View state={myState} dispatch={dispatch} width={size.w} height={size.h} now={performance.now()} focused={focused && view.phase === 'fighting' && !me?.ko} others={others} />
          : <div className="muted">Loading the fight…</div>}
        {view.phase === 'over' && (
          <div className="modal-backdrop" style={{ position: 'absolute' }}>
            <div className="panel parchment modal" style={{ width: 400 }}>
              <div className="panel-body result">
                <div className="big">{view.winnerSide === mySide ? 'Victory!' : 'Repelled!'}</div>
                <p className="fell">{view.winnerSide === mySide ? 'The enemy deck is yours. Booty is being hauled aboard.' : 'The brigands hold their deck. Back to your own ship, and quickly.'}</p>
                <button className="btn" onClick={clear}>Continue</button>
              </div>
            </div>
          </div>
        )}
        {me?.ko && view.phase === 'fighting' && (
          <div className="prompt" style={{ bottom: 20 }}>You are down! Cheer on your crewmates…</div>
        )}
      </div>
    </div>
  );
}
