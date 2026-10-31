import { useEffect, useRef } from "react";
import type { Completion, NavigationState } from "@openseas/engine";
import { content, t } from "../content.js";
import { NavigationRenderer } from "./renderer.js";

export interface NavigationBoardProps {
  state: NavigationState;
  version: number;
  interactive: boolean;
  showMarks: boolean;
  showMarkers: boolean;
  onRotate(ring: number, dir: -1 | 1): void;
  onDrop(): void;
  onFrame(): void;
  onLanded(): void;
  onBooch(): void;
  onCharted(c: Completion): void;
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
        onLanded: () => latest.current.onLanded(),
        onBooch: () => latest.current.onBooch(),
        onCharted: (c) => latest.current.onCharted(c),
        onNudge: () => latest.current.onNudge(),
      },
      {
        showMarks: props.showMarks,
        showMarkers: props.showMarkers,
        chartedLabel: t("navigation.charted"),
        boochLabel: t("navigation.booch"),
        chainLabel: (chain) => t("practice.chain_label", { chain }),
        efficientLabel: t("navigation.efficient"),
        nextLabel: t("navigation.next"),
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

  useEffect(() => {
    renderer.current?.setShowMarkers(props.showMarkers);
  }, [props.showMarkers]);

  return <div ref={host} className="board-host" data-testid="navigation-board" data-board={props.state.slots.map((s) => s?.kind ?? -1).join(",")} />;
}
