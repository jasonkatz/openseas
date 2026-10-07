import { useEffect, useRef } from "react";
import type { BilgingState, MoveReport } from "@openseas/engine";
import { content } from "../content.js";
import { BilgingRenderer } from "./renderer.js";

export interface BoardProps {
  state: BilgingState | null;
  report: MoveReport | null;
  /** Monotonic counter so the same state object can be re-applied after a reset. */
  version: number;
  interactive: boolean;
  onSwap(col: number, row: number): void;
  preview(col: number, row: number): readonly number[];
  onFrame(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function BilgingBoard(props: BoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<BilgingRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new BilgingRenderer(el, content.puzzles.bilging, {
      onSwap: (c, row) => latest.current.onSwap(c, row),
      onHover: (c, row) => r.setPreview(latest.current.preview(c, row)),
      onHoverEnd: () => r.setPreview([]),
      onFrame: () => latest.current.onFrame(),
    });
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      const p = latest.current;
      if (p.state) r.setState(p.state, null);
      r.setInteractive(p.interactive);
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
    if (r && props.state && r.app.renderer) r.setState(props.state, props.report);
  }, [props.state, props.report, props.version]);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setInteractive(props.interactive);
  }, [props.interactive]);

  return <div ref={host} className="board-host" data-testid="bilging-board" />;
}
