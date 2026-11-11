/**
 * Walking is relayed, not ruled (ADR 0032): a pirate's walk target goes to everyone else in their
 * place, on the outpost or aboard, and is forgotten when they leave it. No database: the ship service is
 * stood in for by the two things the social service asks of it.
 */
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@openseas/protocol";
import { Presence } from "../src/presence.js";
import { Room } from "../src/rooms.js";
import { SocialService, WALK_MIN_MS } from "../src/social.js";
import type { ShipService } from "../src/ships/service.js";
import { Inbox } from "./inbox.js";

/** A ship service with one ship room and every pirate standing on Tinwick. */
function harbor() {
  const presence = new Presence();
  const deck = new Room<ServerMessage>("ship-1", presence);
  const aboard = new Set<string>();
  const ships = {
    onDisembark: null as ((pirateId: string, outpostId: string) => void) | null,
    onBoarded: null as ((pirateId: string) => void) | null,
    roomOf: (pirateId: string) => (aboard.has(pirateId) ? { conns: deck } : null),
    pirateOutpost: async () => "tinwick",
  };
  let now = 1_000;
  const social = new SocialService(ships as unknown as ShipService, presence, () => now);
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
      deck.join(member.id);
      ships.onBoarded?.(member.id);
    },
    onOutpost(member: Inbox) {
      aboard.delete(member.id);
      deck.leave(member.id);
      ships.onDisembark?.(member.id, "tinwick");
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
