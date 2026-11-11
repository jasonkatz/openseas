import { gunneryDropInterval } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.gunnery;
const c = p.config;
const width = c.decks[0]![0]!.length;
const height = c.decks[0]!.length;
const turrets = c.decks[0]!.join("").split("C").length - 1;
const secs = (ticks: number): string => String(Math.round((ticks * c.tickMs) / 100) / 10);
const [cells, sabots, slugs, coolants] = c.bag as [number, number, number, number];
const perBag = cells + sabots + slugs + coolants;
const loadsPerBag = Math.min(cells, sabots, slugs);
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
const nth = (n: number): string => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
/** A full load once the combo is at its cap, and the load that first pays it. */
const fullLoad = c.loadPoints + c.comboStep * c.comboCap;
const fullAt = c.comboCap + 1;
/** What a jam at full combo takes from the loads that follow, while the combo climbs back. */
const jamCost = (c.comboStep * c.comboCap * (c.comboCap + 1)) / 2;
const perLoadFromBroadside = Math.round(c.broadsidePoints / turrets);
/** How long before the end the feeder has dropped half of the round's pieces: the engine's own rhythm, counted. */
const secondHalfSeconds = ((): number => {
  const at: number[] = [];
  let last = 2 - c.spawnEveryTicks;
  for (let tick = 1; tick <= c.maxTick; tick++)
    if (tick - last >= gunneryDropInterval(c, tick)) {
      at.push(tick);
      last = tick;
    }
  const half = at[Math.floor(at.length / 2)]!;
  return Math.round(((c.maxTick - half) * c.tickMs) / 5000) * 5;
})();

export const gunnery: Guide = {
  id: "gunnery",
  tagline: "Lay arrows on the deck to roll cell, sabot and slug into each turret, in that order.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Gunnery deck: a feeder at the top, crates in the middle, a turret in each side rail. Arrows lie on six tiles. A sabot follows a green dotted route to the lower right turret and a slug rolls into the lower left one.",
    caption: "The gun deck mid-round. Two lamps are lit, and the sabot's route shows green: its turret wants it.",
  },
  theme: {
    setting:
      "You are the gunner on the ammunition deck. A **feeder** drops cells, sabots, slugs and coolant onto the plates and they roll until something turns them. You do not carry anything. You lay arrows on the deck and the rounds find the turrets.",
    purpose:
      "The points you make here load the ship's turrets, turn after turn. In a space battle the captain can only fire turrets that are loaded, so a ship with a good gunner hits back and a ship without one cannot.",
  },
  facts: [
    { label: "Deck", value: `${width} wide, ${height} tall, ${turrets} turrets` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.parScore} points` },
  ],
  rules: [
    `Pieces drop from the feeder one at a time and roll one tile every ${secs(1)} seconds. A wall or a crate turns them. Left alone, each one rolls out a **hatch** and is gone.`,
    "An **arrow** turns every piece that rolls onto it. Lay as many as you like, one to a tile.",
    "A turret takes a **cell**, then a **sabot**, then a **slug**. The badge on it is the piece it wants next. When it is full it fires and comes back empty.",
    "A wrong piece **jams** the turret and its load is lost. A jammed turret turns everything away except **coolant**, which flushes it clear.",
    "A piece headed into a turret shows its route: green if the turret wants it, red if it will jam.",
    `The round is ${p.roundSeconds} seconds on one of ${c.decks.length} decks, a different one each round. The feeder shows its next ${word(c.queueLength)} pieces.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-load",
    alt: "One arrow is laid on the stream, pointing left at a turret. A cell, a sabot and a slug roll down, turn at the arrow and go into the turret one after another, and it fires.",
    caption: "One arrow level with a turret. Cell, sabot, slug: the turret fills and fires.",
  },
  controls: [
    { action: "Lay an arrow", touch: "Tap a deck tile near the edge it should point at, or swipe across the tile", desktop: "Click the tile near the edge it should point at" },
    { action: "Turn an arrow", touch: "Tap or swipe it toward another edge", desktop: "Click it toward another edge" },
    { action: "Lift an arrow", touch: "Tap it again the same way, or double tap it", desktop: "Click it again the same way, or right-click it" },
    { action: "Try an arrow first", touch: "", desktop: "Hover over a tile: routes redraw as if the arrow were laid" },
    { action: "Keyboard", touch: "", desktop: "Arrow keys move the cursor. W, A, S, D lay an arrow. Space or Backspace lifts it" },
  ],
  scoring: [
    `A cell or a sabot going in scores ${c.stepPoints}. The slug that fills a turret scores ${c.loadPoints}.`,
    `Full loads in a row without a jam build the **combo**: +${c.comboStep} for each load before it, so the ${nth(fullAt)} load and every one after pays ${fullLoad}. A jam puts it back to nothing.`,
    `Each turret has a lamp that lights when it fires. All ${word(turrets)} lit is a **broadside**: ${c.broadsidePoints} more, and the lamps go out.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Fill one turret, again and again, without ever jamming it.",
      tips: [
        {
          title: "One arrow is a gate",
          body: "Follow the stream down from the feeder until it passes level with a turret, and lay one arrow there pointing at it. That arrow is a gate. Down, it sends the next piece in. Lifted, the piece rolls on and out a hatch. Some decks need a second arrow to get round a crate.",
        },
        {
          title: "Lift it for the wrong piece",
          body: "Look at the turret's badge, then at the piece coming. If they differ, lift the arrow and let the piece go. A piece out the hatch costs nothing. A red route means you have a moment left to lift.",
          media: {
            kind: "clip",
            name: "gate",
            alt: "A turret holds a cell and wants a sabot. A slug rolls toward the arrow with a red route. The arrow is lifted, the slug rolls past and out a hatch, the arrow is laid again and the sabot behind it goes in on a green route.",
            caption: "Red route: lift the arrow. The slug rolls out, the arrow goes back, the sabot loads.",
          },
        },
        {
          title: "Coolant can go anywhere",
          body: "Coolant in a clear turret splashes and does nothing. You do not need to lift the gate for it. You only need it when a turret is jammed, and then it is the one piece that gets in.",
        },
      ],
      drill: `Play a round on one turret with no jams at all. Say the badge out loud before each piece arrives. You are there when a round ends above ${p.thresholds[1]!.score} points with the jam count at zero.`,
    },
    {
      level: "intermediate",
      goal: "Guard the combo, and open a second turret for the pieces the first cannot take.",
      tips: [
        {
          title: "A jam costs far more than a load",
          body: `At full combo every load pays ${fullLoad}. Jam once and the next loads pay ${c.loadPoints}, ${c.loadPoints + c.comboStep}, ${c.loadPoints + 2 * c.comboStep} while it climbs back: ${jamCost} points gone, plus the load in the turret, plus a turret shut until coolant comes. When in doubt, lift the arrow.`,
        },
        {
          title: "One turret wastes most of the stream",
          body: `The feeder deals from a shuffled bag of ${perBag}: ${word(cells)} cells, ${word(sabots)} sabots, ${word(slugs)} slugs and ${word(coolants)} coolant. That is ${word(loadsPerBag)} full loads a bag, but in a random order. A turret with a cell in it can use only a sabot. A second turret takes the cell that comes instead.`,
        },
        {
          title: "One tile, two turrets",
          body: "Turrets sit in pairs, facing each other across the deck. On many decks the stream crosses the line between a pair, and that one tile is a switch: point it left, point it right, or lift it. You only ever move your hand to one place.",
          media: {
            kind: "clip",
            name: "switch",
            alt: "The left turret has a cell. The arrow on the stream is turned to point right and the next cell rolls into the right turret. It is turned back left and a sabot rolls into the left turret.",
            caption: "The left turret has its cell, so the next cell goes right. Then the sabot goes left.",
          },
        },
        {
          title: "Read NEXT, not the deck",
          body: `The feeder shows ${word(c.queueLength)} pieces ahead. Decide where a piece goes while it is still in the queue. Then turn the switch as soon as the piece before it has rolled off the tile. An arrow only acts when a piece is on it, so early is safe and calm.`,
        },
      ],
      drill: `Work one pair of turrets from a single tile, and call each piece from the NEXT strip before it drops. You are there when the combo meter fills and stays full, and a round passes ${p.parScore}.`,
    },
    {
      level: "advanced",
      goal: `Run all ${word(turrets)} turrets and fire them in turn for broadsides.`,
      tips: [
        {
          title: "Feed the unlit lamps",
          body: `A broadside pays ${c.broadsidePoints} for ${word(turrets)} loads, about ${perLoadFromBroadside} extra a load, but only if the loads are spread. When two turrets want the same piece, give it to the one whose lamp is dark. Loading the handy turret twice lights nothing new.`,
          media: {
            kind: "clip",
            name: "broadside",
            alt: "Three turrets have lit lamps. A slug rolls the length of the deck, turns at an arrow into the fourth turret and fills it. The turret fires, all four turrets flash and the board shows Broadside, plus 300.",
            caption: "Three lamps lit. The slug goes to the fourth turret, not the nearest, and the ship fires a broadside.",
          },
        },
        {
          title: "Keep the turrets out of step",
          body: "A piece has a home only if some turret is waiting for that kind. With one turret wanting a cell, one a sabot and one a slug, whatever drops next can be loaded. When all of them want the same thing, most of the stream rolls out. Choose where a piece goes with the next two in mind.",
        },
        {
          title: "Build the far routes first",
          body: "The far pair of turrets takes longer to reach and may need a turn or two round the crates. Work that route out in the opening seconds, while pieces come slowly. A piece sent the long way is on deck longer, and that is time to set up for the next one.",
        },
      ],
      drill: `Play rounds where no turret is loaded twice while another lamp is dark. Count broadsides on the results card. You are there when a round has three or more and passes ${p.thresholds[3]!.score}.`,
    },
    {
      level: "expert",
      goal: "Waste nothing: hold the piece that has no home yet, and be at full combo when the feeder speeds up.",
      tips: [
        {
          title: "Hold a piece in a pen",
          body: "Two arrows facing each other on a side lane make a pen. A piece sent in rolls back and forth between them. When a slug comes before its sabot, pen the slug, send the sabot in, then lift the pen's near arrow. The slug rolls out and fills the turret.",
          media: {
            kind: "clip",
            name: "hold",
            alt: "The left turret holds a cell. A slug arrives first and is turned right into two facing arrows, where it rolls back and forth. The sabot behind it is sent left into the turret. One arrow of the pen is lifted, and the slug rolls out across the deck into the turret, which is now full.",
            caption: "The slug came early. It waits in the pen, the sabot loads, and the slug is let out to finish the load.",
          },
        },
        {
          title: "Hold one or two, never a crowd",
          body: `The feeder stops while ${word(c.maxOnDeck)} pieces are on deck, and it cannot drop onto a piece standing under it. Two pieces that meet head on both turn back. Keep the pen off the stream, and empty it before you fill it again.`,
        },
        {
          title: "The round is won at the end",
          body: `The feeder starts at a piece every ${secs(c.spawnEveryTicks)} seconds and ends at one every ${secs(c.spawnEveryTicksMin)}. The last ${secondHalfSeconds} seconds bring half of the round's pieces. Have every route laid and the combo at ${fullLoad} a load before then. A jam late on costs the most it can.`,
        },
        {
          title: "A full turret is shut",
          body: `A turret fires ${secs(c.fireAfterTicks)} seconds after it fills, and until then it turns pieces away like a wall. The feeder never drops pieces that close together, but a pen can. Do not let a held piece out right behind the slug that fills its turret.`,
        },
      ],
      drill: `Play rounds where every slug or sabot that comes too early goes into a pen, not out a hatch. You are there when a round passes ${p.thresholds[4]!.score}.`,
    },
  ],
  mistakes: [
    `**Sending a piece in to see what happens.** A jam at full combo costs ${jamCost} points. A piece out the hatch costs none.`,
    "**Feeding the nearest turret all round.** Its lamp is already lit. The broadside needs the other ones.",
    "**Leaving the gate down and looking away.** Every piece takes the arrow, right or wrong. Watch the NEXT strip.",
    "**Waiting on coolant with a jammed turret in your main route.** Turn the stream to another turret until the coolant shows in NEXT.",
    "**Filling the deck with held pieces.** The feeder stops, and the fast end of the round is where the points are.",
  ],
};
