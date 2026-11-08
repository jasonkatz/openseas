import { defaultLook, type Title } from "@openseas/content";
import type { PirateLookWire } from "@openseas/protocol";
import { content, t } from "@openseas/boards";

/** The coats, hats and titles content offers (DESIGN.md 3.6). */
export const pirateRules = content.world.pirates;

/** The look a pirate wears: the one the server sent, or the default drawn from their id when it sent none. */
export function lookFor(pirateId: string, look: PirateLookWire | null | undefined): PirateLookWire {
  return look ?? defaultLook(pirateRules, pirateId);
}

export function coatHex(id: string): string {
  return pirateRules.coats.find((c) => c.id === id)?.hex ?? pirateRules.coats[0]!.hex;
}

export function coatName(id: string): string {
  const c = pirateRules.coats.find((x) => x.id === id);
  return c ? t(c.nameKey) : id;
}

export function hatName(id: string): string {
  const h = pirateRules.hats.find((x) => x.id === id);
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
    case "booty":
      return t("title.req_booty", { count: r.count });
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
  const { coats, hats } = pirateRules;
  for (;;) {
    const next = { coat: coats[Math.floor(roll() * coats.length)]!.id, hat: hats[Math.floor(roll() * hats.length)]!.id };
    if (next.coat !== current.coat || next.hat !== current.hat) return next;
  }
}
