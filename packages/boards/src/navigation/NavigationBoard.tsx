import { useEffect, useRef } from "react";
import type { NavigationEvent, NavigationState } from "@openseas/engine";
import { content, t } from "../content.js";
import { NavigationRenderer, navigationViewString } from "./renderer.js";

export interface NavigationBoardProps {
  /** The state as shown: the engine advanced to the current tick. */
  state: NavigationState;
  interactive: boolean;
  showMarks: boolean;
  showMarkers: boolean;
  /** Idle hints, for unrated practice only. */
  hints: boolean;
  onRotate(ring: number, dir: -1 | 1): boolean;
  onDrop(): void;
  onFrame(): void;
  onEvents(events: readonly NavigationEvent[]): void;
  onNudge(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function NavigationBoard(props: NavigationBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<NavigationRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new NavigationRenderer(
      el,
      content.puzzles.navigation,
      {
        onRotate: (ring, dir) => latest.current.onRotate(ring, dir),
        onDrop: () => latest.current.onDrop(),
        onFrame: () => latest.current.onFrame(),
        onEvents: (events) => latest.current.onEvents(events),
        onNudge: () => latest.current.onNudge(),
      },
      {
        showMarks: props.showMarks,
        showMarkers: props.showMarkers,
        hints: props.hints,
        tickMs: content.puzzles.navigation.config.tickMs,
        labels: {
          charted: t("navigation.charted"),
          lostHeading: t("navigation.lost_heading"),
          run: t("navigation.run"),
          chain: (chain) => t("practice.chain_label", { chain }),
          efficient: t("navigation.efficient"),
          next: t("navigation.next"),
          ring: (ring, rings) => (rings === 3 ? t(["navigation.ring_inner", "navigation.ring_middle", "navigation.ring_outer"][ring]!) : t("navigation.ring_n", { n: rings - ring })),
          drop: t("navigation.drop_now"),
        },
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

  useEffect(() => {
    renderer.current?.setShowMarkers(props.showMarkers);
  }, [props.showMarkers]);

  useEffect(() => {
    renderer.current?.setHints(props.hints);
  }, [props.hints]);

  return <div ref={host} className="board-host" data-testid="navigation-board" data-board={navigationViewString(props.state)} />;
}
