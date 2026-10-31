import { useEffect, useRef } from "react";
import type { BilgingState, ClearRound, MoveReport } from "@openseas/engine";
import { content, t } from "../content.js";
import { BilgingRenderer } from "./renderer.js";

export interface BoardProps {
  state: BilgingState | null;
  report: MoveReport | null;
  /** Monotonic counter so the same state object can be re-applied after a reset. */
  version: number;
  interactive: boolean;
  showMarks: boolean;
  onSwap(col: number, row: number): void;
  preview(col: number, row: number): readonly number[];
  onFrame(): void;
  /** A cascade step is clearing on screen. */
  onClear(round: ClearRound): void;
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
    const r: BilgingRenderer = new BilgingRenderer(el, content.puzzles.bilging, {
      onSwap: (c, row) => latest.current.onSwap(c, row),
      onHover: (c, row) => r.setPreview(latest.current.preview(c, row)),
      onHoverEnd: () => r.setPreview([]),
      onFrame: () => latest.current.onFrame(),
      onClear: (round) => latest.current.onClear(round),
    }, {
      showMarks: props.showMarks,
      labels: {
        keg: t("bilging.special.keg_label"),
        ink: t("bilging.special.ink_label"),
        barnacle: t("bilging.special.barnacle_label"),
      },
      chainLabel: (chain) => t("bilging.chain_label", { chain }),
      underwaterSwapMs: content.puzzles.bilging.underwaterSwapMs,
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

  useEffect(() => {
    renderer.current?.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  return <div ref={host} className="board-host" data-testid="bilging-board" data-board={props.state?.cells.map((p) => p.kind).join(",")} />;
}
