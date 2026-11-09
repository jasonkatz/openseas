import { useEffect, useRef } from "react";
import type { PlatingState, BreachRating } from "@openseas/engine";
import { content, t } from "../content.js";
import { PlatingRenderer } from "./renderer.js";

export interface PlatingBoardProps {
  state: PlatingState;
  version: number;
  interactive: boolean;
  showMarks: boolean;
  onPlace(slot: number, rot: number, flip: boolean, col: number, row: number): void;
  onFrame(): void;
  onSealed(rating: BreachRating, chain: number): void;
  onNailed(waste: boolean): void;
  onGrew(): void;
  onCracked(opening: boolean): void;
  onNudge(): void;
  onBump(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function PlatingBoard(props: PlatingBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<PlatingRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const plating = content.puzzles.plating;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new PlatingRenderer(
      el,
      plating,
      {
        onPlace: (slot, rot, flip, col, row) => latest.current.onPlace(slot, rot, flip, col, row),
        onFrame: () => latest.current.onFrame(),
        onSealed: (rating, chain) => latest.current.onSealed(rating, chain),
        onNailed: (waste) => latest.current.onNailed(waste),
        onGrew: () => latest.current.onGrew(),
        onCracked: (opening) => latest.current.onCracked(opening),
        onNudge: () => latest.current.onNudge(),
        onBump: () => latest.current.onBump(),
      },
      {
        showMarks: props.showMarks,
        ratingLabel: (rating) => t(`plating.rating.${rating}`),
        streakLabel: (count) => t("plating.streak_label", { count }),
        brushLabel: t("plating.brush_bonus"),
        grewLabel: t("plating.breach_grew"),
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

  const breachCells = new Set(props.state.breaches.flatMap((h) => h.cells));
  const board = props.state.covered.map((n, c) => (n > 0 ? String(n) : breachCells.has(c) ? "h" : ".")).join("");
  return <div ref={host} className="board-host" data-testid="plating-board" data-board={board} />;
}
