import { MODE_IDS, type ModeId } from "./modes.js";

/**
 * Which modes' panels are opened wide, over the middle of the page (DESIGN.md 3.14, ADR 0067).
 * The owner picks whether that is remembered for each mode on its own or shared by every mode.
 * Play is never wide: its panel is short, and the board is what it is for.
 */
export interface Wide {
  readonly scope: "mode" | "all";
  /** Wide in every mode but Play, when the scope is all. */
  readonly all: boolean;
  /** The modes opened wide, when the scope is each mode's own. */
  readonly modes: readonly ModeId[];
}

export const NARROW: Wide = { scope: "mode", all: false, modes: [] };

export const canWiden = (mode: ModeId): boolean => mode !== "play";

export function isWide(wide: Wide, mode: ModeId): boolean {
  if (!canWiden(mode)) return false;
  return wide.scope === "all" ? wide.all : wide.modes.includes(mode);
}

/** Open or shut the panel of this mode: alone, or every mode's when the scope is shared. */
export function toggleWide(wide: Wide, mode: ModeId): Wide {
  if (!canWiden(mode)) return wide;
  if (wide.scope === "all") return { ...wide, all: !wide.all };
  return { ...wide, modes: wide.modes.includes(mode) ? wide.modes.filter((m) => m !== mode) : [...wide.modes, mode] };
}

/** Change the scope, keeping the panel on screen as it is. */
export function scopeWide(wide: Wide, scope: Wide["scope"], mode: ModeId): Wide {
  if (wide.scope === scope) return wide;
  const now = isWide(wide, mode);
  return scope === "all" ? { scope, all: now, modes: wide.modes } : { scope, all: wide.all, modes: now ? [...new Set([...wide.modes, mode])] : wide.modes.filter((m) => m !== mode) };
}

const KEY = "openseas.studio.wide";

export function readWide(): Wide {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Wide> | null;
    if (!raw || typeof raw !== "object") return NARROW;
    return {
      scope: raw.scope === "all" ? "all" : "mode",
      all: raw.all === true,
      modes: Array.isArray(raw.modes) ? raw.modes.filter((m): m is ModeId => (MODE_IDS as readonly string[]).includes(m) && canWiden(m as ModeId)) : [],
    };
  } catch {
    return NARROW;
  }
}

export function writeWide(wide: Wide): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(wide));
  } catch {
    /* private mode */
  }
}
