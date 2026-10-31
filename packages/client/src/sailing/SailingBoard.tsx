import { useEffect, useRef } from "react";
import type { Rotation, SailingClearRound, SailingState } from "@openseas/engine";
import { content, t } from "../content.js";
import { SailingRenderer } from "./renderer.js";

export interface SailingBoardProps {
  state: SailingState;
  version: number;
  interactive: boolean;
  showMarks: boolean;
  onPlace(col: number, rot: Rotation): void;
  onFrame(): void;
  onClear(round: SailingClearRound): void;
  onLanded(): void;
  onNudge(): void;
  onWipe(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function SailingBoard(props: SailingBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<SailingRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const sailing = content.puzzles.sailing;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new SailingRenderer(
      el,
      sailing,
      {
        onPlace: (c, rot) => latest.current.onPlace(c, rot),
        onFrame: () => latest.current.onFrame(),
        onClear: (round) => latest.current.onClear(round),
        onLanded: () => latest.current.onLanded(),
        onNudge: () => latest.current.onNudge(),
        onWipe: () => latest.current.onWipe(),
      },
      {
        showMarks: props.showMarks,
        fallMs: sailing.fallMs,
        softDropMs: sailing.softDropMs,
        chainLabel: (chain) => t("practice.chain_label", { chain }),
        platformLabel: t("sailing.platform_cleared"),
        wipeLabel: (points) => t("sailing.wipe_label", { points }),
      },
    );
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      r.setState(latest.current.state);
      r.setInteractive(latest.current.interactive);
    });
    const onKey = (down: boolean) => (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (r.keyboard(e.key, down)) e.preventDefault();
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      alive = false;
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
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

  return <div ref={host} className="board-host" data-testid="sailing-board" data-board={props.state.cells.map((c) => c?.kind ?? -1).join(",")} />;
}
