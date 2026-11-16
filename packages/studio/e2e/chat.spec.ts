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

  test("a message carries the model picked, what the build refuses and the rounds played, and the reply is read as markdown", async ({ page }) => {
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
    expect(sent.body).toMatchObject({ chat: null, text: "That felt too easy.", model: "opus", refusals: [] });
    const rounds = (sent.body as { rounds: Array<{ seed: string; score: number; tier: string; seconds: number; moves: number; tuned: boolean }> }).rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ score: 0, moves: 0, tuned: true });
    expect(rounds[0]!.seed).toMatch(/^local-/);
    expect(rounds[0]!.seconds).toBeGreaterThan(100);

    // The agent answers: a step, a number moved through its tool, its words, and the turn's end.
    s.say("step", { tool: "mcp__studio__set_numbers", summary: '{"set":{"config.pieceKinds":4}}', detail: "Set.", failed: false });
    s.drafts[0]!.numbers = numbers({ overrides: { pieceKinds: 4 } });
    s.drafts[0]!.revision += 1;
    s.say("reply", { text: "Four kinds now.\n\n- **Fewer** kinds\n- `pieceKinds` is 4\n\n<b>Not</b> markup: shown as written.\n\n![a picture](https://example.com/tracker.png)" });
    s.chat.spentUsd = 0.42;
    s.cap.spentUsd = 1.5;
    s.say("turn", { status: "done", commit: null, costUsd: 0.42, reverted: false });
    s.chat.running = false;

    // The control moved, with no click on it, and nothing was saved back over the agent's number.
    await expect(page.getByTestId("input-config.pieceKinds")).toHaveValue("4");
    await expect(page.getByTestId("draft-store")).toHaveAttribute("data-revision", "4");
    // The agent's words are markdown: a list, a code span. HTML in them is shown as written, never run, and a picture is its address, never fetched.
    const reply = page.getByTestId("chat-reply");
    await expect(reply).toContainText("Four kinds now.");
    await expect(reply.locator("li")).toHaveText(["Fewer kinds", "pieceKinds is 4"]);
    await expect(reply.locator("li code")).toHaveText("pieceKinds");
    await expect(reply).toContainText("<b>Not</b> markup: shown as written.");
    await expect(reply.locator("b, img")).toHaveCount(0);
    await expect(reply.getByRole("link", { name: "a picture" })).toHaveAttribute("href", "https://example.com/tracker.png");
    await expect(page.getByTestId("chat-step")).toHaveAttribute("data-state", "done");
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
    expect(s.writes.map((w) => w.call)).toEqual(["POST /drafts/draftdraft/chat", "POST /drafts/draftdraft/chat", "POST /chats/chatchat01/stop"]);
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
    expect(s.writes.at(-1)).toEqual({ call: "POST /chats/chatchat01/allow", body: { item: ask.id, allow: true } });

    await page.getByTestId("chat-revert").click();
    await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-reverted", "1");
    await expect(page.getByTestId("chat-revert")).toHaveCount(0);
    expect(s.writes.at(-1)).toEqual({ call: "POST /chats/chatchat01/revert", body: { turn: 1 } });
  });

  test("the reply is shown as it is written, and a turn that failed says why", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await write(page, "What does slag do?");
    s.say("step", { tool: "Read", summary: "docs/puzzles/cooling.md", detail: null, failed: false });
    await expect(page.getByTestId("chat-step")).toHaveAttribute("data-state", "running");
    // Half a reply, mid-emphasis: the words so far, with no stray marks.
    s.chat.live = "Slag blocks a **col";
    await expect(page.getByTestId("chat-live")).toHaveText("Slag blocks a col");
    s.chat.live = "Slag blocks a **column** until";
    await expect(page.getByTestId("chat-live")).toHaveText("Slag blocks a column until");
    await expect(page.getByTestId("chat-reply")).toHaveCount(0);
    // The whole reply takes its place.
    s.chat.live = "";
    s.say("reply", { text: "Slag blocks a **column** until it is cleared." });
    await expect(page.getByTestId("chat-reply")).toHaveText("Slag blocks a column until it is cleared.");
    await expect(page.getByTestId("chat-live")).toHaveCount(0);

    s.say("turn", { status: "failed", commit: null, costUsd: 0.02, reverted: false, reason: "agent", error: "No conversation found with session ID: 1234" });
    s.chat.running = false;
    const ended = page.getByTestId("chat-turn");
    await expect(ended).toHaveAttribute("data-reason", "agent");
    await expect(ended).toContainText("the agent stopped on an error");
    await ended.getByTestId("chat-turn-error").locator("summary").click();
    await expect(ended.getByTestId("chat-turn-error").locator("pre")).toHaveText("No conversation found with session ID: 1234");
    // The step never said how it went, and its turn is over: it is not shown as still running.
    await expect(page.getByTestId("chat-step")).toHaveAttribute("data-state", "cut");
    await expect(page.getByTestId("chat-working")).toHaveCount(0);
    await expect(page.getByTestId("chat-send")).toHaveText("Send");
  });

  test("with the live connection down the page says so, and still shows the chat", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    await page.goto("/cooling");
    await write(page, "Tidy up.");
    await expect(page.getByTestId("chat-working")).toBeVisible();
    await expect(page.getByTestId("chat-down")).toHaveCount(0);

    s.streamDown = true;
    await expect(page.getByTestId("chat-down")).toBeVisible({ timeout: 15_000 });
    // The rows are still the chat: asked for, they arrive.
    s.say("reply", { text: "Tidied." });
    s.say("turn", { status: "done", commit: null, costUsd: 0.01, reverted: false });
    s.chat.running = false;
    await expect(page.getByTestId("chat-reply")).toHaveText("Tidied.");
    await expect(page.getByTestId("chat-turn")).toHaveAttribute("data-status", "done");
    // A message sent meanwhile is shown all the same.
    await write(page, "And the guide?");
    await expect(page.getByTestId("chat-user").nth(1)).toContainText("And the guide?");

    s.streamDown = false;
    await expect(page.getByTestId("chat-down")).toHaveCount(0, { timeout: 30_000 });
    s.say("reply", { text: "The guide too." });
    await expect(page.getByTestId("chat-reply").nth(1)).toHaveText("The guide too.");
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

  test("every chat on the puzzle is in the list, to open, carry on, rename or delete, and a new one starts with a message", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    s.chat.title = "Slag";
    s.chat.turn = 1;
    s.say("user", { text: "Slag?", model: "sonnet", steer: false });
    s.say("reply", { text: "Rare." });
    s.say("turn", { status: "done", commit: null, costUsd: 0.1, reverted: false });
    const old = s.addChat({ id: "oldchat001", title: "The guide", draft: null, turn: 1, spentUsd: 0.3, updatedAt: "2026-11-01T12:00:00.000Z" });
    s.say("user", { text: "Rewrite the guide.", model: "opus", steer: false }, old);
    s.say("reply", { text: "Rewritten." }, old);
    s.say("turn", { status: "done", commit: null, costUsd: 0.3, reverted: false }, old);

    // Arriving, the page opens the draft's chat last spoken in.
    await page.goto("/cooling");
    await expect(page.getByTestId("chat-title")).toHaveText("Slag");
    await expect(page.getByTestId("chat-reply")).toHaveText("Rare.");
    await expect(page.getByTestId("chat-carried")).toHaveCount(0);

    // A new chat is empty until a message starts it; the message names no chat, and the page opens the one it made.
    await page.getByTestId("chat-new").click();
    await expect(page.getByTestId("chat-title")).toHaveText("New chat");
    await expect(page.getByTestId("chat-user")).toHaveCount(0);
    await expect(page.getByTestId("chat-input")).toBeFocused();
    await write(page, "A fresh question.");
    expect(s.writes.at(-1)).toMatchObject({ call: "POST /drafts/draftdraft/chat", body: { chat: null, text: "A fresh question." } });
    await expect(page.getByTestId("chat")).toHaveAttribute("data-chat", "newchat002");
    await expect(page.getByTestId("chat-title")).toHaveText("A fresh question.");
    await expect(page.getByTestId("chat-user")).toHaveText(/A fresh question\./);
    s.say("turn", { status: "done", commit: null, costUsd: 0.05, reverted: false }, s.others[1]);
    s.others[1]!.running = false;
    await expect(page.getByTestId("chat-working")).toHaveCount(0);

    // The list: this draft's chats, the newest first, then the one from a draft that is gone.
    await page.getByTestId("chat-list-toggle").click();
    const list = page.getByTestId("chat-list");
    await expect(list.getByTestId("chat-list-draft").getByTestId("chat-row")).toHaveCount(2);
    await expect(list.getByTestId("chat-list-draft").getByTestId("chat-row").first()).toHaveAttribute("data-chat", "newchat002");
    await expect(list.getByTestId("chat-list-draft").getByTestId("chat-row").first()).toHaveAttribute("aria-current", "true");
    const earlier = list.getByTestId("chat-list-earlier").getByTestId("chat-row");
    await expect(earlier).toHaveCount(1);
    await expect(earlier).toContainText("The guide");
    await expect(earlier).toContainText("1 turn");
    await expect(earlier).toContainText("$0.30");

    // An old chat opens as it was, and says a message carries it onto this draft.
    await earlier.click();
    await expect(list).toHaveCount(0);
    await expect(page.getByTestId("chat-title")).toHaveText("The guide");
    await expect(page.getByTestId("chat-reply")).toHaveText("Rewritten.");
    await expect(page.getByTestId("chat-carried")).toBeVisible();
    // It is the one opened again after a reload.
    await page.reload();
    await expect(page.getByTestId("chat-title")).toHaveText("The guide");
    await write(page, "Carry on.");
    expect(s.writes.at(-1)).toMatchObject({ call: "POST /drafts/draftdraft/chat", body: { chat: "oldchat001", text: "Carry on." } });
    await expect(page.getByTestId("chat-carried")).toHaveCount(0);
    s.say("turn", { status: "done", commit: null, costUsd: 0.05, reverted: false }, old);
    old.running = false;
    await expect(page.getByTestId("chat-working")).toHaveCount(0);

    // Renamed in place, and deleted after asking: the page then has a new chat open.
    await page.getByTestId("menu-chat-more").click();
    await page.getByTestId("chat-rename").click();
    await page.getByTestId("chat-title-input").fill("The guide, again");
    await page.getByTestId("chat-title-input").press("Enter");
    await expect(page.getByTestId("chat-title")).toHaveText("The guide, again");
    expect(s.writes.at(-1)).toEqual({ call: "PATCH /chats/oldchat001", body: { title: "The guide, again" } });
    await page.getByTestId("menu-chat-more").click();
    await page.getByTestId("chat-delete").click();
    await expect(page.getByTestId("chat-delete-confirm")).toBeVisible();
    await page.getByTestId("chat-delete-yes").click();
    await expect(page.getByTestId("chat-title")).toHaveText("New chat");
    expect(s.writes.at(-1)!.call).toBe("DELETE /chats/oldchat001");
    await page.getByTestId("chat-list-toggle").click();
    await expect(page.getByTestId("chat-row")).toHaveCount(2);
    await expect(page.getByTestId("chat-list-earlier")).toHaveCount(0);
  });

  test("a draft runs one turn at a time: another chat waits, says so, and leads to the one running", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    s.chat.title = "Running";
    s.chat.turn = 1;
    s.say("user", { text: "Work.", model: "sonnet", steer: false });
    s.chat.running = true;
    const idle = s.addChat({ id: "idlechat01", title: "Idle", updatedAt: "2026-11-01T12:00:00.000Z" });
    s.say("reply", { text: "Earlier words." }, idle);

    await page.goto("/cooling");
    // The running chat is the one opened.
    await expect(page.getByTestId("chat-title")).toHaveText("Running");
    await expect(page.getByTestId("chat-working")).toBeVisible();
    await page.getByTestId("chat-list-toggle").click();
    await expect(page.locator('[data-testid="chat-row"][data-chat="chatchat01"]')).toHaveAttribute("data-running", "1");
    await page.locator('[data-testid="chat-row"][data-chat="idlechat01"]').click();
    await expect(page.getByTestId("chat-waiting")).toBeVisible();
    await page.getByTestId("chat-input").fill("Meanwhile?");
    await expect(page.getByTestId("chat-send")).toBeDisabled();
    await page.getByTestId("chat-go-running").click();
    await expect(page.getByTestId("chat-title")).toHaveText("Running");
    await expect(page.getByTestId("chat-waiting")).toHaveCount(0);
    await expect(page.getByTestId("chat-stop")).toBeVisible();
  });

  test("at the cap no turn starts, and the page says why", async ({ page }) => {
    const s = await service(page, { login: "octo", save: true, chat: true, drafts: [draft({ save: NO_SAVE })] });
    s.cap = { spentUsd: 20, capUsd: 20 };
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
