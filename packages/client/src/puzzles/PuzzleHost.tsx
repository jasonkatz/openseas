import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BasePuzzleState, LogEntry } from '@tidebound/shared';
import { getPuzzle, ratingLabel, SHIP_TYPES, STATION_INFO } from '@tidebound/shared';
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
        {View ? <View state={st} dispatch={dispatch} width={size.w} height={size.h} now={performance.now()} focused={focused && !finished} />
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
    <div className="row" style={{ gap: 10, fontSize: 12 }}>
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
