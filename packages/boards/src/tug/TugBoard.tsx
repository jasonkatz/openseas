import type { TugState } from "@openseas/engine";

export interface TugBoardProps {
  state: TugState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Tug (prototype, ADR 0036). This is the stub the real board replaces. */
export function TugBoard(_props: TugBoardProps) {
  return <div className="board-host" data-testid="tug-board" />;
}
