import { describe, expect, it } from "vitest";
import type { ChatItem, ChatState } from "@openseas/protocol";
import { applyChatEvent, chatToOpen } from "../src/service/chatState.js";

const at = "2026-11-14T12:00:00.000Z";
const draft = { id: "draftdraft", puzzle: "cooling", owner: "octo", numbers: { seed: null, overrides: {}, roundSeconds: null, paceSeconds: null, thresholds: null, picks: { sprites: {}, sounds: {} } }, revision: 1, createdAt: at, updatedAt: at, save: { state: "idle", error: null, pull: null, savedRevision: null, behind: false, edits: false } } as ChatState["draft"];
const user: ChatItem = { id: 1, turn: 1, kind: "user", at, text: "Hello", model: "sonnet", steer: false };
const step: ChatItem = { id: 3, turn: 1, kind: "step", at, tool: "Bash", summary: "pnpm test", detail: null, failed: false };
const summary = (running: boolean, spentUsd = 0): ChatState["chat"] => ({ id: "chatchatch", puzzle: "cooling", title: "Hello", draft: "draftdraft", turns: 1, spentUsd, running, createdAt: at, updatedAt: at });
const state = (over: Partial<ChatState> = {}): ChatState => ({ chat: summary(true), items: [user], busy: false, cap: { spentUsd: 0, capUsd: 20 }, draft, live: "", ...over });

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
    const { items: _items, live: _live, ...status } = state({ chat: summary(true, 0.4) });
    expect(applyChatEvent(chat, { type: "status", status })).toMatchObject({ live: "Slag is rare.", chat: { spentUsd: 0.4 }, items: [user] });
    expect(applyChatEvent(chat, { type: "status", status: { ...status, chat: summary(false, 0.4) } })).toMatchObject({ live: "", chat: { running: false } });
  });
});

describe("the chat a page opens on arriving (ADR 0060)", () => {
  const on = (id: string, draft: string | null, running = false): ChatState["chat"] => ({ ...summary(running), id, draft });
  const chats = [on("newest0000", null), on("drafts0001", "draftdraft"), on("drafts0002", "draftdraft", true), on("drafts0003", "draftdraft")];
  it("is the one last open, while it is there", () => {
    expect(chatToOpen(chats, "draftdraft", "newest0000")).toBe("newest0000");
    expect(chatToOpen(chats, "draftdraft", "gonegone00")).toBe("drafts0002");
  });
  it("else the draft's running one, else the draft's last spoken in, else a new one", () => {
    expect(chatToOpen(chats, "draftdraft", null)).toBe("drafts0002");
    expect(chatToOpen(chats.filter((c) => !c.running), "draftdraft", null)).toBe("drafts0001");
    // A chat of a draft that is gone waits in the list to be chosen: it is not opened for the owner.
    expect(chatToOpen(chats, null, null)).toBeNull();
    expect(chatToOpen([], "draftdraft", null)).toBeNull();
  });
});
