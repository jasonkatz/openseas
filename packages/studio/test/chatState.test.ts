import { describe, expect, it } from "vitest";
import type { ChatItem, ChatState } from "@openseas/protocol";
import { applyChatEvent } from "../src/service/chatState.js";

const at = "2026-11-14T12:00:00.000Z";
const draft = { id: "draftdraft", puzzle: "cooling", owner: "octo", numbers: { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: {}, sounds: {} } }, revision: 1, createdAt: at, updatedAt: at, save: { state: "idle", error: null, pull: null, savedRevision: null, behind: false, edits: false } } as ChatState["draft"];
const user: ChatItem = { id: 1, turn: 1, kind: "user", at, text: "Hello", model: "sonnet", steer: false };
const step: ChatItem = { id: 3, turn: 1, kind: "step", at, tool: "Bash", summary: "pnpm test", detail: null, failed: false };
const state = (over: Partial<ChatState> = {}): ChatState => ({ items: [user], running: true, spentUsd: 0, cap: { spentUsd: 0, capUsd: 20 }, draft, live: "", ...over });

describe("a chat, an event of its stream at a time", () => {
  it("is nothing until the whole chat has come, and is replaced whenever it comes again", () => {
    expect(applyChatEvent(null, { type: "delta", text: "Hi", reset: false })).toBeNull();
    expect(applyChatEvent(null, { type: "item", item: user })).toBeNull();
    const whole = state({ live: "So far" });
    expect(applyChatEvent(null, { type: "state", state: whole })).toBe(whole);
    expect(applyChatEvent(state({ items: [user, step], live: "Stale" }), { type: "state", state: whole })).toBe(whole);
  });

  it("adds a new line in the service's order, and replaces a line it has by its id", () => {
    const reply: ChatItem = { id: 2, turn: 1, kind: "reply", at, text: "Hi." };
    const added = applyChatEvent(state(), { type: "item", item: step })!;
    expect(added.items).toEqual([user, step]);
    // A line that arrives late still takes its own place.
    expect(applyChatEvent(added, { type: "item", item: reply })!.items).toEqual([user, reply, step]);
    const done = { ...step, detail: "passed" };
    expect(applyChatEvent(added, { type: "item", item: done })!.items).toEqual([user, done]);
    // Told twice, a line is there once.
    expect(applyChatEvent(added, { type: "item", item: step })!.items).toEqual([user, step]);
  });

  it("gathers the words of the reply being written, and forgets them when told to or when the turn ends", () => {
    let chat = applyChatEvent(state(), { type: "delta", text: "", reset: true })!;
    chat = applyChatEvent(chat, { type: "delta", text: "Slag is ", reset: false })!;
    chat = applyChatEvent(chat, { type: "delta", text: "rare.", reset: false })!;
    expect(chat.live).toBe("Slag is rare.");
    expect(applyChatEvent(chat, { type: "delta", text: "", reset: true })!.live).toBe("");
    const { items: _items, live: _live, ...status } = state({ running: true, spentUsd: 0.4 });
    expect(applyChatEvent(chat, { type: "status", status })).toMatchObject({ live: "Slag is rare.", spentUsd: 0.4, items: [user] });
    expect(applyChatEvent(chat, { type: "status", status: { ...status, running: false } })).toMatchObject({ live: "", running: false });
  });
});
