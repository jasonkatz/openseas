import type { StationWire } from "@openseas/protocol";
import { content, t } from "@openseas/boards";

export const islandName = (id: string): string => t(content.world.islands.find((i) => i.id === id)?.nameKey ?? id);
export const islandBlurb = (id: string): string => t(content.world.islands.find((i) => i.id === id)?.blurbKey ?? "");
export const className = (id: string): string => t(content.world.shipClasses.find((c) => c.id === id)?.nameKey ?? id);
export const tierName = (id: string): string => t(content.world.brigandTiers.find((b) => b.id === id)?.nameKey ?? id);
export const stationName = (s: StationWire): string => t(`station.${s}`);
export const puzzleName = (s: StationWire): string => t(`home.practice_${s}`);
export const routeBetween = (from: string, to: string) => content.world.routes.find((r) => r.from === from && r.to === to) ?? null;
export const minutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));

export function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
