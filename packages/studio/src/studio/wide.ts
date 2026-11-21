import { createContext, useContext } from "react";
import type { ModeId } from "./modes.js";

/**
 * Whether the panels are opened wide, over the middle of the page (DESIGN.md 3.14, ADR 0068).
 * One switch for every mode, kept in the browser, and on until the owner shuts it. Play is never wide: its panel is short, and the
 * board is what it is for.
 */
export const canWiden = (mode: ModeId): boolean => mode !== "play";

export const isWide = (wide: boolean, mode: ModeId): boolean => wide && canWiden(mode);

const KEY = "openseas.studio.wide";

export function readWide(): boolean {
  try {
    // Wide unless the owner shut it: a mode's panel opens over the middle by default (ADR 0068, as the owner asked).
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeWide(wide: boolean): void {
  try {
    window.localStorage.setItem(KEY, wide ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/** True inside a panel opened wide: a panel draws more where it has the room (a curve as a chart, the rating scale, the Sprites stage). */
export const WidePanel = createContext(false);
export const useWidePanel = (): boolean => useContext(WidePanel);
