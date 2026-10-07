import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BasePuzzleState, LogEntry } from '@tidebound/shared';
import { aiChoose, garbagePatternFor, getPuzzle, ratingLabel, rngFromSeed, SHIP_TYPES, STATION_INFO, type Rng, type swordfight as SF } from '@tidebound/shared';
import { useStore, type ActivePuzzle } from '../store';
import { puzzleViews } from './registry';
import { play } from '../lib/audio';

const CHECKPOINT_MS = 4000;
const MAX_FRAME_DT = 250;

/**
 * Runs a puzzle engine locally at animation-frame rate, records every action with
 * its elapsed time, and streams checkpoints to the server for verification.
 */
export function PuzzleHost({ active }: { active: ActivePuzzle }) {
  const def = getPuzzle(active.puzzle);
  const View = puzzleViews[active.puzzle];
  const send = useStore((s) => s.send);
  const endPuzzle = useStore((s) => s.endPuzzle);
  const room = useStore((s) => s.room);
  const stateRef = useRef<BasePuzzleState>(def.init(active.seed, active.config));
  const elapsedRef = useRef(0);
  const logRef = useRef<LogEntry[]>([]);
  const sentRef = useRef(0);
  const lastCkRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  /** Practice swordfights get a local brigand opponent driven by the engine's AI. */
  const oppRef = useRef<{ state: SF.State; rng: Rng; lastAi: number; name: string; skill: number; mySeq: number; wins: number } | null>(
    active.puzzle === 'swordfight' ? { state: getPuzzle('swordfight').init((active.seed ^ 0x5bd1e995) >>> 0, active.config), rng: rngFromSeed((active.seed + 7) >>> 0), lastAi: 0, name: BRIGANDS[active.seed % BRIGANDS.length]!, skill: 0.4, mySeq: 0, wins: 0 } : null,
  );
  const [, bump] = useState(0);
  const [finished, setFinished] = useState(false);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [focused, setFocused] = useState(true);
  const areaRef = useRef<HTMLDivElement>(null);

  const checkpoint = useCallback((final = false) => {
    const st = stateRef.current;
    const sc = def.score(st);
    const entries = logRef.current.slice(sentRef.current);
    sentRef.current = logRef.current.length;
    send({ t: 'puzzleCheckpoint', sessionId: active.sessionId, entries, elapsedMs: elapsedRef.current, points: sc.points, performance: sc.performance });
    lastCkRef.current = elapsedRef.current;
    if (final) finishedRef.current = true;
  }, [active.sessionId, def, send]);

  // Main loop.
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (finishedRef.current) { bump((n) => n + 1); return; }
      if (lastFrameRef.current === null) lastFrameRef.current = t;
      let dt = Math.floor(t - lastFrameRef.current);
      if (dt <= 0) { bump((n) => n + 1); return; }
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      lastFrameRef.current += dt;
      const next = def.tick(stateRef.current, dt);
      stateRef.current = next;
      elapsedRef.current += dt;
      const opp = oppRef.current;
      if (opp && !def.isOver(stateRef.current)) {
        const sdef = getPuzzle('swordfight') as unknown as { tick: (s: SF.State, dt: number) => SF.State; reduce: (s: SF.State, a: unknown) => SF.State };
        opp.state = sdef.tick(opp.state, dt);
        opp.lastAi += dt;
        if (!opp.state.ko && opp.lastAi >= 900 - opp.skill * 500) {
          opp.lastAi = 0;
          let actions: unknown[];
          [opp.rng, actions] = aiChoose(opp.state, opp.rng, opp.skill);
          for (const a of actions) opp.state = sdef.reduce(opp.state, a);
        }
        // Their attacks land on me (as logged actions so the server replay matches).
        const theirs = opp.state.outgoing;
        if (theirs.length > 0) {
          const [drained, attacks] = sfDrain(opp.state);
          opp.state = drained;
          for (const atk of attacks) {
            let pattern: number[][];
            [opp.rng, pattern] = garbagePatternFor(atk.power, opp.rng);
            if (pattern.length > 0) dispatchRef.current({ type: 'garbage', pattern });
          }
        }
        // My attacks land on them.
        const mine = (stateRef.current as unknown as SF.State).outgoing ?? [];
        for (const atk of mine) {
          if (atk.seq <= opp.mySeq) continue;
          opp.mySeq = atk.seq;
          let pattern: number[][];
          [opp.rng, pattern] = garbagePatternFor(atk.power, opp.rng);
          if (pattern.length > 0) opp.state = sdef.reduce(opp.state, { type: 'garbage', pattern });
        }
        if (opp.state.ko) {
          // Next brigand steps up, a little sharper than the last.
          opp.wins++;
          play('win');
          opp.name = BRIGANDS[(active.seed + opp.wins) % BRIGANDS.length]!;
          opp.skill = Math.min(0.9, opp.skill + 0.12);
          opp.state = getPuzzle('swordfight').init((active.seed + opp.wins * 7919) >>> 0, active.config) as SF.State;
          opp.mySeq = 0;
        }
      }
      if (def.isOver(next)) {
        checkpoint(true);
        setFinished(true);
        play('bell');
      } else if (elapsedRef.current - lastCkRef.current >= CHECKPOINT_MS) {
        checkpoint();
      }
      bump((n) => n + 1);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [def, checkpoint]);

  // Size tracking.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  // Focus: puzzles own the keyboard unless the chat input is focused.
  useEffect(() => {
    const onFocus = () => setFocused(!(document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')));
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', () => setTimeout(onFocus, 0));
    return () => { document.removeEventListener('focusin', onFocus); };
  }, []);

  // Flush on unmount (e.g. navigating away).
  useEffect(() => () => { if (!finishedRef.current) { try { checkpoint(true); } catch { /* ignore */ } } }, [checkpoint]);

  const dispatch = useCallback((a: unknown) => {
    if (finishedRef.current) return;
    const prev = stateRef.current;
    const next = def.reduce(prev, a);
    if (next === prev) return;
    stateRef.current = next;
    logRef.current.push({ at: elapsedRef.current, a });
    if (def.isOver(next)) { checkpoint(true); setFinished(true); }
  }, [def, checkpoint]);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const st = stateRef.current;
  const sc = def.score(st);
  const ship = room?.kind === 'ship' ? room.ship : null;
  const remaining = Math.max(0, (active.config.durationMs ?? 150000) - elapsedRef.current);

  return (
    <div className="puzzle-host" onMouseDown={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }}>
      <div className="puzzle-top">
        <span className="title">{STATION_INFO[active.puzzle].icon} {def.name}</span>
        <span className="muted" style={{ fontSize: 13 }}>{active.practice ? 'Practice' : 'On duty'}</span>
        <span className="pill">{Math.round(sc.points).toLocaleString()} pts</span>
        <span className={`tag ${sc.performance >= 0.7 ? 'good' : sc.performance < 0.3 ? 'bad' : 'gold'}`}>{ratingLabel(sc.performance)}</span>
        <span className="muted">{fmt(remaining)}</span>
        {ship && <ShipStrip ship={ship} />}
        <span style={{ flex: 1 }} />
        <button className="btn ghost small" onClick={() => endPuzzle()}>{finished ? 'Done' : 'Leave shift'}</button>
      </div>
      <div className="puzzle-area" ref={areaRef}>
        {View ? <View state={st} dispatch={dispatch} width={size.w} height={size.h} now={performance.now()} focused={focused && !finished}
          others={oppRef.current ? [{ id: 'brigand', name: `${oppRef.current.name}${oppRef.current.wins ? ` (#${oppRef.current.wins + 1})` : ''}`, side: 1, state: oppRef.current.state, ko: oppRef.current.state.ko, isSelf: false }] : undefined} />
          : <div className="muted">No renderer for {active.puzzle}</div>}
        {finished && (
          <div className="modal-backdrop" style={{ position: 'absolute' }}>
            <div className="panel parchment modal" style={{ width: 380 }}>
              <div className="panel-body result">
                <div className="big">{ratingLabel(sc.performance)}</div>
                <div className="pts">{Math.round(sc.points).toLocaleString()} points</div>
                <p className="muted">Shift over. The quartermaster is tallying your pay…</p>
                <button className="btn" onClick={() => endPuzzle()}>Collect</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShipStrip({ ship }: { ship: { stats: { damage: number; bilge: number; sailPower: number; loaded: number }; type: keyof typeof SHIP_TYPES; status: { kind: string } } }) {
  const t = SHIP_TYPES[ship.type];
  const hull = Math.max(0, 1 - ship.stats.damage / t.hull);
  return (
    <div className="row shipstrip" style={{ gap: 10, fontSize: 12 }}>
      <Mini label="Hull" v={hull} cls={hull < 0.4 ? 'red' : 'green'} />
      <Mini label="Bilge" v={ship.stats.bilge / 100} cls={ship.stats.bilge > 60 ? 'red' : ''} />
      <Mini label="Sails" v={ship.stats.sailPower} cls="gold" />
      <span className="muted">Guns {ship.stats.loaded}/{t.cannons * 2}</span>
      {ship.status.kind === 'battle' && <span className="tag bad">Battle!</span>}
    </div>
  );
}

function Mini({ label, v, cls }: { label: string; v: number; cls: string }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className="muted">{label}</span>
      <span className={`bar ${cls}`} style={{ width: 54, height: 8 }}><i style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} /></span>
    </span>
  );
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const BRIGANDS = ['Scurvy Pete', 'One-Eyed Marla', 'Mad Hob', 'Red Nell', 'Old Grell', 'Bloody Tam', 'Quiet Bess', 'Lazy Finn', 'Sharp Ysolde', 'Cap\'n Rook'];

function sfDrain(s: SF.State): [SF.State, { power: number; seq: number }[]] {
  return [{ ...s, outgoing: [] }, s.outgoing];
}
