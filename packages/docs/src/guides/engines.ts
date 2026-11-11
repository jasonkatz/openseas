import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.engines;
const c = p.config;
const kinds = p.pieces.slice(0, c.pieceKinds).map((k) => content.messages[k.nameKey]!.toLowerCase());
/** What an injector with n targets pays when it fires at the given chain step (1 is the landing's own). */
const inj = (targets: number, step = 1): number => c.injectorPoints * targets * c.chainMultipliers[Math.min(step, c.chainMultipliers.length) - 1]!;
const run = (n: number): number => c.runPoints * Math.max(1, n - 3);
const mult = (step: number): number => c.chainMultipliers[Math.min(step, c.chainMultipliers.length) - 1]!;
/** Seconds a pair takes from the entry to the floor, falling free and hurried. */
const freeFall = Math.round((p.fallMs * (c.height - 1)) / 1000);
const hurry = Math.round(p.fallMs / p.softDropMs);

export const engines: Guide = {
  id: "engines",
  tagline: "Steer falling pellet pairs onto injector targets, then make one firing feed the next.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Engines board: a tall dark core with six injectors of different shapes, some of their ringed targets already holding pellets, and a pair of pellets falling from the top.",
    caption: "The drive core. Each ring is a target that wants the pellet of its color and mark.",
  },
  theme: {
    setting:
      "You are at the drive console, aft, feeding the **drive core**. Fuel pellets come down the chute in joined pairs. Your hands steer each pair onto the **injectors**, the metal shapes waiting in the core, and an injector fires when it has the fuel it wants.",
    purpose:
      "Every ship's turn, what you scored here becomes the ship's **movement tokens**: the moves she has to fly with, in a lane and in a space battle. A drive station with nobody at it makes none.",
  },
  facts: [
    { label: "Board", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.parScore} points` },
  ],
  rules: [
    `Pellets fall in joined **pairs** of ${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}. Every pair enters at the middle of the top row. The strip above the core shows the next one.`,
    `${c.injectorsAtOnce} injectors sit in the core: bars, stacks, L shapes and squares. A ringed cell is a **target** that wants one kind. A plain cell is a blank that holds anything.`,
    "Fill every target on an injector with its kind and it **fires**. Its target pellets go, the injector goes, and a new one is dealt somewhere else.",
    "An injector has a **shelf** under its bottom cells. Pellets rest on it, and a pair can slide into a cell from the side.",
    "Four or more of a kind in a line, across or down, clear as a **run**.",
    "The two halves stay joined while both are in the core. A pair rests as soon as either half is held up, so one half can hang over a gap. When its partner clears, it falls.",
    `If a pellet blocks the entry the core **flames out**: everything is swept away, you lose ${c.flameoutPenalty} points and play goes on. The round ends on the clock.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-injector",
    alt: "A pair is tapped to turn it upright, dragged sideways over a two cell injector and swiped down. Both pellets land on their targets and the injector fires.",
    caption: "Tap to turn, drag to steer, swipe down to hurry. Both targets filled: the injector fires.",
  },
  controls: [
    { action: "Steer the pair", touch: "Drag sideways anywhere on the board", desktop: "Left and right arrows, or drag" },
    { action: "Turn it", touch: "Tap anywhere on the board", desktop: "Up or X turns one way, Down or Z the other. A click turns it too" },
    { action: "Hurry it down", touch: "Swipe down and hold. Steering is locked until you lift", desktop: "Hold Space" },
  ],
  scoring: [
    `**An injector pays ${c.injectorPoints} for each target.** Blanks pay nothing. A run of four pays only ${run(4)}, and ${c.runPoints} more for each extra pellet.`,
    `**Each step of a chain multiplies**: ${c.chainMultipliers.map((m) => `×${m}`).join(", ")}. A step is a clear caused by the fall after the clear before it.`,
    "Two clears in the same step double that step, three triple it.",
    `A flameout costs ${c.flameoutPenalty}. Nothing else takes points away.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Land every pellet on purpose, and hurry every pair.",
      tips: [
        {
          title: "Read the ring, trust the glow",
          body: "A target's ring has the color and the mark of the pellet it wants. The thin rings below the falling pair show where it will land. When a half is lined up over a target of its own kind, that landing ring **glows**. Glow, then drop.",
        },
        {
          title: "Always hurry",
          body: `Left alone, a pair takes about ${freeFall} seconds to reach the floor. Hurried, it falls ${hurry} times as fast. There is no instant drop, so the habit is: turn, steer, then swipe down and hold. The hurry locks steering, so line up first.`,
        },
        {
          title: "Park the spare half",
          body: "Most pairs have one half you want and one you do not. Put the spare in a blank cell, on the floor, or let it hang in open space beside its partner. Never rest it on a target that wants another kind: that injector cannot fire until a run digs the pellet out.",
        },
        {
          title: "Keep the middle low",
          body: `Only the entry matters for a flameout: the two middle cells of the top row. Build height at the sides if you must. ${c.flameoutPenalty} points is ${Math.ceil(c.flameoutPenalty / c.injectorPoints)} targets' worth.`,
        },
      ],
      drill: `Play a round where no pair falls free: every one is hurried, and every one puts at least one half on a glowing ring or a blank. You are there when a round passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Make both halves count, and keep every injector able to fire.",
      tips: [
        {
          title: "Turn for two targets",
          body: `Before you steer, look for a place that takes **both** halves: upright into a stack, flat along a bar, or one half on a target and one in a blank. A pair that fills two targets is ${inj(2)} points of work in one landing. Use both turn directions on a keyboard: one press is quicker than three.`,
        },
        {
          title: "Come in from the side",
          body: "A shelf stops anything falling through from above, so a target under another injector looks shut. It is not. Let the pair fall beside it, steer sideways when it is level with the cell, and it slides in and rests there. An upright pair cannot do this where a shelf would run between its halves.",
        },
        {
          title: "Runs are a broom",
          body: `A run of four is worth ${run(4)}, less than one target. Its job is to clean: line up four of a kind through a wrong pellet and it is gone. Stack your spare halves by kind on the floor so the mess clears itself.`,
        },
        {
          title: "Steer during the clears",
          body: "The next pair is yours the moment the last one lands. While clears play out below it waits at the top and does not fall. Use that time: read the strip, turn the pair and move it over its column, so it drops the instant the board is still.",
        },
      ],
      drill: `Count wrong pellets sitting on targets when the round ends. You are there when the count is zero and the round passes ${p.parScore} points.`,
    },
    {
      level: "advanced",
      goal: "Stop firing injectors one at a time. Make one firing feed the next.",
      tips: [
        {
          title: "Know what falls",
          body: "When an injector fires, only its target pellets go. Its shelves go with it. So everything it was holding up drops **straight down**: a pellet in a blank, a pellet resting on top, and the spare half of the pair that fired it. Each stops at the first shelf, pellet or floor under it.",
        },
        {
          title: "Leave one open below",
          body: "Load an injector until a single target is open, then stop. Note the column of that open target and the kind it wants. That injector is now a prize waiting for a fall. Finishing it by hand pays it once. Feeding it by a fall pays it three times.",
          media: {
            kind: "still",
            name: "chain-before",
            alt: "A core with several part loaded injectors and nothing fired yet. A pair waits at the top, about to be steered onto the injector at the top right.",
            caption: "Set up, nothing fired. The next pair goes on the injector at the top right.",
          },
        },
        {
          title: "Fire above it with the right spare",
          body: `Now fire an injector higher up with a pair whose **other half** is the kind the open target wants, hanging in that target's column. The injector fires, the spare half falls into the open target, and the second injector fires at ×${mult(2)}. A three target injector is ${inj(3)} by hand and ${inj(3, 2)} at step two.`,
          media: {
            kind: "clip",
            name: "chain",
            alt: "A pair lands on a high injector and fires it. The pair's other half falls down the column into the open target of a lower injector, which fires as Chain 2.",
            caption: `One landing, two injectors. The spare half falls into the second, which pays ×${mult(2)}.`,
          },
        },
        {
          title: "Small one first",
          body: `Only the later steps are multiplied, so the order matters. A one target injector that sets off a four target one is ${inj(1)} + ${inj(4, 2)} = ${inj(1) + inj(4, 2)}. The other way round is ${inj(4)} + ${inj(1, 2)} = ${inj(4) + inj(1, 2)}. Fire the small one by hand and let the fall finish the big one.`,
        },
      ],
      drill: "Each round, refuse to finish your biggest injector by hand: it may only fire from a fall. You are there when Chain 2 shows up three times in a round.",
    },
    {
      level: "expert",
      goal: `Build falls that feed falls, for the ×${mult(3)} and ×${mult(4)} steps, and waste no second of the clock.`,
      tips: [
        {
          title: "Park the feed on the middle injector",
          body: `A third step needs the second injector to drop something when it fires. So while you load it, rest a pellet **on it** or in one of its blanks, straight above the open target of a third injector, in the kind that target wants. Your spare halves have to go somewhere: this is the best place. The third injector pays ×${mult(3)}.`,
          media: {
            kind: "still",
            name: "three-before",
            alt: "A core set up for a three step chain: a stack at the upper left, a bar below it and a small injector lower still, with pellets resting on and beside them.",
            caption: "Before the drop. The pair goes on the stack at the upper left, and three injectors fire one after another.",
          },
        },
        {
          title: "Read the whole line before you drop",
          body: `Trace it top down: what fires, what that lets go, where each loose pellet stops, what that fires. A pellet caught by a stray shelf ends the chain. Two target injectors at steps one, two and three pay ${inj(2)} + ${inj(2, 2)} + ${inj(2, 3)} = ${inj(2) + inj(2, 2) + inj(2, 3)}. Fired by hand they pay ${3 * inj(2)}.`,
          media: {
            kind: "clip",
            name: "three",
            alt: "One pair lands and fires an injector. A pellet it held falls and fires a second injector as Chain 2, and a pellet that one held falls and fires a third as Chain 3.",
            caption: `One landing, three steps: ×${mult(1)}, ×${mult(2)}, ×${mult(3)}.`,
          },
        },
        {
          title: "Double a step",
          body: `Clears in the same step multiply by their count. No pair can finish two injectors by landing, because injectors never touch. But a run can clear with an injector. A bar of four targets all wanting one kind is a run of four as it fires: (${inj(4)} + ${run(4)}) × 2 = ${(inj(4) + run(4)) * 2} for the ${inj(4)} you would expect. At a later step, two pellets falling into two injectors at once double that step as well.`,
        },
        {
          title: "Keep several injectors one short",
          body: "A chain needs stock. Hold three or four injectors one pellet from firing, open on different kinds, and almost any pair has a use: one half triggers or feeds, the other parks as the next feed. Fire by hand only what stands in the way or what the clock will not let you set up.",
        },
      ],
      drill: `Before each drop, say how many steps it will run. You are there when Chain 3 comes on purpose and a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Letting pairs fall free.** The free fall is most of a slow round. Hurry every pair.",
    "**A wrong pellet on a target.** That injector is dead until a run clears the pellet. Use a blank, the floor or open space for the spare half.",
    `**Chasing runs for points.** A run of four is ${run(4)} points. Runs clean up. Injectors score.`,
    "**Finishing every injector by hand.** The same injector fed by a fall pays three times as much. Leave your best one open and fire something above it.",
    "**Stacking under the entry.** Height in the two middle columns is what flames the core out.",
  ],
};
