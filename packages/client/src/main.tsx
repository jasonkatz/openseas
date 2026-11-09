import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "@openseas/boards/styles.css";
import "./game.css";

// The game is one screen with its own zoom: the page under it never zooms. iOS Safari ignores the
// viewport's maximum-scale for a pinch, and a pinch begun on a label or a card would zoom the page and
// leave the player stranded in it; its gesture events are the one way to say no.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
