import { deflectorsBeamPoints } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.deflectors;
const c = p.config;
/** Ticks as seconds on the round's clock. */
const secs = (ticks: number): number => (ticks * c.tickMs) / 1000;
/** A beam's own points for getting home after this many turns. */
const pts = (turns: number): number => deflectorsBeamPoints(c, turns);
const streak = c.streakPercent;
const streakMax = streak[streak.length - 1]! / 100;
const perfect = c.perfectPercent / 100;
const nth = (n: number): string => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
/** What the climb back to a full streak gives up, counted in volleys at no multiplier. */
const climb = Math.round(streak.reduce((n, pc) => n + (streak[streak.length - 1]! - pc), 0) / 100);

export const deflectors: Guide = {
  id: "deflectors",
  tagline: "Tap a mirror to flip it. Route every beam to its exit, by the longest way you can see.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Deflectors board: a six by six grid with fourteen slanted mirrors, a lit entry port with a count ring on the top edge, an outlined exit port on the bottom edge, a broken line showing where the beam would go now and dots running back from the exit.",
    caption: "One beam waiting. The broken line is where it would go now. The dots run back from its exit.",
  },
  theme: {
    setting:
      "The ship's deflector array is a grid of mirrors behind the hull. Beams come in through the ports on its edge, and you are the pirate turning mirrors so each beam leaves by the port it is meant for. A beam that leaves anywhere else burns into the **hull**.",
    purpose:
      "Deflectors is a prototype. It is on the test bench and in no ship yet. It tries out routing on a clock: one verb, a grid that never changes, and a choice every volley between the first route home and the long way round. It asks you to read a path fast, and later to see the long one before the count runs out.",
  },
  facts: [
    { label: "Board", value: `${c.size} by ${c.size}, ${c.mirrors} mirrors` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.thresholds[2]!.score} points` },
  ],
  rules: [
    "Every mirror is set one of two ways. **Tap a mirror to flip it.** Mirrors never move, and a beam passes straight through an empty cell.",
    "Beams come in **volleys**. A beam's entry port wears a solid sign with the count round it. Its exit port wears the same sign as an outline.",
    "When the count ends every beam fires at once. A beam runs straight, turns at every mirror it meets, and leaves by some port. Out through its own exit it is **home**. Out anywhere else it hits the hull.",
    "While a beam waits, a broken line shows where it would go now and dots run back from its exit. No beam is dealt home already: a volley left alone hits the hull.",
    `A volley is one beam for the first ${secs(c.rampTicks)} seconds and two after that. Two beams fire together, so both must be home on the same setting of the mirrors.`,
    `The count is ${secs(c.chargeTicks)} seconds at the start of the round and ${secs(c.chargeTicksMin)} by the end, with ${secs(c.beamTicks)} more for a second beam. Tap a lit entry to fire now. The next volley comes ${secs(c.respawnTicks)} seconds after one fires.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "join",
    alt: "A beam's broken line and the dots from its exit cross at one mirror. That mirror is tapped, the line becomes one lit route from entry to exit, and a tap on the entry port fires the beam home.",
    caption: "Flip the mirror where the two lines cross and the beam is home. A tap on its entry fires it.",
  },
  controls: [
    { action: "Flip a mirror", touch: "Tap it", desktop: "Click it" },
    { action: "Fire the volley now", touch: "Tap a lit entry port", desktop: "Click a lit entry port, or press F" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Flip at the cursor", touch: "", desktop: "Space or Enter" },
  ],
  scoring: [
    `**A beam home scores by its turns:** turns plus one, squared. 3 turns are ${pts(3)}, 7 are ${pts(7)}, 11 are ${pts(11)}. A mirror met twice counts twice.`,
    `**A beam into the hull costs ${c.hullPenalty}.** The score never goes below zero.`,
    `A volley with every beam home is **clean**. Clean volleys in a row build a streak: the first pays ${streak[0]}%, the second ${streak[1]}%, and it climbs to ×${streakMax} from the ${nth(streak.length)}. One beam into the hull ends it.`,
    `The strip over the grid shows the best the volley could be. A clean volley worth its best is **perfect** and pays ×${perfect} on top of the streak.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Get every beam home, and fire it yourself the moment it is.",
      tips: [
        {
          title: "Flip where the lines cross",
          body: "Follow the broken line from the entry and the dots back from the exit. Where they cross **at a mirror**, flip that mirror: the first half of one joins the second half of the other, and the beam is home. The line turns solid with beads on it when it is.",
        },
        {
          title: "No crossing? Move a line",
          body: "When the two lines do not share a mirror, flip any mirror that one of them turns at. That line now runs somewhere new. Look again for a crossing. Mirrors that neither line touches change nothing, so leave them alone.",
        },
        {
          title: "Fire as soon as it is home",
          body: `Tap the lit entry and the next volley is on the board ${secs(c.respawnTicks)} seconds later. Waiting out a ${secs(c.chargeTicks)} second count on a beam that is already home is the biggest waste in the round. The same play fired by hand scores more than twice as much, because you see more volleys and the streak climbs sooner.`,
        },
      ],
      drill: `Play rounds where no count ever runs out: every volley home and fired by hand. You are there when a round ends with no beam in the hull and passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Bring two beams home on one grid, and never break the streak.",
      tips: [
        {
          title: "Two beams, one setting",
          body: "Bring the first beam home, then the second, then look at the first again. A mirror you flip for the second may sit on the first one's route, and the board draws both at once so you can see it break. When it does, flip it back and look for a mirror on the second beam's lines that the first beam never meets.",
          media: {
            kind: "clip",
            name: "two-beams",
            alt: "Two beams wait, a circle and a square, both astray. One mirror is flipped and the circle's route lights up home. A second mirror is flipped and the square's route lights up too. A tap on an entry fires both.",
            caption: "One flip brings the circle home, a second brings the square. Both are home on one setting, so the volley is clean.",
          },
        },
        {
          title: "The streak is worth more than any one volley",
          body: `From the ${nth(streak.length)} clean volley in a row everything pays ×${streakMax}. One beam into the hull costs ${c.hullPenalty} and sends you back to the start of the climb, which gives up about ${climb} volleys' worth of points on the way back up. When the ring turns red and a beam is still astray, stop improving and get it home.`,
        },
        {
          title: "Of two ways home, take the longer",
          body: `Often more than one flip would join the lines. The strip tells them apart: it shows what firing now would pay. A route of 5 turns pays ${pts(5)} where one of 3 pays ${pts(3)}, for the same single tap. Glance at the number before you fire.`,
        },
      ],
      drill: `Play for the streak alone: a whole round with every volley clean, two beams included. You are there when the streak reaches ${streak.length} and the round passes ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Stop firing the first route you find. See the long way round.",
      tips: [
        {
          title: "Read the strip before you fire",
          body: "Once a volley is home the strip shows two numbers: what it pays now, and the best it could pay. The first route you find is usually worth about a third of the best. A wide gap means there is a long way round on this grid. When the strip says Perfect, there is nothing left to find: fire.",
          media: {
            kind: "still",
            name: "strip",
            alt: "A beam is home by a short route with three turns. The strip over the grid shows a small number for firing now and a much larger number for the best the volley could be.",
            caption: "Home by a short route. The strip shows what firing now pays and, beside it, the best this volley could be.",
          },
        },
        {
          title: "Long routes cross themselves",
          body: `A mirror has two faces, and a beam that meets it twice scores it twice. Most of the best routes do exactly that: they run round a square of mirrors and come back through one they have already used. So do not look for a tidy path. Look for a loop near the beam's line that you can send it round on the way. Two more turns on a route of 5 take it from ${pts(5)} to ${pts(7)}.`,
          media: {
            kind: "clip",
            name: "long-way",
            alt: "A beam is home by a short route. A few more mirrors are flipped and the same beam now winds round a loop, passing through one mirror twice, before it reaches the same exit. The strip changes to Perfect, the volley is fired and the board calls out a perfect volley.",
            caption: "A few more flips send the same beam round a loop and through one mirror twice. The strip turns to Perfect.",
          },
        },
        {
          title: "See it, do not poke for it",
          body: "Flipping mirrors at random to see if the number goes up loses to firing at once: a longer route is rarely one lucky flip away, and each try costs time and risks the beam. Trace the long route with your eye first, then flip. Unrated practice rounds pulse the next mirror towards the best setting when you pause. Use that to learn what long routes look like on a grid.",
        },
      ],
      drill: `Play the first ${secs(c.rampTicks)} seconds of each round, while volleys are one beam, for perfect volleys only. You are there when most of them are perfect and a round passes ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Price every second: perfect volleys at pace, at full streak, to the last tick.",
      tips: [
        {
          title: "Give the long way a budget",
          body: "A perfect volley pays about as much as three quick ones. So the search is worth roughly the time three quick volleys take you, and no more. If you have not seen the long route by then, fire what is home and take the next volley. A slow perfect scores less over a round than a fast plain route.",
        },
        {
          title: "Stack perfect on a full streak",
          body: `Perfect and the streak multiply each other: at full streak a perfect volley pays ×${perfect * streakMax}. That is why the streak comes first. Never trade a clean volley for a long route you are not sure of. Finish the route that is home, check both beams are solid, and only then reach for more.`,
          media: {
            kind: "clip",
            name: "perfect-pair",
            alt: "Two beams wait, both astray. A handful of mirrors are flipped and both routes light up, each winding through many turns. The strip says Perfect, the volley is fired and both beams run their long routes home.",
            caption: "Two beams, both by the long way, on one setting. The strip says Perfect before the tap.",
          },
        },
        {
          title: "Learn this round's grid",
          body: "The mirrors stay where they are for the whole round, and they stay as you left them. A loop you found for one beam is still there for the next beam that passes near it. By the second minute you should know where this grid's loops are and steer beams into them without tracing them again.",
        },
        {
          title: "Fire the last volley",
          body: `A volley still counting when the round ends never fires and scores nothing. Late counts run ${secs(c.chargeTicksMin + c.beamTicks)} seconds for two beams, so when you play at pace the last volley usually runs out of round first. In the final seconds take any route home and tap the entry before the clock does it for you.`,
        },
      ],
      drill: `Time yourself: no volley gets longer than three quick ones would, and the last one is always fired by hand. You are there when a round passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    "**Waiting out the count.** A beam that is home earns nothing by sitting there. Tap its entry.",
    "**Fixing the second beam and breaking the first.** Look at both routes after every flip. A clean volley needs both solid.",
    "**Poking mirrors to make the number go up.** It costs more time than it finds. Trace the route first.",
    `**Chasing Perfect into the red.** A beam in the hull costs ${c.hullPenalty} and the whole streak. Go back to a route that is home.`,
    "**Leaving a volley on the board at the end.** It does not fire when the round ends. Fire it yourself.",
  ],
};
