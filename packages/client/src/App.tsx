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
import { Tips } from './ui/Tips';
import { DuelInvite } from './ui/DuelInvite';
import { useEffect } from 'react';
import { setAmbientScene, startAmbient } from './lib/ambient';

export function App() {
  const pirate = useStore((s) => s.pirate);
  const room = useStore((s) => s.room);
  const puzzle = useStore((s) => s.puzzle);
  const swordfight = useStore((s) => s.swordfight);
  const reward = useStore((s) => s.lastReward);
  const muted = useStore((s) => s.muted);

  // Sea ambience: starts on the first gesture, swells at sea, ducks under puzzles.
  useEffect(() => {
    const kick = () => startAmbient(useStore.getState().muted);
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => { window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  }, []);
  useEffect(() => { setAmbientScene(puzzle || swordfight ? 'puzzle' : room?.kind === 'ship' ? 'ship' : 'island', muted); }, [puzzle, swordfight, room?.kind, muted]);

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
      <Tips />
      <DuelInvite />
    </div>
  );
}
