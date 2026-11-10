import type { RacksState } from "@openseas/engine";

export interface RacksBoardProps {
  state: RacksState;
  version?: number;
  interactive: boolean;
  showMarks: boolean;
  onFrame(): void;
}

/** Racks (prototype, ADR 0036). This is the stub the real board replaces. */
export function RacksBoard(_props: RacksBoardProps) {
  return <div className="board-host" data-testid="racks-board" />;
}
