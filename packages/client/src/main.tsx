import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './puzzles/all';
import { App } from './App';
import { bindNet, useStore } from './store';

bindNet();
// Small debugging/automation hook used by the e2e smoke test.
(window as unknown as { __tb_open?: (k: string) => void }).__tb_open = (k) => useStore.getState().setOpenBuilding(k as never);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
