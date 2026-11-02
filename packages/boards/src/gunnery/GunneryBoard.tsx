import { useEffect, useRef } from "react";
import type { Dir, GunneryEvent, GunneryState } from "@openseas/engine";
import { content, t } from "../content.js";
import { GunneryRenderer, gunneryViewString } from "./renderer.js";

export interface GunneryBoardProps {
  /** The state to show: the engine state advanced to the display tick. */
  state: GunneryState;
  interactive: boolean;
  showMarks: boolean;
  onArrow(col: number, row: number, dir: Dir | null): void;
  onFrame(): void;
  onEvents(events: readonly GunneryEvent[]): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function GunneryBoard(props: GunneryBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<GunneryRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const gunnery = content.puzzles.gunnery;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new GunneryRenderer(
      el,
      gunnery,
      {
        onArrow: (c, row, dir) => latest.current.onArrow(c, row, dir),
        onFrame: () => latest.current.onFrame(),
        onEvents: (events) => latest.current.onEvents(events),
      },
      {
        showMarks: props.showMarks,
        tickMs: gunnery.config.tickMs,
        labels: { fouled: t("gunnery.fouled_callout"), clean: t("gunnery.clean_callout"), next: t("gunnery.next"), broadside: t("gunnery.broadside_callout") },
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
  }, [props.state]);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setInteractive(props.interactive);
  }, [props.interactive]);

  useEffect(() => {
    renderer.current?.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  return <div ref={host} className="board-host" data-testid="gunnery-board" data-board={gunneryViewString(props.state)} />;
}
