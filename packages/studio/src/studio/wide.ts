import type { ModeId } from "./modes.js";

/**
 * Whether the panels are opened wide, over the middle of the page (DESIGN.md 3.14, ADR 0068).
 * One switch for every mode, kept in the browser. Play is never wide: its panel is short, and the
 * board is what it is for.
 */
export const canWiden = (mode: ModeId): boolean => mode !== "play";

export const isWide = (wide: boolean, mode: ModeId): boolean => wide && canWiden(mode);

const KEY = "openseas.studio.wide";

export function readWide(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWide(wide: boolean): void {
  try {
    window.localStorage.setItem(KEY, wide ? "1" : "0");
  } catch {
    /* private mode */
  }
}
