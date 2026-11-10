import { readFileSync } from "node:fs";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * Smoke of the shell (DESIGN.md 5.4): from the chart to a board and back, in one continuous session.
 * The server is stood in for by a fake that answers over the same wire: sign-in, the pirate, the
 * ship room and a dealt board. The boards themselves are smoked in the harness, which drives the
 * same board code (ADR 0019); here one swap on a dealt Cooling board proves the embedding.
 */

const content = JSON.parse(readFileSync(new URL("../../content/data/puzzles/cooling.json", import.meta.url), "utf8")) as {
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

const ME = { id: "p-me", name: "Static Comet", guest: true, balance: 0, outpostId: "tinwick", ratings: [], ships: [{ id: "ship-1", classId: "skiff", name: "The Static Comet", outpostId: "tinwick" }] };
/** The bots a short-handed skiff boots up as it flies (DESIGN.md 3.4), at the stations they work first. */
const HANDS = [
  { pirateId: "bot:1", name: "Gasket-7", station: "engines" },
  { pirateId: "bot:2", name: "Sprocket-12", station: "cooling" },
  { pirateId: "bot:3", name: "Widget-3", station: "plating" },
];

const pirates = JSON.parse(readFileSync(new URL("../../content/data/world/pirates.json", import.meta.url), "utf8")) as { titles: { id: string }[] };
/** What the server says of the pirate's record: one voyage flown, and the titles that earned. */
const SHEET = {
  record: { since: Date.UTC(2026, 9, 1), voyages: 1, captained: 1, victories: 0, plunder: 0, boards: 4 },
  titles: pirates.titles.map((x) => ({ id: x.id, earned: ["dirtsider", "lane-rider", "skipper"].includes(x.id), have: x.id === "void-hound" ? 1 : 0, need: x.id === "void-hound" ? 10 : 1 })),
};

type Hail = { tierId: string; sinceTurn: number } | null;
type Loc = { kind: "docked"; outpostId: string } | { kind: "in-flight"; laneId: string; from: string; to: string; progress: number; hail: Hail; battle: Hail };

/** A pretend ship room: one pirate and the bots, boards dealt on request, every turn a little further along. */
class FakeShip {
  station: string | null = null;
  /** Bots aboard and where each stands; booted up at launch. */
  hands: { pirateId: string; name: string; station: string | null }[] = [];
  location: Loc = { kind: "docked", outpostId: "tinwick" };
  turn = 0;
  sessions = 0;
  /** Commit moves the captain's battle board sent. */
  commits = 0;
  /** The boarding melee, once a grapple lands: moves the pirate's swordfight board sent. */
  melee: { tierId: string } | null = null;
  meleeMoves = 0;
  /** When set, a won space battle boards the raider instead of paying out at once. */
  boarding = false;
  /** The pirate's own sheet: what they wear and the title they show, and the looks and titles they sent. */
  look: { jacket: string; headgear: string } | null = null;
  title: string | null = null;
  readonly looks: { jacket: string; headgear: string }[] = [];
  /** Every message the page sent, oldest first. */
  readonly got: (Record<string, unknown> & { type: string })[] = [];
  constructor(
    readonly ws: WebSocketRoute,
    /** Who else is at Tinwick, and where they last walked. */
    readonly onOutpost: { pirateId: string; name: string; at?: { x: number; z: number } | null }[] = [],
  ) {}

  presence(): unknown {
    return { type: "outpost.presence", outpostId: "tinwick", pirates: [{ pirateId: ME.id, name: ME.name }, ...this.onOutpost] };
  }

  /** The pirate as the server would describe them now. */
  me() {
    return { ...ME, look: this.look, title: this.title };
  }

  /** Grappling hooks over: the melee opens with a board for the pirate and one raider at the airlock. */
  board(): void {
    if (this.location.kind !== "in-flight" || !this.location.battle) return;
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
    this.send({ type: "melee.incoming", sessionId, scrap: 2, blade: 0, from: tierId });
  }

  /** A raider hails the ship. */
  hail(): void {
    if (this.location.kind !== "in-flight") return;
    this.location = { ...this.location, hail: { tierId: "marauder", sinceTurn: this.turn } };
    this.state([{ type: "hailed", tierId: "marauder" }]);
  }

  snapshot(now: number) {
    return {
      shipId: "ship-1",
      name: "The Static Comet",
      classId: "skiff",
      ownerId: ME.id,
      captainId: ME.id,
      crew: [
        { pirateId: ME.id, name: ME.name, station: this.station, captain: true, away: false, bot: false },
        ...this.hands.map((h) => ({ ...h, captain: false, away: false, bot: true })),
      ],
      maxCrew: 6,
      inviteOnly: false,
      location: this.location,
      turn: this.turn,
      heat: 120,
      damage: 40,
      loaded: 1,
      turrets: 4,
      lastTurn: this.turn ? { turn: this.turn, outputs: { cooling: 90, engines: 0, plating: 0, gunnery: 0, navigation: 0 }, held: false, speed: 700, tokens: 2 } : null,
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
    this.got.push(m);
    const now = Date.now();
    switch (m.type) {
      case "board.list":
        this.send({ type: "board.ships", outpostId: "tinwick", ships: [], serverNow: now });
        return;
      case "outpost.who":
        this.send(this.presence());
        return;
      case "pirate.profile": {
        const p = this.onOutpost.find((a) => a.pirateId === m.pirateId);
        if (p) this.send({ type: "pirate.profile", profile: { pirateId: p.pirateId, name: p.name, crew: null, ratings: [], voyages: 3, online: true, invited: false } });
        return;
      }
      case "chat.send":
        this.send({ type: "chat.message", channel: m.channel, pirateId: ME.id, name: ME.name, text: m.text, at: now });
        return;
      case "ship.board":
        this.state([
          { type: "boarded", pirateId: ME.id, name: ME.name },
          { type: "helm", pirateId: ME.id, name: ME.name },
        ]);
        return;
      case "ship.station":
        this.station = m.station as string | null;
        // A bot at the station steps aside for the pirate.
        this.hands = this.hands.map((h) => (h.station === this.station ? { ...h, station: null } : h));
        this.state([{ type: "station", pirateId: ME.id, name: ME.name, station: this.station }]);
        return;
      case "ship.assign": {
        const hand = this.hands.find((h) => h.pirateId === m.pirateId);
        if (!hand) return;
        hand.station = m.station as string | null;
        this.state([{ type: "station", pirateId: hand.pirateId, name: hand.name, station: hand.station }]);
        return;
      }
      case "ship.launch":
        this.location = { kind: "in-flight", laneId: m.laneId as string, from: "tinwick", to: "echo-rock", progress: 0, hail: null, battle: null };
        this.hands = HANDS.map((h) => ({ ...h }));
        this.state([{ type: "launched", laneId: m.laneId }, ...this.hands.map((h) => ({ type: "booted_up", pirateId: h.pirateId, name: h.name, station: h.station }))]);
        return;
      case "ship.engage": {
        if (this.location.kind !== "in-flight" || !this.location.hail) {
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
        this.send({ type: "battle.supply", sessionId, left: 1, forward: 2, right: 1, turrets: 2, hull: 40 });
        return;
      }
      case "duty.start": {
        if (!this.station || this.location.kind !== "in-flight") {
          this.send({ type: "error", code: this.station ? "not_in_flight" : "no_station" });
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
          // One drop wins the airlock here: the raider crew is beaten and the purse shared.
          const tierId = this.melee.tierId;
          this.send({ type: "melee.over", sessionId: m.sessionId, won: true, tick: 0 });
          this.send({ type: "puzzle.result", sessionId: m.sessionId, score: 400, moves: 1, bestCombo: 0, verified: true, rating: null, tierChange: null, performance: { rating: 1500, tier: "steady" } });
          this.melee = null;
          if (this.location.kind === "in-flight") this.location = { ...this.location, battle: null };
          this.state([{ type: "battle_ended", tierId, outcome: "boarded", plunder: 600, turns: 1 }]);
          return;
        }
        if (move.type !== "commit" || this.location.kind !== "in-flight" || !this.location.battle) return;
        // One plot is a whole fight here: the raider strikes her colours and the purse is shared.
        this.commits += 1;
        const tierId = this.location.battle.tierId;
        this.send({ type: "puzzle.result", sessionId: m.sessionId, score: 740, moves: 1, bestCombo: 1, verified: true, rating: null, tierChange: null, performance: { rating: 1500, tier: "steady" } });
        if (this.boarding) {
          this.board();
          return;
        }
        this.location = { ...this.location, battle: null };
        this.state([{ type: "battle_ended", tierId, outcome: "boarded", plunder: 600, turns: 1 }]);
        return;
      }
      case "puzzle.finish":
      case "puzzle.abandon":
        this.send({ type: "puzzle.result", sessionId: m.sessionId, score: 12, moves: 1, bestCombo: 1, verified: true, rating: null, tierChange: null, performance: { rating: 1500, tier: "steady" } });
        return;
      case "ship.leave":
        this.send({ type: "ship.left", shipId: "ship-1", reason: "left" });
        this.send({ type: "pirate.updated", pirate: this.me() });
        return;
      case "pirate.sheet":
        this.send({ type: "pirate.sheet", sheet: SHEET });
        return;
      case "pirate.look":
        this.look = m.look as { jacket: string; headgear: string };
        this.looks.push(this.look);
        this.send({ type: "pirate.updated", pirate: this.me() });
        return;
      case "pirate.title":
        if (m.title !== null && !SHEET.titles.some((x) => x.id === m.title && x.earned)) {
          this.send({ type: "error", code: "title_locked" });
          return;
        }
        this.title = m.title as string | null;
        this.send({ type: "pirate.updated", pirate: this.me() });
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
async function fakeServer(page: Page, onOutpost: FakeShip["onOutpost"] = []): Promise<{ ship: () => FakeShip | null }> {
  let ship: FakeShip | null = null;
  await page.route("**/api/me", (route) => route.fulfill({ json: { pirate: ME, inviteRequired: false } }));
  await page.route("**/api/auth/**", (route) => route.fulfill({ json: { data: { session: { id: "s" }, user: { id: "u", isAnonymous: true } } } }));
  await page.routeWebSocket(/\/ws$/, (ws) => {
    ship = new FakeShip(ws, onOutpost);
    ws.send(JSON.stringify({ type: "welcome", pirate: ME, serverNow: Date.now() }));
    ws.send(JSON.stringify(ship.presence()));
    ws.onMessage((raw) => ship?.handle(String(raw)));
  });
  return { ship: () => ship };
}

test("without the server, the landing says the star system is out of reach", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "openseas" })).toBeVisible();
  await expect(page.getByTestId("landing")).toHaveAttribute("data-phase", "offline");
  await expect(page.getByTestId("retry")).toBeVisible();
});

test("from the chart to an outpost, aboard, into flight, to a board and back on the outpost, in one scene", async ({ page }) => {
  // A software-rendered world on a CI runner draws slowly; the walk through it needs room.
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");

  // The pirate is signed in and standing on their outpost; the card is folded to a strip.
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await expect(page.getByTestId("pirate-name")).toHaveText(ME.name);
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "outpost:tinwick");
  // The strip says the obvious next thing to do: board the skiff at the dock.
  await expect(page.getByTestId("next-step")).toContainText("The Static Comet");

  // The map button zooms out to the chart and back; the frame stays.
  await page.getByTestId("map-toggle").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "chart");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "all");
  await page.getByTestId("map-toggle").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");

  // A building spot in the world opens its room in the card: the cantina knows who is on the outpost and takes a line of chat.
  await tapSpot(page, '[data-outpost="tinwick"][data-building="cantina"]');
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "1");
  await expect(page.getByTestId("cantina-panel")).toBeVisible();
  await page.getByTestId("chat-input-outpost").fill("ahoy");
  await page.getByTestId("chat-input-outpost").press("Enter");
  await expect(page.getByTestId("chat-outpost")).toContainText("ahoy");
  // Back steps out of the room to the outpost's buildings with the card still open; the chevron folds it.
  await page.getByTestId("outpost-back").click();
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "1");
  await expect(page.getByTestId("outpost-card")).toHaveAttribute("data-room", "none");
  await expect(page.getByTestId("building-dock")).toBeVisible();
  await page.getByTestId("sheet-toggle").click();
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");

  // The dock boards the pirate's own skiff; the scene moves in on the deck.
  await tapSpot(page, '[data-outpost="tinwick"][data-building="dock"]');
  await expect(page.getByTestId("dock-panel")).toBeVisible();
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await expect(page.getByTestId("deck-card")).toContainText("The Static Comet");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "ship:ship-1");
  await expect(page.getByTestId("ship-heat")).toHaveText("12%");
  // Docked, the next thing is the helm; the helm spot is lit as such.
  await expect(page.getByTestId("next-step")).toContainText("launch");
  await expect(page.locator('[data-helm="1"]')).toHaveClass(/is-primary/);

  // The helm spot on deck takes the captain to the chart to pick a destination; then they launched.
  await tapSpot(page, '[data-helm="1"]');
  await expect(page.getByTestId("helm-card")).toBeVisible();
  await page.getByTestId("dest-echo-rock").click();
  await page.getByTestId("launch-now").click();
  // Under way, the card folds back to its strip: the ship's name, where it is bound, and the turn clock.
  await expect(page.getByTestId("sheet")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("sheet")).toContainText("Echo Rock");
  await expect(page.getByTestId("mini-turn")).toBeVisible();
  // In flight without a station, the next thing is a station.
  await expect(page.getByTestId("next-step")).toContainText("station");
  // Launching alone booted up bots: they stand at stations, marked apart from the pirates, and the log says so.
  await expect(page.locator('[data-station="cooling"]')).toHaveAttribute("data-holder", "bot");
  await expect(page.locator('[data-station="cooling"]')).toContainText("Sprocket-12");
  await page.getByTestId("sheet-toggle").click();
  await expect(page.getByTestId("crew-bot")).toHaveCount(3);
  await expect(page.getByTestId("crew-bot").first()).toContainText("Bot");
  await expect(page.getByTestId("ship-log")).toContainText("booted up");
  await expect(page.getByTestId("station-cooling")).toBeEnabled();
  await page.getByTestId("sheet-toggle").click();

  // Taking a bot's station spot opens its board over the deck; the hand steps aside, a board is dealt at once and takes a swap.
  await tapSpot(page, '[data-station="cooling"]');
  // The pirate walks over first; a software-rendered runner can be slow about it.
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "station", { timeout: 15_000 });
  await expect.poll(() => server.ship()?.hands.find((h) => h.pirateId === "bot:2")?.station === null).toBe(true);
  await expect(page.getByTestId("station-view-cooling")).toBeVisible();
  await expect(page.getByTestId("duty-board-wrap")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  // On a phone the ship is two labeled bars until asked for, and the full status unfolds on a tap;
  // a wide screen keeps it unfolded in a rail beside the board.
  const shipToggle = page.getByTestId("station-ship-toggle");
  if (await shipToggle.isVisible()) await shipToggle.click();
  await expect(page.getByTestId("station-details")).toBeVisible();
  await expect(page.getByTestId("station-details").getByTestId("ship-heat")).toHaveText("12%");
  await expect(page.getByTestId("cooling-board")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const s = server.ship();
      return s ? s.sessions : 0;
    })
    .toBeGreaterThan(0);

  // Back to the deck. The captain orders the hand they relieved to the guns; the log says so.
  await page.getByTestId("station-back").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await page.getByTestId("sheet-toggle").click();
  await page.getByTestId("assign-bot:2").selectOption("gunnery");
  await expect.poll(() => server.ship()?.hands.find((h) => h.pirateId === "bot:2")?.station ?? null).toBe("gunnery");
  await expect(page.locator('[data-station="gunnery"]')).toHaveAttribute("data-holder", "bot");
  await expect(page.getByTestId("ship-log")).toContainText("Sprocket-12 took the Turrets");
  // Then on the outpost from the unfolded card: the scene pulls out to the outpost.
  await page.getByTestId("disembark").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await expect(page.getByTestId("world")).toHaveAttribute("data-focus", "outpost:tinwick");
  await expect(page.getByTestId("sheet")).toContainText("Tinwick");

  // The menu is the same everywhere and carries the settings.
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu")).toBeVisible();
  await page.getByTestId("toggle-marks").check();
  await page.getByTestId("menu-close").click();
  await expect(page.getByTestId("menu")).toHaveCount(0);
});

test("a pirate opens their own sheet from the top bar, dresses for the deck, wears an earned title and reads the record", async ({ page }) => {
  // The world keeps drawing under the sheet; a runner drawing it in software needs room.
  test.setTimeout(120_000);
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");

  // The name in the top bar carries the pirate's likeness and opens their sheet over the scene.
  const portrait = page.getByTestId("sheet-open").locator(".portrait");
  await expect(portrait).toBeVisible();
  await page.getByTestId("sheet-open").click();
  await expect(page.getByTestId("pirate-sheet")).toBeVisible();
  await expect(page.getByTestId("sheet-name")).toHaveText(ME.name);
  // Before they pick, they wear the look drawn from their id: exactly one jacket and one headgear are on.
  await expect(page.locator('[data-testid^="look-jacket-"][aria-checked="true"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="look-headgear-"][aria-checked="true"]')).toHaveCount(1);

  // A jacket and a headgear are picked by name and worn at once, in the sheet and in the top bar.
  await page.getByTestId("look-jacket-crimson").click();
  await expect(page.getByTestId("look-jacket-crimson")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("look-headgear-goggles").click();
  await expect(page.getByTestId("look-headgear-goggles")).toHaveAttribute("aria-checked", "true");
  await expect(portrait).toHaveAttribute("data-jacket", "crimson");
  await expect(portrait).toHaveAttribute("data-headgear-id", "goggles");
  expect(server.ship()!.looks.at(-1)).toEqual({ jacket: "crimson", headgear: "goggles" });
  // The die always changes something.
  await page.getByTestId("look-dice").click();
  await expect.poll(() => server.ship()!.looks.length).toBe(3);
  expect(server.ship()!.looks[2]).not.toEqual({ jacket: "crimson", headgear: "goggles" });

  // Earned titles are offered to wear; the one worn shows under the name.
  await expect(page.getByTestId("sheet-title-lane-rider")).toBeVisible();
  await expect(page.getByTestId("sheet-title-old-stardust")).toHaveCount(0);
  await page.getByTestId("sheet-title-lane-rider").click();
  await expect(page.getByTestId("sheet-shown-title")).toHaveText("Lane Rider");

  // The titles tab lists every title with what it asks; earned ones can be worn from there too.
  await page.getByTestId("sheet-tab-titles").click();
  await expect(page.getByTestId("sheet-titles-count")).toHaveText(`3 of ${SHEET.titles.length} earned`);
  await expect(page.getByTestId("title-void-hound")).toHaveAttribute("data-earned", "0");
  await expect(page.getByTestId("title-void-hound")).toContainText("1 of 10");
  await page.getByTestId("title-wear-skipper").click();
  await expect(page.getByTestId("sheet-shown-title")).toHaveText("Skipper");
  await expect(page.getByTestId("title-skipper")).toContainText("Wearing");

  // The record tab reads the voyage tables and the ledger.
  await page.getByTestId("sheet-tab-record").click();
  await expect(page.getByTestId("sheet-stat-voyages")).toContainText("1");
  await expect(page.getByTestId("sheet-stat-ships")).toContainText("1");
  await page.getByTestId("sheet-close").click();
  await expect(page.getByTestId("pirate-sheet")).toHaveCount(0);

  // A title earned out in the world floats up with a way to see it.
  server.ship()!.send({ type: "pirate.titles", earned: ["void-hound"] });
  await expect(page.getByTestId("toasts")).toContainText("Void Hound");
  await page.getByTestId("toast-title").click();
  await expect(page.getByTestId("pirate-sheet")).toBeVisible();
  await expect(page.getByTestId("sheet-tab-titles")).toHaveAttribute("aria-selected", "true");
});

test("a raider's hail is engaged at the helm and the captain's battle board opens over the deck", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await tapSpot(page, '[data-outpost="tinwick"][data-building="dock"]');
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await tapSpot(page, '[data-helm="1"]');
  await page.getByTestId("dest-echo-rock").click();
  await page.getByTestId("launch-now").click();
  await expect(page.getByTestId("sheet")).toContainText("Echo Rock");

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
  // The ship's deal is on the board: tokens to plot with. Plot ahead and fly it now.
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

test("a boarding takes everyone to the airlock: the swordfight board opens over the deck and the melee pays out", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await tapSpot(page, '[data-outpost="tinwick"][data-building="dock"]');
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");
  await tapSpot(page, '[data-helm="1"]');
  await page.getByTestId("dest-echo-rock").click();
  await page.getByTestId("launch-now").click();
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

  // The grapple lands: the melee opens, everyone is sent to the airlock, the board is dealt and the raider's scrap is announced.
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "melee", { timeout: 15_000 });
  await expect(page.getByTestId("melee-view")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });
  await expect(page.getByTestId("swordfight-canvas")).toBeVisible();
  await expect(page.getByTestId("toasts")).toContainText("Boarding");
  await expect(page.getByTestId("sheet")).toContainText("Boarding the Marauder");
  // The board logs the announced scrap and its waits, then a drop: one is enough for this raider.
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

test("launching from a station's board goes straight back to it, and a hail turns its bar without moving the board", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await tapSpot(page, '[data-outpost="tinwick"][data-building="dock"]');
  await page.getByTestId("board-ship-ship-1").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck");

  // Docked, the station waits for the launch and hands the captain the helm.
  await tapSpot(page, '[data-station="cooling"]');
  await expect(page.getByTestId("duty-docked")).toBeVisible();
  await page.getByTestId("duty-launch").click();
  await expect(page.getByTestId("helm-card")).toBeVisible();
  await page.getByTestId("dest-echo-rock").click();
  await page.getByTestId("launch-now").click();
  // Under way, the captain is back at the heat sinks with a board dealt, not on the deck.
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "station");
  await expect(page.getByTestId("station-view-cooling")).toBeVisible();
  await expect(page.getByTestId("duty-board-wrap")).toHaveAttribute("data-phase", "playing", { timeout: 15_000 });

  // A hail turns the bar, with the captain's answers in it; the board stays exactly where it was.
  const before = await page.getByTestId("duty-board-wrap").boundingBox();
  server.ship()!.hail();
  await expect(page.getByTestId("station-hail")).toContainText("Marauder");
  await expect(page.getByTestId("ship-hail")).toHaveCount(0);
  await expect(page.getByTestId("toasts")).not.toContainText("Marauder");
  const after = await page.getByTestId("duty-board-wrap").boundingBox();
  expect(Math.round(after!.y)).toBe(Math.round(before!.y));
  expect(Math.round(after!.height)).toBe(Math.round(before!.height));
  await page.getByTestId("engage").click();
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "battle");
});

// ---- walking (M5, ADR 0032)

/** Every label hung on the world (spots and their pins, name tags, ship names) that sits over the player's own pirate. */
async function labelsOverPlayer(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const world = document.querySelector('[data-testid="world"]') as HTMLElement | null;
    const box = world?.dataset.meBox?.split(",").map(Number);
    if (!world || !box || box.length !== 4) return [];
    const host = world.getBoundingClientRect();
    const [x0, y0, x1, y1] = [box[0]! + host.left, box[1]! + host.top, box[2]! + host.left, box[3]! + host.top];
    const over: string[] = [];
    for (const el of Array.from(world.querySelectorAll<HTMLElement>(".ow-spot, .ow-pin, .ow-tag, .ow-label"))) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < x1 && x0 < r.right && r.top < y1 && y0 < r.bottom) over.push(el.textContent ?? "");
    }
    return over;
  });
}

/** Where the world says the pirate stands, as numbers. */
async function standing(page: Page): Promise<[number, number]> {
  const at = (await page.getByTestId("world").getAttribute("data-me")) ?? "";
  const [x, z] = at.split(",").map(Number);
  return [x ?? NaN, z ?? NaN];
}

test("on the outpost the pirate walks among others: a tap walks, a walk is heard, a name opens a card, and the airlock leads off the ship", async ({ page }) => {
  test.setTimeout(180_000);
  const server = await fakeServer(page, [{ pirateId: "p-quasar", name: "Moody Quasar", at: { x: 0.3, z: -0.32 } }]);
  await page.goto("/");
  const world = page.getByTestId("world");
  await expect(world).toHaveAttribute("data-walk", "outpost:tinwick", { timeout: 30_000 });
  await expect(world).toHaveAttribute("data-ready", "1");
  // Stepping on the outpost tells the outpost where the pirate stands.
  await expect.poll(() => server.ship()?.got.filter((m) => m.type === "walk.to").length ?? 0).toBeGreaterThan(0);

  // A tap on the ground beside the pirate walks them there, and the outpost hears where to.
  const before = await standing(page);
  const sent = server.ship()!.got.filter((m) => m.type === "walk.to").length;
  const box = (await page.getByTestId("world-canvas").boundingBox())!;
  // Once the camera has settled on the pirate, tap the open ground a step to their left.
  await page.waitForTimeout(1200);
  const [fx, fy] = ((await world.getAttribute("data-me-screen")) ?? "0,0").split(",").map(Number) as [number, number];
  await page.mouse.click(box.x + fx - 45, box.y + fy - 6);
  await expect.poll(() => server.ship()!.got.filter((m) => m.type === "walk.to").length, { timeout: 10_000 }).toBeGreaterThan(sent);
  await expect(world).toHaveAttribute("data-walking", "0", { timeout: 10_000 });
  const after = await standing(page);
  expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(0.05);

  // Another pirate on the outpost stands where they last walked, named; when they walk on, the name walks with them.
  const quasar = page.locator('[data-walker="p-quasar"]');
  await expect(quasar).toHaveText("Moody Quasar");
  const was = await quasar.boundingBox();
  server.ship()!.send({ type: "walk.moved", scope: "outpost", pirateId: "p-quasar", x: 0.2, z: -0.35 });
  await expect.poll(async () => {
    const now = await quasar.boundingBox();
    return now && was ? Math.hypot(now.x - was.x, now.y - was.y) : 0;
  }, { timeout: 10_000 }).toBeGreaterThan(15);
  // Their name is a way to their card.
  await quasar.click({ force: true });
  await expect(page.getByTestId("profile-card")).toContainText("Moody Quasar");
  await page.getByTestId("profile-close").click();
  await expect(page.getByTestId("profile-card")).toHaveCount(0);

  // Choosing the cantina walks the pirate to its door and in, out of sight, as its room opens.
  const walksSent = (): number => server.ship()!.got.filter((m) => m.type === "walk.to").length;
  const sentBefore = walksSent();
  await tapSpot(page, '[data-outpost="tinwick"][data-building="cantina"]');
  await expect(page.getByTestId("cantina-panel")).toBeVisible();
  await expect(world).toHaveAttribute("data-inside", "cantina", { timeout: 10_000 });
  // Leaving the room from the card walks them back out to stand at the door.
  await page.getByTestId("outpost-back").click();
  await expect(world).toHaveAttribute("data-inside", "", { timeout: 10_000 });
  await expect(world).toHaveAttribute("data-walking", "0", { timeout: 10_000 });
  // The outpost heard them go in and come out.
  expect(walksSent()).toBeGreaterThanOrEqual(sentBefore + 2);
  const atDoor = await standing(page);
  // In again; this time a tap on the ground outside closes the room, and they walk out and on to it.
  await page.getByTestId("building-cantina").click();
  await expect(world).toHaveAttribute("data-inside", "cantina", { timeout: 10_000 });
  await page.waitForTimeout(600);
  const [dx, dy] = ((await world.getAttribute("data-me-screen")) ?? "0,0").split(",").map(Number) as [number, number];
  await page.mouse.click(box.x + dx - 40, box.y + dy + 70);
  await expect(page.getByTestId("cantina-panel")).toHaveCount(0);
  await expect(world).toHaveAttribute("data-inside", "", { timeout: 10_000 });
  await expect(world).toHaveAttribute("data-walking", "0", { timeout: 10_000 });
  const walkedOn = await standing(page);
  expect(Math.hypot(walkedOn[0] - atDoor[0], walkedOn[1] - atDoor[1])).toBeGreaterThan(0.05);
  if ((await page.getByTestId("sheet").getAttribute("data-open")) === "1") await page.getByTestId("sheet-toggle").click();

  // On a keyboard the arrow keys walk.
  if ((page.viewportSize()?.width ?? 0) > 800) {
    const start = await standing(page);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(700);
    await page.keyboard.up("ArrowUp");
    await expect(world).toHaveAttribute("data-walking", "0", { timeout: 10_000 });
    const end = await standing(page);
    expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeGreaterThan(0.05);
  }

  // A tap on the rim and the void just above the skiff is not a tap on her: the pirate walks, and stays on the outpost.
  const label = (await page.locator('[data-ship="ship-1"]').boundingBox())!;
  await page.mouse.click(label.x + label.width / 2, Math.max(box.y + 80, label.y - 150));
  await expect(world).toHaveAttribute("data-walking", "0", { timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(server.ship()!.got.some((m) => m.type === "ship.board")).toBe(false);
  await expect(page.getByTestId("shell")).not.toHaveAttribute("data-place", "deck");
  if (await page.getByTestId("outpost-back").isVisible()) await page.getByTestId("outpost-back").click();
  if ((await page.getByTestId("sheet").getAttribute("data-open")) === "1") await page.getByTestId("sheet-toggle").click();

  // No label ever covers the player's own pirate.
  await expect.poll(() => labelsOverPlayer(page)).toEqual([]);

  // Tapping the skiff walks down the dock and aboard; on deck the pirate walks too.
  await page.locator('[data-ship="ship-1"]').click({ force: true });
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "deck", { timeout: 15_000 });
  await expect(world).toHaveAttribute("data-walk", "ship:ship-1");
  // Aboard, the view starts in close on the pirate; the stations off screen wait at its edges, pointing
  // the way, and still no label covers the pirate.
  await expect(world).toHaveAttribute("data-walking", "0", { timeout: 10_000 });
  await expect.poll(() => page.locator(".ow-spot[data-edge]").count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(() => labelsOverPlayer(page)).toEqual([]);
  // Docked, the airlock leads off: the pirate walks to it and is on the outpost again, at the foot of the boarding tube.
  await tapSpot(page, '[data-airlock="1"]');
  await expect.poll(() => server.ship()!.got.some((m) => m.type === "ship.leave"), { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await expect(world).toHaveAttribute("data-walk", "outpost:tinwick");
  const onOutpost = await standing(page);
  // The boarding tube's foot is out on the dock, well beyond the rim.
  expect(onOutpost[0]).toBeGreaterThan(1.5);
});

// ---- crews and accounts (M6)

const FLAG_RIFT = { field: "crimson", accent: "bone", pattern: "saltire", emblem: "satellite" };
const RIFT = { id: "c-rift", name: "Rift Runners", flag: FLAG_RIFT };
const QUASAR = { pirateId: "p-quasar", name: "Moody Quasar" };

/** A pretend harbor for crews: the pirate's crew, invitations, the board of crews and pirates' cards, answered over the same wire. */
class FakeHarbor {
  me: Record<string, unknown> & { id: string; name: string; balance: number; crew: unknown };
  crew: { id: string; name: string; flag: Record<string, string>; rank: string } | null = null;
  invites: { crew: typeof RIFT; members: number; by: string; at: number }[] = [];
  invitedNames: string[] = [];
  constructor(
    readonly ws: WebSocketRoute,
    me: FakeHarbor["me"],
  ) {
    this.me = me;
  }
  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }
  info() {
    if (!this.crew) return null;
    return {
      id: this.crew.id,
      name: this.crew.name,
      flag: this.crew.flag,
      foundedAt: Date.now(),
      stats: { voyages: 0, victories: 0, plunder: 0 },
      members: [{ pirateId: this.me.id, name: this.me.name, rank: this.crew.rank, joinedAt: Date.now(), where: { kind: "on-outpost", outpostId: "tinwick" } }],
      invited: this.invitedNames.map((name, i) => ({ pirateId: `p-inv-${i}`, name })),
    };
  }
  state(): void {
    this.send({ type: "crew.state", crew: this.info(), invites: this.invites, serverNow: Date.now() });
  }
  summary(): void {
    this.me = { ...this.me, crew: this.crew };
    this.send({ type: "pirate.updated", pirate: this.me });
  }
  /** Another crew's officer invites the pirate. */
  invite(): void {
    this.invites = [{ crew: RIFT, members: 7, by: QUASAR.name, at: Date.now() }];
    this.send({ type: "crew.notice", notice: { type: "invited", crew: RIFT, by: QUASAR.name }, at: Date.now() });
    this.state();
  }
  handle(raw: string): void {
    const m = JSON.parse(raw) as Record<string, unknown> & { type: string };
    const now = Date.now();
    switch (m.type) {
      case "board.list":
        this.send({ type: "board.ships", outpostId: "tinwick", ships: [], serverNow: now });
        return;
      case "outpost.who":
        this.send({ type: "outpost.presence", outpostId: "tinwick", pirates: [{ pirateId: this.me.id, name: this.me.name, crew: null }, { ...QUASAR, crew: RIFT }] });
        return;
      case "crew.info":
        this.state();
        return;
      case "crew.list":
        this.send({ type: "crew.list", crews: [{ ...RIFT, members: 7, stats: { voyages: 30, victories: 14, plunder: 8800 } }] });
        return;
      case "crew.found": {
        this.crew = { id: "c-new", name: m.name as string, flag: m.flag as Record<string, string>, rank: "commodore" };
        this.me = { ...this.me, balance: this.me.balance - 150 };
        this.send({ type: "crew.notice", notice: { type: "founded", crew: { id: "c-new", name: m.name, flag: m.flag } }, at: now });
        this.state();
        this.summary();
        return;
      }
      case "crew.invite":
        this.invitedNames.push(m.name as string);
        this.state();
        return;
      case "crew.answer":
        if (m.accept) this.crew = { ...RIFT, rank: "spacer" };
        this.invites = [];
        this.state();
        this.summary();
        return;
      case "chat.send":
        this.send({ type: "chat.message", channel: m.channel, pirateId: this.me.id, name: this.me.name, text: m.text, at: now });
        return;
      case "pirate.profile":
        this.send({ type: "pirate.profile", profile: { ...QUASAR, crew: { ...RIFT, rank: "officer" }, ratings: [{ puzzle: "engines", tier: "sharp", rounds: 9 }], voyages: 17, online: true, invited: this.invitedNames.includes(QUASAR.name) } });
        return;
      default:
        return;
    }
  }
}

/** A server for the crew and account smoke: sign-in can link Discord, after which the pirate is no longer a guest. */
async function fakeHarbor(page: Page, balance: number): Promise<{ harbor: () => FakeHarbor | null; linked: () => boolean }> {
  let harbor: FakeHarbor | null = null;
  let linked = false;
  const me = () => ({ ...ME, balance, guest: !linked, crew: null });
  await page.route("**/api/me", (route) => route.fulfill({ json: { pirate: me(), inviteRequired: false, providers: ["discord", "google"], linked: linked ? ["discord"] : [] } }));
  await page.route("**/api/auth/sign-in/social", (route) => {
    linked = true;
    return route.fulfill({ json: { url: "/outpost/tinwick?signed_in=discord", redirect: true } });
  });
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { session: { id: "s" }, user: { id: "u", isAnonymous: !linked } } }));
  await page.routeWebSocket(/\/ws$/, (ws) => {
    harbor = new FakeHarbor(ws, me());
    ws.send(JSON.stringify({ type: "welcome", pirate: me(), serverNow: Date.now() }));
    ws.onMessage((raw) => harbor?.handle(String(raw)));
    harbor.state();
  });
  return { harbor: () => harbor, linked: () => linked };
}

test("a pirate founds a crew in the cantina, sews its flag, invites from a profile and talks to the crew", async ({ page }) => {
  test.setTimeout(120_000);
  const server = await fakeHarbor(page, 400);
  await page.goto("/outpost/tinwick/cantina");
  await expect(page.getByTestId("cantina-panel")).toBeVisible();
  await expect(page.getByTestId("cantina-crew")).toContainText("no crew");

  // The crew table opens the crew card: no crew yet, so founding one and the invitations.
  await page.getByTestId("cantina-crew-open").click();
  await expect(page.getByTestId("crew-dialog")).toBeVisible();
  await expect(page.getByTestId("crew-panel")).toHaveAttribute("data-in-crew", "0");
  await expect(page.getByTestId("crew-no-invites")).toContainText(ME.name);
  // A name too short is refused before it is sent; the flag is sewn from its parts.
  await page.getByTestId("crew-found-name").fill("ab");
  await expect(page.getByTestId("crew-found")).toBeDisabled();
  await page.getByTestId("crew-found-name").fill("The Rust Comets");
  await page.getByTestId("flag-field-deep").click();
  await page.getByTestId("flag-accent-gold").click();
  await page.getByTestId("flag-pattern-cross").click();
  await page.getByTestId("flag-emblem-rocket").click();
  await expect(page.getByTestId("flag-editor").locator(".flag-preview img")).toHaveAttribute("data-flag", "deep.gold.cross.rocket");
  // Two colors the same would hide the emblem: picking the field's color for the accent swaps them round.
  await page.getByTestId("flag-accent-deep").click();
  await expect(page.getByTestId("flag-editor").locator(".flag-preview img")).toHaveAttribute("data-flag", "gold.deep.cross.rocket");
  await page.getByTestId("flag-field-deep").click();
  await page.getByTestId("crew-found").click();

  // Founded: the card is the crew's, the founder is commodore, the purse paid the fee and the top bar flies the flag.
  await expect(page.getByTestId("crew-panel")).toHaveAttribute("data-in-crew", "1");
  await expect(page.getByTestId("crew-name")).toHaveText("The Rust Comets");
  await expect(page.getByTestId(`crew-member-${ME.id}`)).toHaveAttribute("data-rank", "commodore");
  await expect(page.getByTestId("toasts")).toContainText("The Rust Comets is founded");
  await expect(page.getByTestId("pirate-credits")).toHaveText("250");
  await expect(page.getByTestId("crew-open").locator("img")).toHaveAttribute("data-flag", "deep.gold.cross.rocket");

  // Crew chat is a tab of the card.
  await page.getByTestId("crew-tab-chat").click();
  await page.getByTestId("chat-input-crew").fill("all hands");
  await page.getByTestId("chat-input-crew").press("Enter");
  await expect(page.getByTestId("chat-crew")).toContainText("all hands");
  // The board of crews ranks every crew by plunder.
  await page.getByTestId("crew-tab-board").click();
  await expect(page.getByTestId("crew-board")).toContainText("Rift Runners");
  await page.getByTestId("crew-close").click();
  await expect(page.getByTestId("crew-dialog")).toHaveCount(0);

  // A name in the cantina opens that pirate's card, which invites them to the crew.
  await page.getByTestId(`patron-${QUASAR.pirateId}`).click();
  await expect(page.getByTestId("profile-card")).toContainText("Rift Runners");
  await page.getByTestId("profile-invite").click();
  await expect.poll(() => server.harbor()?.invitedNames ?? []).toContain(QUASAR.name);
  await expect(page.getByTestId("profile-card")).toHaveCount(0);
  await page.getByTestId("crew-open").click();
  await expect(page.getByTestId("crew-invited")).toContainText(QUASAR.name);
});

test("an invitation arrives as a toast, is answered in the crew card, and a guest links an account to keep their pirate", async ({ page }) => {
  test.setTimeout(120_000);
  const server = await fakeHarbor(page, 0);
  await page.goto("/");
  await expect(page.getByTestId("shell")).toHaveAttribute("data-place", "outpost");
  await expect.poll(() => server.harbor() !== null).toBe(true);

  // Another crew's officer invites the pirate: a toast offers to look, and the top bar counts it.
  server.harbor()!.invite();
  await expect(page.getByTestId("crew-badge")).toHaveText("1");
  await page.getByTestId("toast-crew-view").click();
  await expect(page.getByTestId("crew-invites")).toContainText("Rift Runners");
  await page.getByTestId(`crew-accept-${RIFT.id}`).click();
  await expect(page.getByTestId("crew-name")).toHaveText("Rift Runners");
  await expect(page.getByTestId("toasts")).toContainText("You've joined Rift Runners");
  await expect(page.getByTestId("crew-badge")).toHaveCount(0);
  await page.getByTestId("crew-close").click();

  // The menu offers the guest an upgrade in place; linking Discord comes back with the pirate kept.
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("account")).toHaveAttribute("data-guest", "1");
  await page.getByTestId("link-discord").click();
  await expect.poll(() => server.linked()).toBe(true);
  await expect(page.getByTestId("toasts")).toContainText("Linked to Discord", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/outpost\/tinwick$/);
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("account")).toHaveAttribute("data-guest", "0");
  await expect(page.getByTestId("linked-with")).toContainText("Discord");
  await expect(page.getByTestId("also-google")).toBeVisible();
});
