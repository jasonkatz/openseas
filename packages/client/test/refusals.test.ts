/**
 * Whose a refusal from the server is (ADR 0043): one row per refusal, and every requester that takes
 * it. A refusal that names its request goes to what sent that request; one that names none, from an
 * older server, is routed by its code as before.
 */
import { describe, expect, it } from "vitest";
import type { ErrorMessage } from "@openseas/protocol";
import { isRefusalFor, type RefusalContext, type Requester } from "../src/state/refusals.js";

const REQUESTERS: readonly Requester[] = ["ship", "duty", "crew", "sheet"];

function takers(m: Omit<ErrorMessage, "type">, ctx: RefusalContext = {}): Requester[] {
  return REQUESTERS.filter((r) => isRefusalFor({ type: "error", ...m }, r, ctx));
}

describe("a refusal that names its request", () => {
  it("goes to the station alone when it refuses the station's own deal", () => {
    expect(takers({ code: "in_battle", for: "duty.start" })).toEqual(["duty"]);
    expect(takers({ code: "not_in_flight", for: "duty.start" })).toEqual(["duty"]);
    expect(takers({ code: "internal", for: "duty.start" })).toEqual(["duty"]);
  });

  it("goes to the ship when a ship action the player took is refused, whatever its code", () => {
    expect(takers({ code: "not_hailed", for: "ship.engage" })).toEqual(["ship"]);
    expect(takers({ code: "in_battle", for: "ship.station" })).toEqual(["ship"]);
    expect(takers({ code: "internal", for: "ship.board" })).toEqual(["ship"]);
    expect(takers({ code: "aboard_a_ship", for: "shipyard.buy" })).toEqual(["ship"]);
  });

  it("goes to the one card that asked for the price, crew card open or not", () => {
    expect(takers({ code: "short_of_credits", for: "shipyard.buy" }, { crewPanelOpen: true })).toEqual(["ship"]);
    expect(takers({ code: "short_of_credits", for: "crew.found" })).toEqual(["crew"]);
    expect(takers({ code: "short_of_credits", for: "crew.found" }, { crewPanelOpen: true })).toEqual(["crew"]);
  });

  it("goes to the crew card and the sheet for their own requests", () => {
    expect(takers({ code: "no_such_pirate", for: "pirate.profile" })).toEqual(["crew"]);
    expect(takers({ code: "crew_rank_low", for: "crew.invite" })).toEqual(["crew"]);
    expect(takers({ code: "title_locked", for: "pirate.title" })).toEqual(["sheet"]);
    expect(takers({ code: "look_bad", for: "pirate.look" })).toEqual(["sheet"]);
  });

  it("goes to the card that holds the chat's channel", () => {
    expect(takers({ code: "not_in_crew", for: "chat.send" })).toEqual(["crew"]);
    expect(takers({ code: "not_aboard", for: "chat.send" })).toEqual(["ship"]);
    expect(takers({ code: "aboard_a_ship", for: "chat.send" })).toEqual(["ship"]);
  });

  it("goes to nobody when the scene or a board's session asked by itself", () => {
    expect(takers({ code: "not_aboard", for: "melee.join" })).toEqual([]);
    expect(takers({ code: "internal", for: "walk.to" })).toEqual([]);
    expect(takers({ code: "internal", for: "outpost.who" })).toEqual([]);
    expect(takers({ code: "unknown_session", for: "puzzle.finish" })).toEqual([]);
  });
});

describe("a refusal that names no request, from an older server", () => {
  it("is routed by its code, as before the server named requests", () => {
    expect(takers({ code: "in_battle" })).toEqual(["ship", "duty"]);
    expect(takers({ code: "not_hailed" })).toEqual(["ship"]);
    expect(takers({ code: "short_of_credits" })).toEqual(["ship"]);
    expect(takers({ code: "short_of_credits" }, { crewPanelOpen: true })).toEqual(["ship", "crew"]);
    expect(takers({ code: "not_in_crew" })).toEqual(["crew"]);
    expect(takers({ code: "title_locked" })).toEqual(["sheet"]);
  });

  it("reaches nobody when it was no request at all", () => {
    expect(takers({ code: "rate_limited" })).toEqual([]);
    expect(takers({ code: "bad_message" })).toEqual([]);
    expect(takers({ code: "internal" })).toEqual([]);
  });
});
