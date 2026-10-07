import { useStore } from './store';
import { Login } from './scenes/Login';
import { TopBar } from './ui/TopBar';
import { Toasts } from './ui/Toasts';
import { Chat } from './ui/Chat';
import { IslandScene } from './scenes/IslandScene';
import { ShipScene } from './scenes/ShipScene';
import { PuzzleHost } from './puzzles/PuzzleHost';
import { SwordfightScene } from './scenes/SwordfightScene';
import { RewardModal } from './ui/RewardModal';

export function App() {
  const pirate = useStore((s) => s.pirate);
  const room = useStore((s) => s.room);
  const puzzle = useStore((s) => s.puzzle);
  const swordfight = useStore((s) => s.swordfight);
  const reward = useStore((s) => s.lastReward);

  if (!pirate) return <div className="app"><Login /><Toasts /></div>;

  return (
    <div className="app">
      {room?.kind === 'island' && <IslandScene />}
      {room?.kind === 'ship' && <ShipScene />}
      {!room && <div className="scene" style={{ display: 'grid', placeItems: 'center' }}><div className="muted">Rowing ashore…</div></div>}
      <TopBar />
      {puzzle && !swordfight && <PuzzleHost key={puzzle.sessionId} active={puzzle} />}
      {swordfight && <SwordfightScene view={swordfight} />}
      {reward && <RewardModal reward={reward} />}
      <Chat />
      <Toasts />
    </div>
  );
}
