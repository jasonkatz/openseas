import { t } from "@openseas/boards";
import type { ReplayRejection } from "@openseas/engine";

/** A move as one short line for the log: its fields after `type`, e.g. `swap col=2 row=5`. */
export function describeMove(move: unknown): string {
  if (typeof move !== "object" || move === null) return String(move);
  const m = move as Record<string, unknown>;
  const type = typeof m.type === "string" ? m.type : "?";
  const rest = Object.entries(m)
    .filter(([k]) => k !== "type")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
  return rest ? `${type} ${rest}` : type;
}

/** Why a replay refused a move: the engine's own words for an illegal one, else the server's reason. */
export function refusal(r: ReplayRejection): string {
  return r.message ?? t(`practice.reject.${r.reason}`);
}

/** A config value for an input: arrays and objects as JSON, everything else as text. */
export function valueToText(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  return Promise.resolve(false);
}

export function shortHash(h: string | null | undefined): string {
  return h ?? "–";
}
