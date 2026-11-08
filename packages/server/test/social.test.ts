/**
 * Walking is relayed, not ruled (ADR 0032): a pirate's walk target goes to everyone else in their
 * place, ashore or aboard, and is forgotten when they leave it. No database: the ship service is
 * stood in for by the two things the social service asks of it.
 */
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@openseas/protocol";
import { Room, type RoomMember } from "../src/rooms.js";
import { SocialService, WALK_MIN_MS } from "../src/social.js";
import type { ShipService } from "../src/ships/service.js";

class Inbox implements RoomMember<ServerMessage> {
  readonly got: ServerMessage[] = [];
  constructor(readonly id: string) {}
  send(m: ServerMessage): void {
    this.got.push(m);
  }
  of<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.got.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

/** A ship service with one ship room and every pirate standing on Saltwick. */
function harbor() {
  const deck = new Room<ServerMessage>("ship-1");
  const aboard = new Set<string>();
  const ships = {
    onAshore: null as ((pirateId: string, islandId: string) => void) | null,
    onBoarded: null as ((pirateId: string) => void) | null,
    roomOf: (pirateId: string) => (aboard.has(pirateId) ? { conns: deck } : null),
    pirateIsland: async () => "saltwick",
  };
  let now = 1_000;
  const social = new SocialService(ships as unknown as ShipService, () => now);
  return {
    social,
    tick: (ms: number) => (now += ms),
    board(member: Inbox) {
      aboard.add(member.id);
      deck.join(member);
      ships.onBoarded?.(member.id);
    },
    ashore(member: Inbox) {
      aboard.delete(member.id);
      deck.leave(member.id);
      ships.onAshore?.(member.id, "saltwick");
    },
  };
}

describe("walking", () => {
  it("goes to everyone else ashore on the island, and newcomers see where people stand", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.social.connected(anne.id, "Anne", anne);
    await h.social.connected(ben.id, "Ben", ben);
    h.social.walk(anne.id, { x: 0.5, z: -1.25 });
    expect(ben.of("walk.moved")).toEqual([{ type: "walk.moved", scope: "island", pirateId: anne.id, x: 0.5, z: -1.25 }]);
    expect(anne.of("walk.moved")).toEqual([]);

    const cid = new Inbox("p-cid");
    await h.social.connected(cid.id, "Cid", cid);
    const presence = cid.of("island.presence").at(-1)!;
    expect(presence.pirates.find((p) => p.pirateId === anne.id)?.at).toEqual({ x: 0.5, z: -1.25 });
    expect(presence.pirates.find((p) => p.pirateId === ben.id)?.at).toBeNull();
  });

  it("is paced: a walk hard on the heels of the last is dropped", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.social.connected(anne.id, "Anne", anne);
    await h.social.connected(ben.id, "Ben", ben);
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
      await h.social.connected(m.id, name, m);
    h.board(anne);
    h.social.walk(anne.id, { x: 0.2, z: 0.05 });
    // Ben and Cid are ashore: a deck walk is nothing to them.
    expect(ben.of("walk.moved")).toEqual([]);
    expect(cid.of("walk.moved")).toEqual([]);

    h.board(ben);
    expect(ben.of("walk.where").at(-1)).toEqual({ type: "walk.where", scope: "ship", walkers: [{ pirateId: anne.id, x: 0.2, z: 0.05 }] });
    h.tick(WALK_MIN_MS);
    h.social.walk(ben.id, { x: -0.1, z: 0 });
    expect(anne.of("walk.moved").at(-1)).toEqual({ type: "walk.moved", scope: "ship", pirateId: ben.id, x: -0.1, z: 0 });
    expect(cid.of("walk.moved")).toEqual([]);
  });

  it("is forgotten on leaving the place: back ashore a pirate has walked nowhere yet", async () => {
    const h = harbor();
    const anne = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    await h.social.connected(anne.id, "Anne", anne);
    await h.social.connected(ben.id, "Ben", ben);
    h.social.walk(anne.id, { x: 1, z: 1 });
    h.board(anne);
    h.tick(WALK_MIN_MS);
    h.social.walk(anne.id, { x: 0.1, z: 0.1 });
    h.ashore(anne);
    const presence = ben.of("island.presence").at(-1)!;
    expect(presence.pirates.find((p) => p.pirateId === anne.id)?.at).toBeNull();
  });
});
