import { useEffect } from 'react';
import { STATION_INFO, ratingLabel } from '@tidebound/shared';
import { useStore, type PuzzleReward } from '../store';
import { play } from '../lib/audio';

export function RewardModal({ reward }: { reward: PuzzleReward }) {
  const clear = useStore((s) => s.clearReward);
  const puzzleOpen = useStore((s) => !!s.puzzle);
  useEffect(() => { play(reward.performance >= 0.5 ? 'win' : 'coin'); }, [reward]);
  if (puzzleOpen) return null;
  const label = ratingLabel(reward.performance);
  return (
    <div className="modal-backdrop" onClick={clear}>
      <div className="panel parchment modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-body result">
          <div className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 12 }}>{STATION_INFO[reward.puzzle].icon} {reward.puzzle} shift complete</div>
          <div className="big">{label}</div>
          <div className="pts">{reward.points.toLocaleString()} points</div>
          <div className="bar gold" style={{ margin: '10px 0' }}><i style={{ width: `${Math.round(reward.performance * 100)}%` }} /></div>
          <p>Earned <b>{reward.poe} PoE</b></p>
          <button className="btn" onClick={clear}>Back to it</button>
        </div>
      </div>
    </div>
  );
}
