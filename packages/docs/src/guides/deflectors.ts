import { deflectorsBeamPoints } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.deflectors;
const c = p.config;
/** Ticks as seconds on the round's clock. */
const secs = (ticks: number): number => (ticks * c.tickMs) / 1000;
/** The pace at which a round's pieces last its clock, in seconds a piece, to a tenth. */
const pace = Math.round((p.roundSeconds / c.pieces) * 10) / 10;
const lensPct = c.lensPercent;
/** A beam's own points for lighting a target after this many turns, through a recipe of this many lenses. */
const pts = (turns: number, lenses = 0): number => deflectorsBeamPoints(c, turns, (1 << lenses) - 1);
/** What a shot lighting this many targets is multiplied by. */
const times = (lit: number): number => c.litPercent[Math.min(lit, c.litPercent.length) - 1]! / 100;
const most = c.litPercent.length;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const say = (n: number): string => words[n] ?? String(n);

export const deflectors: Guide = {
  id: "deflectors",
  tagline: "Build a grid of mirrors piece by piece, and fire when the shot is worth it.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Deflectors board: a six by six grid with a few slanted mirrors and lenses. Three emitters sit on the left edge, a disc, a square and a triangle. Bullseye targets sit on the other edges, most with one or two small lenses outside them. One beam's route is drawn solid into a target ringed in its colour; the others are thin broken lines. The next piece waits in its slot under the grid.",
    caption: "One beam already lights a target. The small lenses outside each target are what a beam must pass to light it. The next piece waits under the grid.",
  },
  theme: {
    setting:
      "The ship's deflector array is a grid you build behind the hull. Mirrors and lenses come off a rack of limited stock, and you are the pirate setting each one down. Three emitters wait on one edge; targets wait on the others. Fire, and every beam that reaches a target through the right lenses lights it.",
    purpose:
      "Deflectors is a prototype. It is on the test bench and in no ship yet. It tries out building as strategy: there is no one right route, only a grid you shape piece by piece and a choice of when a shot is worth firing.",
  },
  facts: [
    { label: "Board", value: `${c.size} by ${c.size}, ${c.emitters} emitters, ${c.targets} targets` },
    { label: "Round", value: `${p.roundSeconds} seconds, ${c.pieces} pieces` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.thresholds[2]!.score} points` },
  ],
  rules: [
    `A round deals **${c.pieces} pieces**: mirrors, and now and then a lens. The **queue** under the grid shows the next ${say(c.queueSize)}. **Put the next piece on a cell**, empty or over whatever is there: with a mouse, hover a cell to see it there as a ghost, routes and all, and click to lock it in; on a touch screen, drag it from the queue and lift to drop it. Tap the next piece to turn a mirror the other way first.`,
    "Nothing comes on a timer and nothing is put down for you. A piece you do not want goes in the **bin**, left of the queue: it is used up all the same. The count beside the queue says how many pieces are left.",
    `${say(c.emitters).replace(/^./, (x) => x.toUpperCase())} **emitters** sit on the left edge. **Tap them to fire**, and every one fires at once. Each beam runs straight, turns at every mirror it meets, passes straight through a lens, and leaves by some port. Now and then a piece is a **splitter**, a three-armed fork: a beam that meets it splits in two, one half going each way across it.`,
    "**Targets** sit on the other edges. A beam that leaves by a target **lights** it if it passed exactly the lenses drawn outside that target: every one of them, and no other kind. A target with none drawn wants a beam through no lens at all.",
    "The board always draws each beam's route as the grid stands: solid into a target it would light, thin and broken anywhere else. A lens ringed in danger is spoiling a beam on its way to a target.",
    `Firing **spends** every mirror a beam turned at, every splitter it split at, and every lens a lighting beam passed: they leave the grid. Each lit target asks for new lenses. The emitters take ${secs(c.fireTicks)} seconds to recharge.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "light",
    alt: "Nothing on the grid lights a target. The next mirror is turned and put down on an empty cell, and one beam's broken line becomes a solid route that winds round several mirrors into a target, which is ringed in the beam's colour. A tap on the emitters fires: the beam runs its route, the target flashes and its points rise from it, and the mirrors the beams turned at shrink away.",
    caption: "One mirror put down sends a beam round into a target. Fire, and the mirrors the beams used are spent.",
  },
  controls: [
    { action: "Try the next piece on a cell", touch: "Drag it over the grid", desktop: "Hover a cell" },
    { action: "Put the next piece down", touch: "Lift over a cell", desktop: "Click the cell" },
    { action: "Turn the next mirror", touch: "Tap it in the queue", desktop: "Click it in the queue, or press R" },
    { action: "Bin the next piece", touch: "Tap the bin", desktop: "Click the bin, or press X" },
    { action: "Fire", touch: "Tap the emitters", desktop: "Click the emitters, or press F" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Put the piece at the cursor", touch: "", desktop: "Space or Enter" },
  ],
  scoring: [
    `**A beam that lights a target scores by its turns:** turns plus one, squared, and ${lensPct}% more for each lens in the target's recipe. 3 turns through no lens are ${pts(3)}, through one are ${pts(3, 1)}; 7 turns through two are ${pts(7, 2)}. A mirror met twice counts twice.`,
    `**A shot is multiplied by how many targets it lights:** ×${times(1)} for one, ×${times(2)} for two${most >= 3 ? `, ×${times(3)} for ${say(3)}` : ""}. Each target lights once a shot.`,
    "**A split beam scores each half on its own**, and the split counts as a turn for both. Each half can light a target of its own, and counts towards the multiplier.",
    "**A beam that lights nothing scores nothing** and costs nothing. Firing is never punished; firing too early is just worth less.",
  ],
  stages: [
    {
      level: "beginner",
      goal: "Light a target, fire, and see what the shot spends.",
      tips: [
        {
          title: "Follow one beam",
          body: "Pick one emitter and follow its broken line to where it leaves. Put a mirror where the line passes so it turns towards a target. When the line turns solid and the target is ringed in that beam's colour, the shot lights it.",
        },
        {
          title: "Read the recipe",
          body: "Before you aim at a target, look at the small lenses outside it. A target with one glass wants a beam through a lens of that shape and no other. Aim at plain targets first, then route through a lens on the grid on the way.",
        },
        {
          title: "Turn before you put it down",
          body: "A mirror can go either way. Tap the next piece in the queue to turn it: the way it is drawn in its slot is the way it goes down. Before you commit, hold it over a cell: the routes redraw as if it were there. Set as /, it sends a beam heading right upwards; set the other way, downwards.",
        },
      ],
      drill: `Play rounds firing every time something lights. You are there when a round passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Light two targets in one shot.",
      tips: [
        {
          title: "Two at once pays double",
          body: `A shot that lights two targets is worth ×${times(2)}. Two beams of 3 turns each are ${pts(3) * 2} fired one by one, and ${pts(3) * 2 * times(2)} together. With one target lit, do not fire yet: look for the piece that lights a second.`,
          media: {
            kind: "clip",
            name: "double",
            alt: "One beam already lights a target. A mirror is put down where another beam's broken line passes, and that line turns solid into a second target. The strip says two lit, times two. The emitters fire, both targets flash, and the board calls out two lit.",
            caption: "One target lit. One more mirror lights a second, and the shot pays double.",
          },
        },
        {
          title: "Keep your lit routes clear",
          body: "Every beam fires every shot. A piece you put down for one beam may sit on another's solid route and break it. Look at every route after each piece.",
        },
        {
          title: "Read the queue, then the bin",
          body: "Not every piece fits. Look at the pieces after the next one before you put it down: a mirror that is useless now may be the one the piece after it needs. A piece that fits nothing goes in a corner you are not building in, or in the bin. Both use it up; only the corner might pay later.",
          media: {
            kind: "still",
            name: "queue",
            alt: "Under the grid, the bin on the left, the next piece large in its slot, two smaller pieces after it, and a count of pieces left.",
            caption: "The bin, the next piece, the two after it to plan with, and how many the round has left.",
          },
        },
      ],
      drill: `Play rounds where you never fire a shot that lights only one target before the last ten seconds. You are there when a round passes ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Decide when to cash in and when to build on.",
      tips: [
        {
          title: "No shot is the right one",
          body: `There is no correct route here, only better and worse shots for the grid you have. A shot that lights two targets now is worth ×${times(2)}. Holding it for a third is worth ×${times(most)}, but every piece you put down meanwhile can break what you have, and the queue will not wait.`,
        },
        {
          title: "Long routes pay squared",
          body: `Turns are squared, so one beam winding round seven mirrors is worth more than two beams round three: ${pts(7)} against ${pts(3) * 2}. Before a shot that lights a lot, see if a mirror or two more can lengthen one of its routes without breaking the others.`,
        },
        {
          title: "Split for a wider shot",
          body: "One emitter through a splitter can light two targets, and a splitter on a route that already lights keeps that half and sends a new one out. Put one where both halves have somewhere to go: a split into an empty edge is a turn spent for nothing.",
        },
        {
          title: "What you fire is what you clear",
          body: "Firing spends every mirror a beam turned at, lit or not, and every lens a lighting beam passed. A shot that lights little still clears the grid for the next build. A cramped grid is a reason to fire.",
        },
      ],
      drill: `Play rounds firing only shots worth more than the round's average. You are there when a round passes ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Build two shots ahead.",
      tips: [
        {
          title: "Spend on purpose",
          body: "Before you fire, look at which mirrors the shot will spend and what is left. Keep the mirrors that will form the next routes off this shot's paths. A grid that is half built for the next shot when this one fires is worth more than any one shot.",
        },
        {
          title: "Watch the recipes turn over",
          body: "A lit target asks for new lenses. A target that asked for nothing may ask for two next time. The lenses you have on the grid decide which targets you can chase next; keep a lens or two that no shot spends until you need it.",
        },
        {
          title: "Pace the round",
          body: `The pieces last the clock at about ${pace} seconds a piece. Slower, and some are never placed; faster, and the spare time buys nothing. Think at that pace, no slower, and plan the last build so it uses the last piece and fires.`,
        },
      ],
      drill: `Time yourself on the last shot of the round. You are there when a round passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    "**Firing every time something lights.** A shot that lights one target is worth the least it can be. Build towards two or three first.",
    "**Waiting for a perfect shot that never comes.** Each piece you put down can break a lit route. Fire when the shot is good, not when it is the best you can imagine.",
    "**Forgetting the recipe.** A beam out through a target with the wrong lenses lights nothing. Check the small glasses are solid.",
    "**Binning without looking ahead.** A binned piece is gone from a small supply. Check the pieces after it first: a mirror can wait in a corner for a route that needs it.",
    "**Ending the round with an unfired build.** Whatever is on the grid at the end scores nothing. Fire before the clock runs out, and before the last piece is gone.",
  ],
};
