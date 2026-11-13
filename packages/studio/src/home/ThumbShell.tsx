import { useEffect } from "react";
import { useFrame } from "../frame/RoundFrame.jsx";
import type { ShellProps } from "../practice/PracticeShell.jsx";
import { THUMB_MESSAGE, type ThumbMessage } from "./thumbs.js";

/** The picture's width in pixels: twice a tile's, so it stays sharp. */
const WIDTH = 480;
/** Frames to try for a picture once the board has drawn. A WebGL canvas reads back empty between its draw and the next. */
const TRIES = 90;

/**
 * A puzzle's board and nothing else, for the home grid's hidden frame (home/thumbs). Once the
 * board has drawn its opening state it copies the canvas into a picture and posts it to the page
 * that framed it. Opened any other way it is just a still board.
 */
export function ThumbShell(p: ShellProps) {
  const puzzle = useFrame().puzzle.id;

  useEffect(() => {
    if (window.parent === window) return;
    let frames = 0;
    let done = false;
    let id = 0;
    const post = (url: string | null): void => {
      done = true;
      const message: ThumbMessage = { type: THUMB_MESSAGE, puzzle, url };
      window.parent.postMessage(message, window.location.origin);
    };
    const tick = (): void => {
      if (done) return;
      const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${puzzle}-canvas"]`);
      // Drawn means the renderer has its art (or has fallen back to drawing in code) and has shown a state.
      if (canvas?.getAttribute("data-sprite-atlas") && canvas.getAttribute("data-view") && canvas.width > 0) {
        frames++;
        const picture = frames > 3 ? copy(canvas) : null;
        if (picture) return post(picture);
        if (frames > TRIES) return post(null);
      }
      id = window.requestAnimationFrame(tick);
    };
    id = window.requestAnimationFrame(tick);
    return () => {
      done = true;
      window.cancelAnimationFrame(id);
    };
  }, [puzzle]);

  return (
    <div className="thumb-board" data-testid="thumb">
      {p.board(false)}
    </div>
  );
}

/** The canvas as a picture, or null when it read back empty (the frame had not been drawn yet). */
function copy(canvas: HTMLCanvasElement): string | null {
  const out = document.createElement("canvas");
  out.width = WIDTH;
  out.height = Math.max(1, Math.round((canvas.height / canvas.width) * WIDTH));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  // A row across the middle is enough to tell a drawn board from nothing.
  const row = ctx.getImageData(0, Math.floor(out.height / 2), out.width, 1).data;
  let seen = 0;
  for (let i = 3; i < row.length; i += 4) if (row[i]! > 0) seen++;
  if (seen < out.width / 8) return null;
  return out.toDataURL("image/webp", 0.82);
}
