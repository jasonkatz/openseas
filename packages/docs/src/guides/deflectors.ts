import { deflectorsBeamPoints } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.deflectors;
const c = p.config;
/** Ticks as seconds on the round's clock. */
const secs = (ticks: number): number => (ticks * c.tickMs) / 1000;
const lensPct = c.lensPercent;
/** A beam's own points for getting home after this many turns, with a recipe of this many lenses. */
const pts = (turns: number, lenses = 0): number => deflectorsBeamPoints(c, turns, (1 << lenses) - 1);
const streak = c.streakPercent;
const streakMax = streak[streak.length - 1]! / 100;
const perfect = c.perfectPercent / 100;
const nth = (n: number): string => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
/** What the climb back to a full streak gives up, counted in volleys at no multiplier. */
const climb = Math.round(streak.reduce((n, pc) => n + (streak[streak.length - 1]! - pc), 0) / 100);

export const deflectors: Guide = {
  id: "deflectors",
  tagline: "Flip mirrors to route every beam home through exactly the lenses it asks for.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Deflectors board: a six by six grid of slanted mirrors and three lenses, a diamond, a hexagon and a cross. Two beams wait, each with a solid sign at its entry port and the same sign with its middle cut out at its exit port. Small lenses sit outside each exit: that beam's recipe. Broken lines show where each beam would go now and dots run back from each exit.",
    caption: "Two beams waiting. The small lenses outside each exit are its recipe: the lenses it must pass through, and no others.",
  },
  theme: {
    setting:
      "The ship's deflector array is a grid of mirrors and lenses behind the hull. Beams come in through the ports on its edge, and you are the pirate turning mirrors so each beam leaves by the port it is meant for, tuned by the lenses it was meant to pass. A beam that leaves anywhere else, or tuned wrong, burns into the **hull**.",
    purpose:
      "Deflectors is a prototype. It is on the test bench and in no ship yet. It tries out routing as planning: no count, a recipe for every beam, and a grid that every volley changes. It asks you to work out a route that meets every condition at once, and later to see how the route you fire shapes the grid for the next volley.",
  },
  facts: [
    { label: "Board", value: `${c.size} by ${c.size}, ${c.mirrors} mirrors, ${c.lenses} lenses` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.thresholds[2]!.score} points` },
  ],
  rules: [
    "Every mirror is set one of two ways. **Tap a mirror to flip it.** A beam passes straight through an empty cell and straight through a lens.",
    `Beams come in **volleys** of ${c.beams}. A beam's entry port wears a solid sign. Its exit port wears the same sign with its middle cut out. Outside the exit sit up to ${c.recipeLenses} small lenses: the beam's **recipe**.`,
    "A volley waits for as long as you like. **Tap a lit entry to fire it.** Every beam runs straight, turns at every mirror it meets, and leaves by some port.",
    "A beam is **home** when it leaves by its own exit having passed exactly the lenses of its recipe: every one of them, and no other kind. Anything else hits the hull, even at its own exit.",
    "While a beam waits, a broken line shows where it would go now and dots run back from its exit. A recipe's small lenses turn solid as the route passes them, and a lens on the route that is not in the recipe is ringed in danger. No beam is dealt home already.",
    `Every mirror a fired beam turned at is **spent**. It leaves the grid, whatever stood above it in its column drops one cell, and a fresh mirror comes in at the top. The next volley comes ${secs(c.respawnTicks)} seconds after one fires, on the grid as it has settled.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "join",
    alt: "One beam waits, astray. A mirror where its broken line and the dots from its exit cross is tapped, and the line becomes one solid route from entry to exit through the lens its recipe asks for. A tap on the entry port fires the beam home, and the mirrors it turned at drop out of the grid as the column above them falls.",
    caption: "Flip the mirror where the two lines cross, through the right lens, and the beam is home. Fire it, and the mirrors it used are spent.",
  },
  controls: [
    { action: "Flip a mirror", touch: "Tap it", desktop: "Click it" },
    { action: "Fire the volley", touch: "Tap a lit entry port", desktop: "Click a lit entry port, or press F" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Flip at the cursor", touch: "", desktop: "Space or Enter" },
  ],
  scoring: [
    `**A beam home scores by its turns:** turns plus one, squared, and ${lensPct}% more for each lens in its recipe. 3 turns through one lens are ${pts(3, 1)}, through two are ${pts(3, 2)}; 7 turns through two are ${pts(7, 2)}. A mirror met twice counts twice.`,
    `**A beam into the hull costs ${c.hullPenalty}**, whether it left by the wrong port or by its own through the wrong lenses. The score never goes below zero.`,
    `A volley with every beam home is **clean**. Clean volleys in a row build a streak: the first pays ${streak[0]}%, the second ${streak[1]}%, and it climbs to ×${streakMax} from the ${nth(streak.length)}. One beam into the hull ends it.`,
    `The strip over the grid shows the best the volley could be. A clean volley worth its best is **perfect** and pays ×${perfect} on top of the streak.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Get every beam home through its recipe, then fire.",
      tips: [
        {
          title: "Flip where the lines cross",
          body: "Follow the broken line from the entry and the dots back from the exit. Where they cross **at a mirror**, flipping that mirror joins the first half of one to the second half of the other. The line turns solid, beaded with the beam's sign, only when the beam is home: at its exit and through its recipe.",
        },
        {
          title: "Read the recipe first",
          body: "Before you flip anything, look outside the exit. One glass means the route must pass a lens of that shape and no other lens. Find that lens on the grid, and think of the route as two legs: entry to lens, lens to exit. A joined line that misses the lens, or passes a lens ringed in danger, is not home.",
        },
        {
          title: "There is no count",
          body: "A volley waits until you fire it. Nothing is lost by looking. Check every beam's line is solid, then tap a lit entry.",
        },
      ],
      drill: `Play rounds with no beam in the hull at all: every volley fired clean. You are there when a round passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Bring two beams home on one grid, and keep the streak.",
      tips: [
        {
          title: "Two beams, one setting",
          body: "Bring the first beam home, then the second, then look at the first again. A mirror you flip for the second may sit on the first one's route, and the board draws both at once so you can see it break. A route that crosses the other beam's lens spoils it too: watch for a danger ring.",
          media: {
            kind: "clip",
            name: "two-beams",
            alt: "Two beams wait, a circle and a square, both astray. One mirror is flipped and the circle's route turns solid, home. A second mirror is flipped and the square's route turns solid too. A tap on an entry fires both, and the mirrors they used fall out of the grid.",
            caption: "One flip brings the circle home, a second brings the square. Both are home on one setting, so the volley is clean.",
          },
        },
        {
          title: "The streak is worth more than any one volley",
          body: `From the ${nth(streak.length)} clean volley in a row everything pays ×${streakMax}. One beam into the hull costs ${c.hullPenalty} and sends you back to the start of the climb, which gives up about ${climb} volleys' worth of points on the way back up. Never fire with a beam astray.`,
        },
        {
          title: "Two lenses pay for the trouble",
          body: `A recipe of two lenses is harder to meet, and pays for it: the same 3 turns are ${pts(3, 2)} through two lenses against ${pts(3, 1)} through one. The deal gives you what one setting can reach, so a two-lens route is always there to find.`,
        },
      ],
      drill: `Play for the streak alone: a whole round with every volley clean. You are there when the streak reaches ${streak.length} and the round passes ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Stop firing the first route you find. See the long way round.",
      tips: [
        {
          title: "Read the strip before you fire",
          body: "Once a volley is home the strip shows two numbers: what it pays now, and the best it could pay. The first route through a recipe is often worth about two thirds of the best. A wide gap means there is a longer way to the same lenses. When the strip says Perfect, there is nothing left to find: fire.",
          media: {
            kind: "still",
            name: "strip",
            alt: "A beam is home by a short route. The strip over the grid shows a small number for firing now and a larger number for the best the volley could be.",
            caption: "Home by a short route. The strip shows what firing now pays and, beside it, the best this volley could be.",
          },
        },
        {
          title: "Wind round, then through",
          body: `Turns are squared, so a longer leg on either side of the lens pays well. Look for a loop of mirrors near the beam's line that you can send it round before or after its lens, and keep the loop clear of the other lenses. Two more turns on a route of 5 take it from ${pts(5, 1)} to ${pts(7, 1)} through one lens.`,
          media: {
            kind: "clip",
            name: "long-way",
            alt: "A beam is home by a short route. A few more mirrors are flipped and the same beam now winds round more mirrors on the way to the same lens and exit. The strip changes to Perfect, the volley is fired and the board calls out a perfect volley.",
            caption: "A few more flips send the same beam round more mirrors on its way. The strip turns to Perfect.",
          },
        },
        {
          title: "See it, do not poke for it",
          body: "Flipping mirrors at random to see if the number goes up loses to firing at once: a longer route that still meets the recipe is rarely one lucky flip away. Trace the long route with your eye first, then flip. Unrated practice rounds pulse the next mirror towards the best setting when you pause. Use that to learn what long routes look like.",
        },
      ],
      drill: `Play rounds with one beam a volley (the studio's preset) for perfect volleys only. You are there when most of them are perfect and a round of two beams passes ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Plan past the volley: perfect at pace, on a grid you shape yourself.",
      tips: [
        {
          title: "Give the long way a budget",
          body: `With no count the only clock is the round. A perfect volley pays ×${perfect} what the same route would plain, so the search is worth about the time of one more quick volley, and no more. If you have not seen the long route by then, fire what is home and take the next volley.`,
        },
        {
          title: "Stack perfect on a full streak",
          body: `Perfect and the streak multiply each other: at full streak a perfect volley pays ×${perfect * streakMax}. Never trade a clean volley for a long route you are not sure of.`,
          media: {
            kind: "clip",
            name: "perfect-pair",
            alt: "Two beams wait, both astray. A handful of mirrors are flipped and both routes turn solid, each through its lenses. The strip says Perfect, the volley is fired, both beams run their routes home and the spent mirrors fall out of the grid.",
            caption: "Two beams, both by the long way, on one setting. The strip says Perfect before the tap.",
          },
        },
        {
          title: "The route you fire is the grid you get",
          body: "Every mirror a beam turns at is spent, and its column drops. A long route spends many mirrors and reshapes much of the grid; a short one leaves most of it as it was. Before you fire, look at what will fall: a column emptied under a lens drops that lens with it, and fresh mirrors come in at the top, set at random. A grid with mirrors spread round the lenses deals long routes; one with a lens cut off deals short ones.",
        },
      ],
      drill: `Time yourself: no volley longer than two quick ones would take, and every one clean. You are there when a round passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    "**Joining the lines and forgetting the recipe.** At its own exit through the wrong lenses, a beam is still in the hull. Check the small lenses outside the exit are all solid.",
    "**Passing an extra lens.** A recipe is exact. A lens ringed in danger spoils the beam even if every lens it asked for is there.",
    "**Fixing the second beam and breaking the first.** Look at both routes after every flip. A clean volley needs both solid.",
    "**Poking mirrors to make the number go up.** It costs more time than it finds. Trace the route first.",
    `**Chasing Perfect at the cost of the streak.** A beam in the hull costs ${c.hullPenalty} and the whole streak. Go back to a route that is home.`,
  ],
};
