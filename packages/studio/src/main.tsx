import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { measureCues } from "@openseas/boards";
import { App } from "./App.jsx";
import "@openseas/boards/styles.css";
import "./studio.css";
import "./play/play.css";
import "./studio/studio.css";
import "./home/home.css";
import "./look.css";

// The smoke measures every cue in a real browser through this (e2e/sound.spec.ts): nothing on the page calls it.
(window as unknown as { openseasMeasureCues?: typeof measureCues }).openseasMeasureCues = measureCues;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
