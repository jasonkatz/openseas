import { useEffect, useState } from "react";
import type { PuzzleId } from "@openseas/engine";

/**
 * The home grid's thumbnails (DESIGN.md 3.14): each is a picture of the puzzle's real board, drawn
 * by this build. The home page opens every puzzle's `/play` page in turn in one hidden frame, with
 * `thumb=1`; that page draws the board alone, copies its canvas and posts the picture back
 * (ThumbShell). So a thumbnail needs no code a puzzle and is never out of date with the board. One
 * frame at a time: fifteen boards at once would be fifteen WebGL contexts.
 */
export const THUMB_PARAM = "thumb";
export const THUMB_MESSAGE = "openseas.thumb";
/** The frame's size: a phone's column, which is what a board is drawn for. */
export const THUMB_FRAME = { width: 360, height: 520 } as const;
/** How long a puzzle gets to draw itself before the grid moves on and keeps its glyph. */
const PATIENCE_MS = 12_000;

export interface ThumbMessage {
  type: typeof THUMB_MESSAGE;
  puzzle: string;
  /** A data URL, or null when the board would not give a picture. */
  url: string | null;
}

const key = (id: string): string => `openseas.thumb.${__HARNESS_COMMIT__}.${id}`;

function remembered(id: string): string | null {
  try {
    return window.sessionStorage.getItem(key(id));
  } catch {
    return null;
  }
}
function remember(id: string, url: string): void {
  try {
    window.sessionStorage.setItem(key(id), url);
  } catch {
    /* full or private: the next visit draws it again */
  }
}

/** A picture a puzzle, filled in as each is drawn. Pictures are kept for the tab's life, by build. */
export function useThumbnails(ids: readonly PuzzleId[]): Partial<Record<PuzzleId, string>> {
  const [thumbs, setThumbs] = useState<Partial<Record<PuzzleId, string>>>(() => {
    const have: Partial<Record<PuzzleId, string>> = {};
    for (const id of ids) {
      const url = remembered(id);
      if (url) have[id] = url;
    }
    return have;
  });

  useEffect(() => {
    const queue = ids.filter((id) => !remembered(id));
    if (queue.length === 0) return;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.className = "thumb-frame";
    frame.width = String(THUMB_FRAME.width);
    frame.height = String(THUMB_FRAME.height);
    document.body.appendChild(frame);
    let timer = 0;
    let current: PuzzleId | null = null;
    const next = (): void => {
      window.clearTimeout(timer);
      current = queue.shift() ?? null;
      if (!current) {
        frame.remove();
        return;
      }
      frame.src = `/play/${current}?${THUMB_PARAM}=1`;
      timer = window.setTimeout(next, PATIENCE_MS);
    };
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== window.location.origin || e.source !== frame.contentWindow) return;
      const m = e.data as Partial<ThumbMessage> | null;
      if (!m || m.type !== THUMB_MESSAGE || m.puzzle !== current) return;
      if (typeof m.url === "string" && m.url.startsWith("data:image/")) {
        const id = current;
        const url = m.url;
        remember(id, url);
        setThumbs((t) => ({ ...t, [id]: url }));
      }
      next();
    };
    window.addEventListener("message", onMessage);
    next();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
    };
    // The list of puzzles is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return thumbs;
}
