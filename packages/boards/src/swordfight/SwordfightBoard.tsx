import { useEffect, useRef } from "react";
import type { SwordRotation, SwordfightEvent, SwordfightState } from "@openseas/engine";
import { content, t } from "../content.js";
import { SwordfightRenderer, swordfightViewString, type RemoteBoard } from "./renderer.js";

export interface SwordfightBoardProps {
  state: SwordfightState;
  interactive: boolean;
  showMarks: boolean;
  /** Boards in the melee that are not in this state: the crew's and the brigands', aboard. */
  remote?: readonly RemoteBoard[];
  /** The player's pair came to rest. Return false when the engine will not take it yet; the board asks again. */
  onPlace(col: number, rot: SwordRotation): boolean;
  onFrame(): void;
  onEvents(events: readonly SwordfightEvent[]): void;
  onNudge(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function SwordfightBoard(props: SwordfightBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<SwordfightRenderer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const swordfight = content.puzzles.swordfight;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new SwordfightRenderer(
      el,
      swordfight,
      {
        onPlace: (col, rot) => latest.current.onPlace(col, rot),
        onFrame: () => latest.current.onFrame(),
        onEvents: (events) => latest.current.onEvents(events),
        onNudge: () => latest.current.onNudge(),
      },
      {
        showMarks: props.showMarks,
        softDropMs: swordfight.softDropMs,
        labels: {
          you: t("swordfight.you"),
          foe: (n) => t("swordfight.foe", { n }),
          ally: (n) => t("swordfight.ally", { n }),
          next: t("swordfight.next"),
          incoming: t("swordfight.incoming"),
          shatter: t("swordfight.shatter"),
          slab: t("swordfight.slab"),
          chain: (chain) => t("swordfight.chain_label", { chain }),
          wrackOver: (wrack) => t("swordfight.wrack_label", { wrack }),
          wrackIn: t("swordfight.wrack_in"),
          out: t("swordfight.out"),
          won: t("swordfight.won"),
          lost: t("swordfight.lost"),
        },
      },
    );
    renderer.current = r;
    let alive = true;
    void r.init().then(() => {
      if (!alive) return;
      r.setRemote(latest.current.remote ?? []);
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
  }, [props.state]);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setRemote(props.remote ?? []);
  }, [props.remote]);

  useEffect(() => {
    const r = renderer.current;
    if (r && r.app.renderer) r.setInteractive(props.interactive);
  }, [props.interactive]);

  useEffect(() => {
    renderer.current?.setShowMarks(props.showMarks);
  }, [props.showMarks]);

  return <div ref={host} className="board-host" data-testid="swordfight-board" data-board={swordfightViewString(props.state)} />;
}
