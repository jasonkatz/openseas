import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BasePuzzleState, PuzzleId } from '@tidebound/shared';
import { getPuzzle, ratingLabel } from '@tidebound/shared';
import { puzzleViews } from '../puzzles/registry';

/** Dev-only: runs a puzzle engine locally (no server). Open /?puzzle=bilging&seed=7 */
export function LocalPuzzle({ id, seed }: { id: PuzzleId; seed: number }) {
  const def = getPuzzle(id);
  const View = puzzleViews[id];
  const stateRef = useRef<BasePuzzleState>(def.init(seed, { difficulty: 0.4, durationMs: 150000 }));
  const last = useRef<number | null>(null);
  const [, bump] = useState(0);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (last.current === null) last.current = t;
      const dt = Math.min(250, Math.floor(t - last.current));
      if (dt > 0) { last.current += dt; stateRef.current = def.tick(stateRef.current, dt); }
      bump((n) => n + 1);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [def]);

  useLayoutEffect(() => {
    const el = areaRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const dispatch = useCallback((a: unknown) => { stateRef.current = def.reduce(stateRef.current, a); }, [def]);
  const sc = def.score(stateRef.current);
  return (
    <div className="puzzle-host">
      <div className="puzzle-top"><span className="title">{def.name} (local)</span><span className="pill">{Math.round(sc.points)} pts</span><span className="tag gold">{ratingLabel(sc.performance)}</span></div>
      <div className="puzzle-area" ref={areaRef}>
        {View ? <View state={stateRef.current} dispatch={dispatch} width={size.w} height={size.h} now={performance.now()} focused others={id === 'swordfight' ? [{ id: 'x', name: 'Scurvy Pete', side: 1, state: def.init(seed + 1), ko: false, isSelf: false }, { id: 'y', name: 'Mad Nell', side: 1, state: def.init(seed + 2), ko: true, isSelf: false }] : undefined} /> : 'no view'}
      </div>
    </div>
  );
}
