import { useEffect } from "react";
import type { SwordRotation, SwordfightEvent, SwordfightState } from "@openseas/engine";
import { content, t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { SwordfightRenderer, swordfightViewString, type PlaceAnswer, type RemoteBoard } from "./renderer.js";

export interface SwordfightBoardProps {
  state: SwordfightState;
  interactive: boolean;
  showMarks: boolean;
  /** Boards in the melee that are not in this state: the crew's and the raiders', aboard. */
  remote?: readonly RemoteBoard[];
  /** The player's pair came to rest: taken, "wait" (too soon; the board asks again) or "refused" (the board lifts it clear). */
  onPlace(col: number, rot: SwordRotation): PlaceAnswer;
  onFrame(): void;
  onEvents(events: readonly SwordfightEvent[]): void;
  onNudge(): void;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function SwordfightBoard(props: SwordfightBoardProps) {
  const swordfight = content.puzzles.swordfight;
  const { host, renderer } = useBoardHost(
    (el, latest) =>
      new SwordfightRenderer(
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
            scrapOver: (scrap) => t("swordfight.scrap_label", { scrap }),
            scrapIn: t("swordfight.scrap_in"),
            out: t("swordfight.out"),
            won: t("swordfight.won"),
            lost: t("swordfight.lost"),
          },
        },
      ),
    props,
  );

  // The renderer holds the remote boards until it is ready, so they are in place before its first state.
  useEffect(() => {
    renderer.current?.setRemote(props.remote ?? []);
  }, [props.remote, renderer]);

  return <div ref={host} className="board-host" data-testid="swordfight-board" data-board={swordfightViewString(props.state)} />;
}
