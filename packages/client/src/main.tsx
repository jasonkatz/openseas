import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './puzzles/all';
import type { PuzzleId } from '@tidebound/shared';
import { PUZZLE_IDS } from '@tidebound/shared';

const params = new URLSearchParams(location.search);
const devPuzzle = params.get('puzzle');
const root = createRoot(document.getElementById('root')!);

if (devPuzzle && (PUZZLE_IDS as readonly string[]).includes(devPuzzle)) {
  // Dev harness: run one puzzle locally without the server.
  void import('./dev/LocalPuzzle').then(({ LocalPuzzle }) => {
    root.render(<LocalPuzzle id={devPuzzle as PuzzleId} seed={Number(params.get('seed') ?? 7)} />);
  });
} else {
  void Promise.all([import('./App'), import('./store')]).then(([{ App }, { bindNet, useStore }]) => {
    bindNet();
    // Small automation hook used by the e2e smoke test.
    (window as unknown as { __tb_open?: (k: string) => void }).__tb_open = (k) => useStore.getState().setOpenBuilding(k as never);
    root.render(<React.StrictMode><App /></React.StrictMode>);
  });
}
