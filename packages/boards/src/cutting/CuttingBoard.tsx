import type { CuttingState } from "@openseas/engine";

export interface CuttingBoardProps {
  state: CuttingState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Cutting (prototype, ADR 0036). This is the stub the real board replaces. */
export function CuttingBoard(_props: CuttingBoardProps) {
  return <div className="board-host" data-testid="cutting-board" />;
}
