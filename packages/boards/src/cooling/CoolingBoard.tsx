import type { CoolingState, ClearRound } from "@openseas/engine";
import { content, t } from "../content.js";
import { useBoardHost } from "../kit/useBoardHost.js";
import { CoolingRenderer, type MoveShown } from "./renderer.js";

export interface BoardProps {
  /** The state to show. The move that led to it (`lastMove`) plays out; anything else snaps. */
  state: CoolingState;
  /** Monotonic counter so the same state object can be re-applied after a reset. */
  version: number;
  interactive: boolean;
  showMarks: boolean;
  onSwap(col: number, row: number): void;
  preview(col: number, row: number): readonly number[];
  onFrame(): void;
  /** A cascade step is clearing on screen. */
  onClear(round: ClearRound): void;
  /** A move finished playing out on screen. */
  onMoveShown(shown: MoveShown): void;
  /** Idle hints are on (unrated practice only). */
  hints: boolean;
  findHint(): { col: number; row: number } | null;
}

/** Hosts the Pixi canvas and forwards input. All drawing lives in the renderer. */
export function CoolingBoard(props: BoardProps) {
  const { host } = useBoardHost((el, latest) => {
    const r: CoolingRenderer = new CoolingRenderer(el, content.puzzles.cooling, {
      onSwap: (c, row) => latest.current.onSwap(c, row),
      onHover: (c, row) => r.setPreview(latest.current.preview(c, row)),
      onHoverEnd: () => r.setPreview([]),
      onFrame: () => latest.current.onFrame(),
      onClear: (round) => latest.current.onClear(round),
      onMoveShown: (shown) => latest.current.onMoveShown(shown),
      findHint: () => latest.current.findHint(),
    }, {
      showMarks: props.showMarks,
      labels: {
        charge: t("cooling.special.charge_label"),
        magnet: t("cooling.special.magnet_label"),
        slag: t("cooling.special.slag_label"),
      },
      chainLabel: (chain) => t("cooling.chain_label", { chain }),
      multiLabel: (groups) => t(groups >= 4 ? "cooling.multi_4" : groups === 3 ? "cooling.multi_3" : "cooling.multi_2"),
      streakLabel: (count) => t("cooling.streak_label", { count }),
      overheatSwapMs: content.puzzles.cooling.overheatSwapMs,
    });
    return r;
  }, props);

  return <div ref={host} className="board-host" data-testid="cooling-board" data-board={props.state.cells.map((p) => p.kind).join(",")} />;
}
