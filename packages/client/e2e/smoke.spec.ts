import { readFileSync } from "node:fs";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * Smoke of the shell (DESIGN.md 5.4): from the chart to a board and back, in one continuous session.
 * The server is stood in for by a fake that answers over the same wire: sign-in, the pirate, the
 * ship room and a dealt board. The boards themselves are smoked in the harness, which drives the
 * same board code (ADR 0019); here one swap on a dealt Bilging board proves the embedding.
 */

const content = JSON.parse(readFileSync(new URL("../../content/data/puzzles/bilging.json", import.meta.url), "utf8")) as {
  config: Record<string, unknown>;
  roundSeconds: number;
};
const battle = JSON.parse(readFileSync(new URL("../../content/data/puzzles/battle.json", import.meta.url), "utf8")) as {
  config: Record<string, unknown>;
  roundSeconds: number;
};
const swordfight = JSON.parse(readFileSync(new URL("../../content/data/puzzles/swordfight.json", import.meta.url), "utf8")) as {
  config: Record<string, unknown> & { width: number; height: number };
};

const ME = { id: "p-me", name: "Salty Gull", guest: true, balance: 0, islandId: "saltwick", ratings: [], ships: [{ id: "ship-1", classId: "sloop", name: "The Salty Gull", islandId: "saltwick" }] };
/** The deckhands a short-handed sloop signs on as it sails (DESIGN.md 3.4), at the stations they work first. */
const HANDS = [
  { pirateId: "mate:1", name: "Brackish Eel", station: "sailing" },
  { pirateId: "mate:2", name: "Windward Tern", station: "bilging" },
  { pirateId: "mate:3", name: "Drowsy Limpet", station: "carpentry" },
];

type Hail = { tierId: string; sinceTurn: number } | null;
type Loc = { kind: "docked"; islandId: string } | { kind: "at-sea"; routeId: string; from: string; to: string; progress: number; hail: Hail; battle: Hail };

/** A pretend ship room: one pirate and the deckhands, boards dealt on request, every turn a little further along. */
class FakeShip {
  station: string | null = null;
  /** Deckhands aboard and where each stands; signed on at sail. */
  hands: { pirateId: string; name: string; station: string | null }[] = [];
  location: Loc = { kind: "docked", islandId: "saltwick" };
  turn = 0;
  sessions = 0;
  /** Commit moves the captain's battle board sent. */
  commits = 0;
  /** The boarding melee, once a grapple lands: moves the pirate's swordfight board sent. */
  melee: { tierId: string } | null = null;
  meleeMoves = 0;
  /** When set, a won sea battle boards the brigand instead of paying out at once. */
  boarding = false;
  constructor(readonly ws: WebSocketRoute) {}

  /** Grappling hooks over: the melee opens with a board for the pirate and one brigand at the rail. */
  board(): void {
    if (this.location.kind !== "at-sea" || !this.location.battle) return;
    const now = Date.now();
    const tierId = this.location.battle.tierId;
    this.melee = { tierId };
    this.sessions += 1;
    const sessionId = `melee-${this.sessions}-0000000`;
    this.state([{ type: "boarding", tierId }]);
    this.send({
      type: "puzzle.started",
      sessionId,
      puzzle: "swordfight",
      seed: `smoke-melee-${this.sessions}`,
      config: { ...swordfight.config, foes: [], allies: [] },
      deadlineAt: now + 300_000,
      serverNow: now,
      melee: { shipId: "ship-1", tierId },
    });
    const empty = ".".repeat(swordfight.config.width * swordfight.config.height);
    this.send({
      type: "melee.boards",
      shipId: "ship-1",
      boards: [
        { pirateId: ME.id, name: ME.name, side: 0, cells: empty, pending: 0, out: false, points: 0 },
        { pirateId: null, name: "", side: 1, cells: empty, pending: 0, out: false, points: 0 },
      ],
      serverNow: now,
    });
    this.send({ type: "melee.incoming", sessionId, wrack: 2, blade: 0, from: tierId });
  }

  /** A brigand hails the ship. */
  hail(): void {
    if (this.location.kind !== "at-sea") return;
    this.location = { ...this.location, hail: { tierId: "marauder", sinceTurn: this.turn } };
    this.state([{ type: "hailed", tierId: "marauder" }]);
  }

  snapshot(now: number) {
    return {
      shipId: "ship-1",
      name: "The Salty Gull",
      classId: "sloop",
      ownerId: ME.id,
      captainId: ME.id,
      crew: [
        { pirateId: ME.id, name: ME.name, station: this.station, captain: true, away: false, mate: false },
        ...this.hands.map((h) => ({ ...h, captain: false, away: false, mate: true })),
      ],
      maxCrew: 6,
      inviteOnly: false,
      location: this.location,
      turn: this.turn,
      water: 120,
      damage: 40,
      loaded: 1,
      cannons: 4,
      lastTurn: this.turn ? { turn: this.turn, outputs: { bilging: 90, sailing: 0, carpentry: 0, gunnery: 0, navigation: 0 }, held: false, speed: 700, tokens: 2 } : null,
      nextTurnAt: now + 10_000,
      turnMs: 10_000,
      voyagesCompleted: 0,
      melee: this.melee,
    };
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  state(events: unknown[] = []): void {
    const now = Date.now();
    this.send({ type: "ship.state", ship: this.snapshot(now), events, serverNow: now });
  }

  handle(raw: string): void {
    const m = JSON.parse(raw) as Record<string, unknown> & { type: string };
    const now = Date.now();
    switch (m.type) {
      case "board.list":
        this.send({ type: "board.ships", islandId: "saltwick", ships: [], serverNow: now });
        return;
      case "island.who":
        this.send({ type: "island.presence", islandId: "saltwick", pirates: [{ pirateId: ME.id, name: ME.name }] });
        return;
      case "chat.send":
        this.send({ type: "chat.message", channel: m.channel, pirateId: ME.id, name: ME.name, text: m.text, at: now });
        return;
      case "ship.board":
        this.state([
          { type: "boarded", pirateId: ME.id, name: ME.name },
          { type: "wheel", pirateId: ME.id, name: ME.name },
        ]);
        return;
      case "ship.station":
        this.station = m.station as string | null;
        // A deckhand at the station steps aside for the pirate.
        this.hands = this.hands.map((h) => (h.station === this.station ? { ...h, station: null } : h));
        this.state([{ type: "station", pirateId: ME.id, name: ME.name, station: this.station }]);
        return;
      case "ship.sail":
        this.location = { kind: "at-sea", routeId: m.routeId as string, from: "saltwick", to: "gullhaven", progress: 0, hail: null, battle: null };
        this.hands = HANDS.map((h) => ({ ...h }));
        this.state([{ type: "sailed", routeId: m.routeId }, ...this.hands.map((h) => ({ type: "hired", pirateId: h.pirateId, name: h.name, station: h.station }))]);
        return;
      case "ship.engage": {
        if (this.location.kind !== "at-sea" || !this.location.hail) {
          this.send({ type: "error", code: "not_hailed" });
          return;
        }
        const tierId = this.location.hail.tierId;
        this.location = { ...this.location, hail: null, battle: { tierId, sinceTurn: this.turn } };
        this.sessions += 1;
        const sessionId = `battle-${this.sessions}-0000000`;
        this.state([{ type: "engaged", tierId }]);
        this.send({
          type: "puzzle.started",
          sessionId,
          puzzle: "battle",
          seed: `smoke-fight-${this.sessions}`,
          config: { ...battle.config, turnSeconds: 10, supply: null },
          deadlineAt: now + 600_000,
          serverNow: now,
          battle: { shipId: "ship-1", tierId },
        });
        this.send({ type: "battle.supply", sessionId, left: 1, forward: 2, right: 1, cannons: 2, hull: 40 });
        return;
      }
      case "duty.start": {
        if (!this.station || this.location.kind !== "at-sea") {
          this.send({ type: "error", code: this.station ? "not_at_sea" : "no_station" });
          return;
        }
        this.sessions += 1;
        this.send({
          type: "puzzle.started",
          sessionId: `session-${this.sessions}-0000000`,
          puzzle: this.station,
          seed: `smoke-${this.sessions}`,
          config: content.config,
          deadlineAt: now + content.roundSeconds * 1000,
          serverNow: now,
          duty: { shipId: "ship-1", station: this.station },
        });
        return;
      }
      case "puzzle.move": {
        const move = m.move as { type: string };
        if (this.melee && String(m.sessionId).startsWith("melee-")) {
          this.meleeMoves += 1;
          if (move.type !== "place") return;
          // One drop wins the rail here: the brigand crew is beaten and the purse shared.
          const tierId = this.melee.tierId;
          this.send({ type: "melee.over", sessionId: m.sessionId, won: true, tick: 0 });
          this.send({ type: "puzzle.result", sessionId: m.sessionId, score: 400, moves: 1, bestCombo: 0, verified: true, rating: null, tierChange: null });
          this.melee = null;
          if (this.location.kind === "at-sea") this.location = { ...this.location, battle: null };
          this.state([{ type: "battle_ended", tierId, outcome: "boarded", booty: 600, turns: 1 }]);
          return;
        }
        if (move.type !== "commit" || this.location.kind !== "at-sea" || !this.location.battle) return;
        // One plot is a whole fight here: the brigand strikes her colours and the purse is shared.
        this.commits += 1;
        const tierId = this.location.battle.tierId;
        this.send({ type: "puzzle.result", sessionId: m.sessionId, score: 740, moves: 1, bestCombo: 1, verified: true, rating: null, tierChange: null });
        if (this.boarding) {
          this.board();
          return;
        }
        this.location = { ...this.location, battle: null };
        this.state([{ type: "battle_ended", tierId, outcome: "boarded", booty: 600, turns: 1 }]);
        return;
      }
      case "puzzle.finish":
      case "puzzle.abandon":
        this.send({ type: "puzzle.result", sessionId: m.sessionId, score: 12, moves: 1, bestCombo: 1, verified: true, rating: null, tierChange: null });
        return;
      case "ship.leave":
        this.send({ type: "ship.left", shipId: "ship-1", reason: "left" });
        this.send({ type: "pirate.updated", pirate: ME });
        return;
      default:
        return;
    }
  }
}

/** Tap a spot hung on the geometry once the camera has stopped gliding; the hull it rides bobs, so Playwright's own stillness check never passes. */
async function tapSpot(page: Page, selector: string): Promise<void> {
  const spot = page.locator(selector);
  await expect(spot).toBeVisible();
  let last = "";
  for (let i = 0; i < 12; i++) {
    const box = await spot.boundingBox();
    const key = box ? `${Math.round(box.x)},${Math.round(box.y)}` : "";
    if (key && key === last) break;
    last = key;
    await page.waitForTimeout(250);
  }
  await spot.click({ force: true });
}

/** Stand a fake server behind the page: HTTP for sign-in and the pirate, a routed socket for the rest. */
async function fakeServer(page: Page): Promise<{ ship: () => FakeShip | null }> {
  let ship: FakeShip | null = null;
  await page.route("**/api/me", (route) => route.fulfill({ json: { pirate: ME, inviteRequired: false } }));
  await page.route("**/api/auth/**", (route) => route.fulfill({ json: { data: { session: { id: "s" }, user: { id: "u", isAnonymous: true } } } }));
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ship = new FakeShip(ws);
    ws.send(JSON.stringify({ type: "welcome", pirate: ME, serverNow: Date.now() }));
    ws.send(JSON.stringify({ type: "island.presence", islandId: "saltwick", pirates: [{ pirateId: ME.id, name: ME.name }] }));
    ws.onMessage((raw) => ship?.handle(String(raw)));
  });
  return { ship: () => ship };
}

test("without the server, the landing says the ocean is out of reach", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas" })).toBeVisible();
  await expect(page.getByTestId("landing")).toHaveAttribute("data-phase", "offline");
  await expect(page.getByTestId("retry")).toBeVisible();
});

test("from the chart to an island, aboard, to sea, to a board and back ashore, in one scene", async ({ page }) => {
  // A software-rendered world on a CI runner draws slowly; the walk through it needs room.
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");

  // The pirate is signed in and standing on their island; the card is folded to a strip.
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "island");
  await expect(page.getByTestId("pirate-name")).toHaveText(ME.name);
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "island:saltwick");
  // The strip says the obvious next thing to do: board the sloop at the dock.
  await expect(page.getByTestId("next-step")).toContainText("The Salty Gull");

  // The map button zooms out to the chart and back; the frame stays.
  await page.getByTestId("map-toggle").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "chart");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "all");
  await page.getByTestId("map-toggle").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "island");

  // A building spot in the world opens its room in the card: the tavern knows who is ashore and takes a line of chat.
  await tapSpot(page, '[data-island="saltwick"][data-building="tavern"]');
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "1");
  await expect(page.getByTestId("tavern-panel")).toBeVisible();
  await page.getByTestId("chat-input-island").fill("ahoy");
  await page.getByTestId("chat-input-island").press("Enter");
  await expect(page.getByTestId("chat-island")).toContainText("ahoy");
  // Back steps out of the room to the island's buildings with the card still open; the chevron folds it.
  await page.getByTestId("island-back").click();
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "1");
  await expect(page.getByTestId("island-card")).toHaveAttribute("data-room", "none");
  await expect(page.getByTestId("building-dock")).toBeVisible();
  await page.getByTestId("sheet-toggle").click();
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");

  // The dock boards the pirate's own sloop; the scene moves in on the deck.
  await tapSpot(page, '[data-island="saltwick"][data-building="dock"]');
  await expect(page.getByTestId("dock-panel")).toBeVisible();
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await expect(page.getByTestId("deck-card")).toContainText("The Salty Gull");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "ship:ship-1");
  await expect(page.getByTestId("ship-water")).toHaveText("12%");
  // Docked, the next thing is the wheel; the wheel spot is lit as such.
  await expect(page.getByTestId("next-step")).toContainText("set sail");
  await expect(page.locator('[data-wheel="1"]')).toHaveClass(/is-primary/);

  // The wheel spot on deck takes the captain to the chart to pick a destination; then they set sail.
  await tapSpot(page, '[data-wheel="1"]');
  await expect(page.getByTestId("helm-card")).toBeVisible();
  await page.getByTestId("dest-gullhaven").click();
  await page.getByTestId("sail-now").click();
  // Under way, the card folds back to its strip: the ship's name, where it is bound, and the turn clock.
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("sheet")).toContainText("Gullhaven");
  await expect(page.getByTestId("mini-turn")).toBeVisible();
  // At sea without a station, the next thing is a station.
  await expect(page.getByTestId("next-step")).toContainText("station");
  // Sailing alone signed on deckhands: they stand at stations, marked apart from the pirates, and the log says so.
  await expect(page.locator('[data-station="bilging"]')).toHaveAttribute("data-holder", "mate");
  await expect(page.locator('[data-station="bilging"]')).toContainText("Windward Tern");
  await page.getByTestId("sheet-toggle").click();
  await expect(page.getByTestId("crew-mate")).toHaveCount(3);
  await expect(page.getByTestId("crew-mate").first()).toContainText("Deckhand");
  await expect(page.getByTestId("ship-log")).toContainText("signed on as a deckhand");
  await expect(page.getByTestId("station-bilging")).toBeEnabled();
  await page.getByTestId("sheet-toggle").click();

  // Taking a deckhand's station spot opens its board over the deck; the hand steps aside, a board is dealt at once and takes a swap.
  await tapSpot(page, '[data-station="bilging"]');
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "station");
  await expect.poll(() => server.ship()?.hands.find((h) => h.pirateId === "mate:2")?.station ?? "unset").toBeNull();
  await expect(page.getByTestId("station-view-bilging")).toBeVisible();
  await expect(page.getByTestId("duty-board-wrap")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  // On a phone the ship is two labeled bars until asked for, and the full status unfolds on a tap;
  // a wide screen keeps it unfolded in a rail beside the board.
  const shipToggle = page.getByTestId("station-ship-toggle");
  if (await shipToggle.isVisible()) await shipToggle.click();
  await expect(page.getByTestId("station-details")).toBeVisible();
  await expect(page.getByTestId("station-details").getByTestId("ship-water")).toHaveText("12%");
  await expect(page.getByTestId("bilging-board")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const s = server.ship();
      return s ? s.sessions : 0;
    })
    .toBeGreaterThan(0);

  // Back to the deck, then ashore from the unfolded card: the scene pulls out to the island.
  await page.getByTestId("station-back").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await page.getByTestId("sheet-toggle").click();
  await page.getByTestId("go-ashore").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "island");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "island:saltwick");
  await expect(page.getByTestId("sheet")).toContainText("Saltwick");

  // The menu is the same everywhere and carries the settings.
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu")).toBeVisible();
  await page.getByTestId("toggle-marks").check();
  await page.getByTestId("menu-close").click();
  await expect(page.getByTestId("menu")).toHaveCount(0);
});

test("a brigand's hail is engaged at the wheel and the captain's battle board opens over the deck", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "island");
  await tapSpot(page, '[data-island="saltwick"][data-building="dock"]');
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await tapSpot(page, '[data-wheel="1"]');
  await page.getByTestId("dest-gullhaven").click();
  await page.getByTestId("sail-now").click();
  await expect(page.getByTestId("sheet")).toContainText("Gullhaven");

  // The hail floats over the view with the captain's two answers; engaging deals the battle board.
  await expect.poll(() => server.ship() !== null).toBe(true);
  server.ship()!.hail();
  await expect(page.getByTestId("ship-hail")).toBeVisible();
  await page.getByTestId("engage").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "battle");
  await expect(page.getByTestId("battle-view")).toBeVisible();
  await expect(page.getByTestId("battle-view")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
  await expect(page.getByTestId("sheet")).toContainText("Marauder");
  // The ship's deal is on the board: tokens to plot with. Plot ahead and sail it now.
  await page.keyboard.press("w");
  await expect(page.getByTestId("battle-plan")).toHaveAttribute("data-plan", /"move":"forward"/);
  await page.keyboard.press("Enter");
  await expect.poll(() => server.ship()?.commits ?? 0).toBeGreaterThan(0);
  // The fight is over: the outcome card, the purse in a toast, and the deck again.
  await expect(page.getByTestId("battle-result")).toBeVisible();
  await expect(page.getByTestId("toasts")).toContainText("Marauder");
  await page.getByTestId("battle-back").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await page.getByTestId("sheet-toggle").click();
  await expect(page.getByTestId("ship-log")).toContainText("Marauder");
});

test("a boarding takes everyone to the rail: the swordfight board opens over the deck and the melee pays out", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "island");
  await tapSpot(page, '[data-island="saltwick"][data-building="dock"]');
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await tapSpot(page, '[data-wheel="1"]');
  await page.getByTestId("dest-gullhaven").click();
  await page.getByTestId("sail-now").click();
  await expect.poll(() => server.ship() !== null).toBe(true);
  server.ship()!.boarding = true;
  server.ship()!.hail();
  await page.getByTestId("engage").click();
  await expect(page.getByTestId("battle-view")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
  // The board takes keys once its canvas is live; ask again until the plot shows the move.
  await expect
    .poll(
      async () => {
        await page.keyboard.press("w");
        return page.getByTestId("battle-plan").getAttribute("data-plan");
      },
      { timeout: 15_000 },
    )
    .toMatch(/"move":"forward"/);
  await page.keyboard.press("Enter");
  await expect.poll(() => server.ship()?.commits ?? 0).toBeGreaterThan(0);

  // The grapple lands: the melee opens, everyone is sent to the rail, the board is dealt and the brigand's wrack is announced.
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "melee", { timeout: 15_000 });
  await expect(page.getByTestId("melee-view")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  await expect(page.getByTestId("swordfight-canvas")).toBeVisible();
  await expect(page.getByTestId("toasts")).toContainText("Boarding");
  await expect(page.getByTestId("sheet")).toContainText("Boarding the Marauder");
  // The board logs the announced wrack and its waits, then a drop: one is enough for this brigand.
  await expect.poll(() => server.ship()?.meleeMoves ?? 0).toBeGreaterThan(0);
  await page.keyboard.down(" ");
  await expect(page.getByTestId("melee-view")).toHaveAttribute("data-phase", "result", { timeout: 20_000 });
  await page.keyboard.up(" ");
  await expect(page.getByTestId("melee-result")).toBeVisible();
  await expect(page.getByTestId("melee-result")).toContainText("Victory");
  await expect(page.getByTestId("toasts")).toContainText("Marauder");
  await page.getByTestId("melee-back").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
});
