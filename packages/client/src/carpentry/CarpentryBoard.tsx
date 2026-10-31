import { useEffect, useRef } from "react";
import type { CarpentryState, HoleRating } from "@openseas/engine";
import { content, t } from "../content.js";
import { CarpentryRenderer } from "./renderer.js";

export interface CarpentryBoardProps {
  state: CarpentryState;
  version: number;
  interactive: boolean;
  showMarks: boolean;
  onPlace(slot: number, rot: number, flip: boolean, col: number, row: number): void;
  onFrame(): void;
  onPatched(rating: HoleRating, chain: number): void;
  onNailed(waste: boolean): void;
  onGrew(): void;
  onNudge(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function CarpentryBoard(props: CarpentryBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<CarpentryRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const carpentry = content.puzzles.carpentry;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new CarpentryRenderer(
      el,
      carpentry,
      {
        onPlace: (slot, rot, flip, col, row) => latest.current.onPlace(slot, rot, flip, col, row),
        onFrame: () => latest.current.onFrame(),
        onPatched: (rating, chain) => latest.current.onPatched(rating, chain),
        onNailed: (waste) => latest.current.onNailed(waste),
        onGrew: () => latest.current.onGrew(),
        onNudge: () => latest.current.onNudge(),
      },
      {
        showMarks: props.showMarks,
        ratingLabel: (rating) => t(`carpentry.rating.${rating}`),
        streakLabel: (count) => t("carpentry.streak_label", { count }),
        grainLabel: t("carpentry.grain_bonus"),
        grewLabel: t("carpentry.hole_grew"),
        turnLabel: t("carpentry.rotate"),
        flipLabel: t("carpentry.flip"),
      },
    );
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      r.setState(latest.current.state);
      r.setInteractive(latest.current.interactive);
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (r.keyboard(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      r.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setState(props.state);
  }, [props.state, props.version]);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setInteractive(props.interactive);
  }, [props.interactive]);

  useEffect(() => {
    renderer.current?.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  const holeCells = new Set(props.state.holes.flatMap((h) => h.cells));
  const board = props.state.covered.map((n, c) => (n > 0 ? String(n) : holeCells.has(c) ? "h" : ".")).join("");
  return <div ref={host} className="board-host" data-testid="carpentry-board" data-board={board} />;
}
