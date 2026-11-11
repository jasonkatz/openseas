/**
 * Walking is relayed, not ruled (ADR 0032): a pirate's walk target goes to everyone else in their
 * place, on the outpost or aboard, and is forgotten when they leave it. No database: where each
 * pirate is comes from a stand-in for Whereabouts, and the ship service's word that a pirate went
 * aboard or ashore is the test's own.
 */
import { describe, expect, it } from "vitest";
import { loadContent } from "@openseas/content";
import { createShip } from "@openseas/engine";
import { Presence } from "../src/presence.js";
import { ShipRoom, shipConfigFor } from "../src/ships/service.js";
import { SocialService, WALK_MIN_MS } from "../src/social.js";
import type { Whereabout, WhereaboutsLookup } from "../src/whereabouts.js";
import { Inbox } from "./inbox.js";

const content = loadContent();

/** One ship lying at Tinwick, and every pirate who is not aboard her standing on Tinwick while connected. */
function harbor() {
  const presence = new Presence();
  const skiff = content.world.shipClasses[0]!;
  const ship = new ShipRoom("ship-1", "Static Comet", skiff, "p-owner", createShip("harbor", shipConfigFor(content, skiff), "tinwick"), 0, presence);
  const aboard = new Set<string>();
  const whereabouts: WhereaboutsLookup = {
    of: (pirateId): Whereabout =>
      aboard.has(pirateId) ? { kind: "aboard", room: ship } : presence.online(pirateId) ? { kind: "on-outpost", outpostId: "tinwick" } : { kind: "offline" },
    outpost: async () => "tinwick",
  };
  let now = 1_000;
  const social = new SocialService(whereabouts, presence, () => now);
  return {
    social,
    tick: (ms: number) => (now += ms),
    /** The pirate's socket opens, with `member` as its line. */
    async connect(member: Inbox, name: string) {
      presence.attach(member.id, member);
      await social.connected(member.id, name);
    },
    board(member: Inbox) {
      aboard.add(member.id);
      ship.conns.join(member.id);
      social.boarded(member.id);
    },
    onOutpost(member: Inbox) {
      aboard.delete(member.id);
      ship.conns.leave(member.id);
      social.disembarked(member.id, "tinwick");
    },
  };
}

describe("walking", () => {
  it("goes to everyone else on the outpost, and newcomers see where people stand", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.connect(anne, "Anne");
    await h.connect(ben, "Ben");
    h.social.walk(anne.id, { x: 0.5, z: -1.25 });
    expect(ben.of("walk.moved")).toEqual([{ type: "walk.moved", scope: "outpost", pirateId: anne.id, x: 0.5, z: -1.25 }]);
    expect(anne.of("walk.moved")).toEqual([]);

    const cid = new Inbox("p-cid");
    await h.connect(cid, "Cid");
    const presence = cid.of("outpost.presence").at(-1)!;
    expect(presence.pirates.find((p) => p.pirateId === anne.id)?.at).toEqual({ x: 0.5, z: -1.25 });
    expect(presence.pirates.find((p) => p.pirateId === ben.id)?.at).toBeNull();
  });

  it("is paced: a walk hard on the heels of the last is dropped", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.connect(anne, "Anne");
    await h.connect(ben, "Ben");
    h.social.walk(anne.id, { x: 0, z: 0 });
    h.tick(WALK_MIN_MS - 1);
    h.social.walk(anne.id, { x: 1, z: 1 });
    h.tick(WALK_MIN_MS);
    h.social.walk(anne.id, { x: 2, z: 2 });
    expect(ben.of("walk.moved").map((m) => m.x)).toEqual([0, 2]);
  });

  it("aboard goes to the ship's room only, and a pirate coming aboard hears where the crew stands", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    const cid = new Inbox("p-cid");
    for (const [m, name] of [
      [anne, "Anne"],
      [ben, "Ben"],
      [cid, "Cid"],
    ] as const)
      await h.connect(m, name);
    h.board(anne);
    h.social.walk(anne.id, { x: 0.2, z: 0.05 });
    // Ben and Cid are on the outpost: a deck walk is nothing to them.
    expect(ben.of("walk.moved")).toEqual([]);
    expect(cid.of("walk.moved")).toEqual([]);

    h.board(ben);
    expect(ben.of("walk.where").at(-1)).toEqual({ type: "walk.where", scope: "ship", walkers: [{ pirateId: anne.id, x: 0.2, z: 0.05 }] });
    h.tick(WALK_MIN_MS);
    h.social.walk(ben.id, { x: -0.1, z: 0 });
    expect(anne.of("walk.moved").at(-1)).toEqual({ type: "walk.moved", scope: "ship", pirateId: ben.id, x: -0.1, z: 0 });
    expect(cid.of("walk.moved")).toEqual([]);
  });

  it("is forgotten on leaving the place: back on the outpost a pirate has walked nowhere yet", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.connect(anne, "Anne");
    await h.connect(ben, "Ben");
    h.social.walk(anne.id, { x: 1, z: 1 });
    h.board(anne);
    h.tick(WALK_MIN_MS);
    h.social.walk(anne.id, { x: 0.1, z: 0.1 });
    h.onOutpost(anne);
    const presence = ben.of("outpost.presence").at(-1)!;
    expect(presence.pirates.find((p) => p.pirateId === anne.id)?.at).toBeNull();
  });
});

describe("the outpost", () => {
  it("speaks to a pirate's newest socket: its room holds the pirate, not a socket", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.connect(anne, "Anne");
    await h.connect(ben, "Ben");
    const anneAgain = new Inbox("p-anne");
    await h.connect(anneAgain, "Anne");
    h.social.chat(ben.id, "outpost", "ahoy");
    expect(anneAgain.of("chat.message").map((m) => m.text)).toEqual(["ahoy"]);
    expect(anne.of("chat.message")).toEqual([]);
  });
});
