import { expect, test, type Page } from "@playwright/test";
import { NO_SAVE, draft, numbers, service } from "./standin.js";
import { shown } from "./helpers.js";

/**
 * The chat (ADR 0047), on the studio page. The stand-in service (e2e/standin.ts) keeps a chat's
 * lines and says a turn is running until the test ends it; the agent, its worktree, the scope
 * and the cap are proven in packages/studio-server (test/chat.test.ts, test/sdkRunner.test.ts).
 */
const chat = (page: Page) => page.getByTestId("chat");
const write = async (page: Page, text: string): Promise<void> => {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
};

test.describe("chat", () => {
  test.beforeEach(() => test.skip(test.info().project.name !== "desktop", "the studio is a desktop tool"));

  test("a message carries the model picked, what the build refuses and the rounds played, and the reply is shown whole", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await expect(chat(page)).toBeVisible();
    await expect(page.getByTestId("chat-spend")).toContainText("$20.00");

    // A round is played to its end, so the message has one to speak of.
    await page.getByTestId("play-start").click();
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
    await page.evaluate(() => {
      window.openseasRoundClock!.pause();
      window.openseasRoundClock!.step(10 * 60 * 1000);
    });
    await expect(page.getByTestId("result-tier")).toBeVisible();

    await page.getByTestId("chat-model").selectOption("opus");
    await write(page, "That felt too easy.");
    await expect(page.getByTestId("chat-user")).toContainText("That felt too easy.");
    await expect(page.getByTestId("chat-working")).toBeVisible();
    const sent = s.writes.at(-1)!;
    expect(sent.call).toBe("POST /drafts/draftdraft/chat");
    expect(sent.body).toMatchObject({ text: "That felt too easy.", model: "opus", refusals: [] });
    const rounds = (sent.body as { rounds: Array<{ seed: string; score: number; tier: string; seconds: number; moves: number; tuned: boolean }> }).rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ score: 0, moves: 0, tuned: true });
    expect(rounds[0]!.seed).toMatch(/^local-/);
    expect(rounds[0]!.seconds).toBeGreaterThan(100);

    // The agent answers: a step, a number moved through its tool, its words, and the turn's end.
    s.say("step", { tool: "mcp__studio__set_numbers", summary: '{"set":{"config.pieceKinds":4}}', detail: "Set.", failed: false });
    s.drafts[0]!.numbers = numbers({ overrides: { pieceKinds: 4 } });
    s.drafts[0]!.revision += 1;
    s.say("reply", { text: "Four kinds now.\n\n  <b>Not</b> markup: shown as written." });
    s.chat.spentUsd = 0.42;
    s.chat.cap.spentUsd = 1.5;
    s.say("turn", { status: "done", commit: null, costUsd: 0.42, reverted: false });
    s.chat.running = false;

    // The control moved, with no click on it, and nothing was saved back over the agent's number.
    await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("4");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
    await expect(page.getByTestId("chat-reply")).toHaveText("Four kinds now.\n\n  <b>Not</b> markup: shown as written.");
    await expect(page.getByTestId("chat-step")).toContainText("set_numbers");
    await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-status", "done");
    await expect(page.getByTestId("chat-turn")).toContainText("$0.42");
    await expect(page.getByTestId("chat-spend")).toContainText("$1.50");
    await expect(page.getByTestId("chat-working")).toHaveCount(0);
    expect(s.writes.filter((w) => w.call.startsWith("PUT"))).toEqual([]);
    // The model picked is kept for the next message.
    await page.reload();
    await expect(page.getByTestId("chat-model")).toHaveValue("opus");
    await expect(page.getByTestId("chat-reply")).toBeVisible();
  });

  test("a message sent while a turn runs steers it, and Stop stops it", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await write(page, "Rewrite the design file.");
    await expect(page.getByTestId("chat-working")).toBeVisible();
    await expect(page.getByTestId("chat-send")).toHaveText("Steer");
    // Nothing else writes the draft's branch while the agent does.
    await page.getByTestId("chat-input").fill("Shorter than that.");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-user").nth(1)).toHaveAttribute("data-steer", "1");
    expect(s.chat.items.filter((i) => i.kind === "user").map((i) => i.turn)).toEqual([1, 1]);

    await page.getByTestId("chat-stop").click();
    await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-status", "stopped");
    await expect(page.getByTestId("chat-stop")).toHaveCount(0);
    await expect(page.getByTestId("chat-send")).toHaveText("Send");
    expect(s.writes.map((w) => w.call)).toEqual(["POST /drafts/draftdraft/chat", "POST /drafts/draftdraft/chat", "POST /drafts/draftdraft/chat/stop"]);
  });

  test("a refused write is the owner's to allow, and a turn's edits can be reverted", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    s.chat.turn = 1;
    s.say("user", { text: "Tidy up.", model: "sonnet", steer: false });
    s.say("step", { tool: "Edit", summary: "docs/puzzles/cooling.md", detail: "+ a line", failed: false });
    const ask = s.say("ask", { path: "docs/DESIGN.md", state: "pending" });
    s.say("reply", { text: "I edited the design file. That is a file change: Save, then look at the pull request's preview." });
    s.say("turn", { status: "done", commit: "abc123", costUsd: 0.1, reverted: false });
    await page.goto("/cooling");
    await expect(page.getByTestId("chat-ask")).toContainText("docs/DESIGN.md");
    await page.getByTestId("chat-step").locator("summary").click();
    await expect(page.getByTestId("chat-step").locator("pre")).toHaveText("+ a line");

    await page.getByTestId("chat-allow").click();
    await expect(page.getByTestId("chat-ask")).toHaveAttribute("data-state", "allowed");
    await expect(page.getByTestId("chat-allow")).toHaveCount(0);
    expect(s.writes.at(-1)).toEqual({ call: "POST /drafts/draftdraft/chat/allow", body: { item: ask.id, allow: true } });

    await page.getByTestId("chat-revert").click();
    await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-reverted", "1");
    await expect(page.getByTestId("chat-revert")).toHaveCount(0);
    expect(s.writes.at(-1)).toEqual({ call: "POST /drafts/draftdraft/chat/revert", body: { turn: 1 } });
  });

  test("the first message opens a draft for the chat to belong to", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true });
    await page.goto("/cooling");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-draft", "");
    await write(page, "What does slag do?");
    await expect(page.getByTestId("chat-user")).toContainText("What does slag do?");
    expect(s.writes.map((w) => w.call)).toEqual(["POST /drafts", "POST /drafts/newdraft22/chat"]);
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-draft", "newdraft22");
  });

  test("at the cap no turn starts, and the page says why", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    s.chat.cap = { spentUsd: 20, capUsd: 20 };
    await page.goto("/cooling");
    await expect(page.getByTestId("chat-capped")).toBeVisible();
    await page.getByTestId("chat-input").fill("One more?");
    await expect(page.getByTestId("chat-send")).toBeDisabled();
    // The rest of the page is as it was.
    await (await shown(page, "input-config.pieceKinds")).fill("4");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
  });

  test("there is no chat signed out, on a service without one, or with the service down", async ({ page }) => {
    await service(page, { login: "octo", save: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-status", "saved");
    await expect(chat(page)).toHaveCount(0);

    await page.unroute("http://localhost:8090/**");
    await service(page, { login: null, chat: true });
    await page.goto("/cooling");
    await expect(await shown(page, "sign-in-github")).toBeVisible();
    await expect(chat(page)).toHaveCount(0);

    await page.unroute("http://localhost:8090/**");
    await page.route("http://localhost:8090/**", (route) => route.abort());
    await page.goto("/cooling");
    await expect(await shown(page, "links-unreachable")).toBeVisible();
    await expect(chat(page)).toHaveCount(0);
    await page.getByTestId("play-start").click();
    await expect(page.getByTestId("cooling-canvas")).toBeVisible();
  });
});
