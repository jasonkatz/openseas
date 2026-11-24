import { useRef } from "react";
import type { Drawing } from "@openseas/protocol";
import { boardString, type Move, type PuzzleDoc, type Skin, type SkinDrawing, type Theme } from "@openseas/puzzle";
import { paintDrawing } from "../kit/drawing.js";
import { pictogramUrl } from "../kit/pictogram.js";
import { useKitBoard } from "../kit/useKitBoard.js";
import { PlayRenderer, type PlayFrame } from "./renderer.js";
import { tokenOf } from "./theme.js";

export interface PlayBoardProps {
  doc: PuzzleDoc;
  skin: Skin;
  theme: Theme;
  frame: PlayFrame;
  interactive: boolean;
  /** The player made a move. True when the round took it. */
  onMove(move: Move): boolean;
  onFrame?(): void;
}

/**
 * Hosts the domain board (ADR 0085). `data-board` is the round's own board as one line; the
 * canvas's `data-view` is the board the events drew, and the two are the same once it settles.
 */
export function PlayBoard(props: PlayBoardProps) {
  const latest = useRef(props);
  latest.current = props;
  const { host } = useKitBoard(
    (el) =>
      new PlayRenderer(el, props.doc, props.skin, props.theme, {
        onMove: (move) => latest.current.onMove(move),
        onFrame: () => latest.current.onFrame?.(),
      }),
    { state: props.frame, interactive: props.interactive },
  );
  return <div ref={host} className="board-host" data-testid={`${props.doc.id}-board`} data-board={boardString(props.frame.board)} data-seq={props.frame.seq} />;
}

/** A piece's drawing from a skin, as a picture for a page's legend. `key` is the skin's own: a piece's id, or `<piece>_<kind>` for one of a family. */
export function PlayPieceIcon({ skin, piece, size = 28 }: { skin: Skin; piece: string; size?: number }) {
  const entry = skin.pieces[piece];
  if (!entry || !("layers" in entry)) return null;
  const drawing = entry as SkinDrawing;
  const url = pictogramUrl(`${skin.puzzle}:${piece}`, tokenOf(drawing.tint), (ctx) => paintDrawing(ctx, drawing as unknown as Drawing), size);
  return <img src={url} width={size} height={size} alt="" aria-hidden="true" />;
}
