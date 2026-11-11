/**
 * Who is connected, and the way to each pirate: one seat per pirate, the newest socket holds it, and
 * only the socket holding it gives it up. Rooms keep their own members and send through it.
 */
import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@openseas/protocol";
import { Presence } from "../src/presence.js";
import { Room } from "../src/rooms.js";
import { Inbox } from "./inbox.js";

const ping = (t: number): ServerMessage => ({ type: "pong", t, serverNow: t });

describe("Presence", () => {
  it("says what is addressed to a pirate on their newest socket", () => {
    const presence = new Presence();
    const first = new Inbox("p-anne");
    const second = new Inbox("p-anne");
    presence.attach("p-anne", first);
    presence.send("p-anne", ping(1));
    presence.attach("p-anne", second);
    presence.send("p-anne", ping(2));
    expect(first.got).toEqual([ping(1)]);
    expect(second.got).toEqual([ping(2)]);
  });

  it("lets only the socket holding the seat give it up: an older socket closing changes nothing", () => {
    const presence = new Presence();
    const old = new Inbox("p-anne");
    const fresh = new Inbox("p-anne");
    const closeOld = presence.attach("p-anne", old);
    const closeFresh = presence.attach("p-anne", fresh);
    expect(closeOld()).toBe(false);
    expect(presence.online("p-anne")).toBe(true);
    presence.send("p-anne", ping(1));
    expect(fresh.got).toEqual([ping(1)]);

    // The newest socket closing takes the pirate offline, once.
    expect(closeFresh()).toBe(true);
    expect(presence.online("p-anne")).toBe(false);
    expect(closeFresh()).toBe(false);
  });

  it("drops what is said to a pirate who is offline: nothing is queued for their return", () => {
    const presence = new Presence();
    const before = new Inbox("p-anne");
    presence.attach("p-anne", before)();
    presence.send("p-anne", ping(1));
    presence.send("p-nobody", ping(2));
    const back = new Inbox("p-anne");
    presence.attach("p-anne", back);
    expect(before.got).toEqual([]);
    expect(back.got).toEqual([]);
  });

  it("carries what a room says to each member's newest socket, and nothing to anyone outside it", () => {
    const presence = new Presence();
    const anne = new Inbox("p-anne");
    const anneAgain = new Inbox("p-anne");
    const ben = new Inbox("p-ben");
    const cid = new Inbox("p-cid");
    for (const line of [anne, ben, cid]) presence.attach(line.id, line);
    const deck = new Room<ServerMessage>("ship-1", presence);
    deck.join(anne.id);
    deck.join(ben.id);
    presence.attach(anneAgain.id, anneAgain);
    deck.broadcast(ping(1), ben.id);
    expect(deck.send(cid.id, ping(2))).toBe(false);
    expect(anne.got).toEqual([]);
    expect(anneAgain.got).toEqual([ping(1)]);
    expect(ben.got).toEqual([]);
    expect(cid.got).toEqual([]);
  });
});
