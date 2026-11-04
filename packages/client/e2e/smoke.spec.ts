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

const ME = { id: "p-me", name: "Salty Gull", guest: true, balance: 0, islandId: "saltwick", ratings: [], ships: [{ id: "ship-1", classId: "sloop", name: "The Salty Gull", islandId: "saltwick" }] };

type Loc = { kind: "docked"; islandId: string } | { kind: "at-sea"; routeId: string; from: string; to: string; progress: number; hail: null };

/** A pretend ship room: one crew member, boards dealt on request, every turn a little further along. */
class FakeShip {
  station: string | null = null;
  location: Loc = { kind: "docked", islandId: "saltwick" };
  turn = 0;
  sessions = 0;
  constructor(readonly ws: WebSocketRoute) {}

  snapshot(now: number) {
    return {
      shipId: "ship-1",
      name: "The Salty Gull",
      classId: "sloop",
      ownerId: ME.id,
      captainId: ME.id,
      crew: [{ pirateId: ME.id, name: ME.name, station: this.station, captain: true, away: false }],
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
        this.state([{ type: "station", pirateId: ME.id, name: ME.name, station: this.station }]);
        return;
      case "ship.sail":
        this.location = { kind: "at-sea", routeId: m.routeId as string, from: "saltwick", to: "gullhaven", progress: 0, hail: null };
        this.state([{ type: "sailed", routeId: m.routeId }]);
        return;
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
      case "puzzle.move":
        return;
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
  await page.getByTestId("island-back").click();
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");

  // The dock boards the pirate's own sloop; the scene moves in on the deck.
  await tapSpot(page, '[data-island="saltwick"][data-building="dock"]');
  await expect(page.getByTestId("dock-panel")).toBeVisible();
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await expect(page.getByTestId("deck-card")).toContainText("The Salty Gull");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "ship:ship-1");
  await expect(page.getByTestId("ship-water")).toHaveText("12%");

  // The wheel spot on deck takes the captain to the chart to pick a destination; then they set sail.
  await tapSpot(page, '[data-wheel="1"]');
  await expect(page.getByTestId("helm-card")).toBeVisible();
  await page.getByTestId("dest-gullhaven").click();
  await page.getByTestId("sail-now").click();
  // Under way, the card folds back to its strip: the ship's name, where it is bound, and the turn clock.
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("sheet")).toContainText("Gullhaven");
  await expect(page.getByTestId("mini-turn")).toBeVisible();

  // Taking a station spot opens its board over the deck; a board is dealt at once and takes a swap.
  await tapSpot(page, '[data-station="bilging"]');
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "station");
  await expect(page.getByTestId("station-view-bilging")).toBeVisible();
  await expect(page.getByTestId("duty-board-wrap")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  // The ship is three small bars until asked for; the full status unfolds on a tap.
  await page.getByTestId("station-ship-toggle").click();
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
