import { defaultLook, type Title } from "@openseas/content";
import type { PirateLookWire } from "@openseas/protocol";
import { content, t } from "@openseas/boards";

/** The jackets, headgear and titles content offers (DESIGN.md 3.6). */
export const pirateRules = content.world.pirates;

/** The look a pirate wears: the one the server sent, or the default drawn from their id when it sent none. */
export function lookFor(pirateId: string, look: PirateLookWire | null | undefined): PirateLookWire {
  return look ?? defaultLook(pirateRules, pirateId);
}

export function jacketHex(id: string): string {
  return pirateRules.jackets.find((c) => c.id === id)?.hex ?? pirateRules.jackets[0]!.hex;
}

export function jacketName(id: string): string {
  const c = pirateRules.jackets.find((x) => x.id === id);
  return c ? t(c.nameKey) : id;
}

export function headgearName(id: string): string {
  const h = pirateRules.headgear.find((x) => x.id === id);
  return h ? t(h.nameKey) : id;
}

export function titleOf(id: string | null | undefined): Title | null {
  return id ? (pirateRules.titles.find((x) => x.id === id) ?? null) : null;
}

/** A title's name, or null for none or one content no longer has. */
export function titleName(id: string | null | undefined): string | null {
  const title = titleOf(id);
  return title ? t(title.nameKey) : null;
}

/** What a title asks, in a line. */
export function titleAsks(title: Title): string {
  const r = title.requires;
  switch (r.kind) {
    case "start":
      return t("title.req_start");
    case "voyages":
    case "captained":
    case "victories":
      return t(r.count === 1 ? `title.req_${r.kind}_one` : `title.req_${r.kind}`, { count: r.count });
    case "plunder":
      return t("title.req_plunder", { count: r.count });
    case "standing": {
      const tier = content.ratingTiers.find((x) => x.key === r.tier);
      return t("title.req_standing", { tier: tier ? t(tier.nameKey) : r.tier, puzzle: t(`home.practice_${r.puzzle}`) });
    }
    default: {
      const never: never = r;
      return never;
    }
  }
}

/** A random look, for the die. Never the one being worn, so a roll always changes something. */
export function randomLook(current: PirateLookWire, roll: () => number = Math.random): PirateLookWire {
  const { jackets, headgear } = pirateRules;
  for (;;) {
    const next = { jacket: jackets[Math.floor(roll() * jackets.length)]!.id, headgear: headgear[Math.floor(roll() * headgear.length)]!.id };
    if (next.jacket !== current.jacket || next.headgear !== current.headgear) return next;
  }
}
