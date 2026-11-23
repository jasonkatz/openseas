import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.tractor;
const c = p.config;
/** A run of n pieces, before its wave's percent. */
const run = (n: number): number => c.runPoints * n * n;
/** What k caches hauled in one swap are worth between them. */
const caches = (k: number): number => c.cachePoints * k * k;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
const times = (percent: number): string => `×${percent / 100}`;
const waveTop = c.cascadePercent[c.cascadePercent.length - 1]! / 100;

export const tractor: Guide = {
  id: "tractor",
  tagline: "Swap loot up and down to line up three of a kind. Lift sealed caches to the hatch.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Tractor field: ${c.width} columns and ${c.height} rows of loot in ${word(c.kinds)} shapes, coins, ingots, gems, chalices and crowns, with a sealed cache low in the field and a hairline over the top row for the hatch.`,
    caption: "The field at the start of a round. The cache low down has a long way to rise.",
  },
  theme: {
    setting:
      "The fight is won and the loser's hold has burst open. You are the pirate on the tractor beam, pulling the loot aboard through the hatch over your head. Coins and gems come in by the handful, and somewhere in the drift float sealed **caches**, worth more than all of it.",
    purpose:
      "Tractor is a prototype. It is on no ship yet. It tries out a haul after a fight: quick eyes for three of a kind, and the patience to bring caches up together instead of one at a time.",
  },
  facts: [
    { label: "Field", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "Caches", value: `${c.startCaches} to start, ${c.maxCaches} at most` },
  ],
  rules: [
    "Swap any piece with the piece directly **above or below** it. Pieces never swap sideways.",
    "Three or more of one kind in a row or a column are **beamed aboard**. A swap that makes no run is allowed and scores nothing.",
    "The beam pulls up. Everything below a gap rises to close it, and new loot drifts in at the bottom. New loot never completes a run as it arrives, so every run after the first comes from pieces you could see.",
    "A **cache** cannot be swapped and is in no run. It rises as the pieces over it go, and a cache that reaches the top row is hauled aboard.",
    `Every ${word(c.beaconEvery)} swaps that score, a **beacon** drifts in: loot with a mark cut through it. It matches as its kind. In a run it fires. A **cross** sweeps its whole row and column, a **saltire** both its diagonals. Everything on those lines comes aboard, a beacon swept fires in turn, and a cache on those lines is hauled at once.`,
    `The round is ${p.roundSeconds} seconds on the clock. Swaps are not limited and there is no undo. A field with no swap left that scores is dealt again, and the caches and beacons stay put.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-run",
    alt: "The pointer drags one piece down onto the piece under it. The two trade places, three of one kind line up and shrink away, the pieces below rise to fill the gap and new loot rises in at the bottom.",
    caption: `One swap down makes a run of three: ${run(3)} points. Everything below rises into the gap.`,
  },
  controls: [
    { action: "Swap a piece down or up", touch: "Drag it down or up onto its neighbour", desktop: "Drag with the mouse, or click it and then the piece above or below" },
    { action: "Pick a piece, then swap", touch: "Tap it, then tap the piece above or below", desktop: "The same with clicks" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD move the pair of cells the cursor holds" },
    { action: "Swap the cursor's pair", touch: "", desktop: "Space or Enter. The strip over the field shows what it is worth first" },
  ],
  scoring: [
    `**A run of n pieces scores ${c.runPoints} × n × n.** Three is ${run(3)}, four is ${run(4)}, five is ${run(5)}. A piece in a row and a column at once counts in both.`,
    `**Each wave of one swap pays more.** The first wave is ${times(c.cascadePercent[0]!)}, then ${c.cascadePercent.slice(1).map(times).join(", ")}, and it stays at ${times(c.cascadePercent[c.cascadePercent.length - 1]!)} after that. A piece a beacon sweeps adds ${c.sweepPoints}.`,
    `**Caches hauled in one swap multiply each other.** One is ${caches(1)}, two together are ${caches(2)}, three are ${caches(3)}.`,
  ],
  stageMedia: {
    full: {
      kind: "clip",
      name: "beacon",
      alt: "A swap puts a cross beacon on the bottom row into a run. It fires a cream line along its row and up its column, every piece on those lines is pulled aboard, and the cache beside it on the bottom row goes with them.",
      caption: "A cross fires along its row and its column. Whatever sits on those lines comes aboard, caches too.",
    },
  },
  stages: [
    {
      level: "beginner",
      goal: "Find a run on every swap, and start seeing fours and fives.",
      tips: [
        {
          title: "Look for two and a gap",
          body: "Every run you can make is two of a kind with the third one row off. In a column, look for two stacked with the third just above or below the next piece. In a row, look for two side by side with the third one row up or down from the gap. Swap it in.",
        },
        {
          title: "Longer runs pay far more",
          body: `Two runs of three are ${2 * run(3)}. One run of five is ${run(5)}. When you find a run, check whether the same swap could make it four or five with a different piece.`,
        },
        {
          title: "Use the strip",
          body: "With the keyboard, the strip over the field shows what the pair the cursor holds is worth before you swap. It says so when a swap makes no run.",
        },
      ],
      drill: `Play a round with no swap that scores nothing. You are there when a round finishes above ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Make swaps that set off a second wave, and bring caches up.",
      tips: [
        {
          title: "Read what will rise",
          body: `After a run goes, every piece under it rises the same number of rows. Before you swap, look at what sits under the run. If rising puts three of a kind together, that is a second wave at ${times(c.cascadePercent[1]!)}. New loot never makes a run on arrival, so every wave is one you could have seen.`,
        },
        {
          title: "A column run lifts three rows",
          body: "A run down a column takes three pieces out of one column, so everything below rises three rows at once. That is the fastest way to bring a cache up: make the run in the cache's own column, above it.",
          media: {
            kind: "clip",
            name: "lift",
            alt: "A run of three is made in the column above a cache. The three go and the cache rises three rows with the pieces around it.",
            caption: "A run straight above a cache lifts it three rows in one swap.",
          },
        },
        {
          title: "Swaps that score nothing are setup",
          body: "A swap that makes no run still moves two pieces. When no run on the field is worth much, one quiet swap can line up a run of four or a second wave for the next. It costs time on the clock, so use it when the payoff is clear.",
        },
      ],
      drill: `Watch the waves badge beside the score. Aim for a second wave on one swap in every five. You are there when a round finishes above ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Bring caches aboard together, never one at a time.",
      tips: [
        {
          title: "Two at once are worth four",
          body: `One cache is ${caches(1)}. Two in one swap are ${caches(2)}, three are ${caches(3)}. Before a cache reaches the top row, look for a second one close behind and slow the first: stop clearing its column until the other catches up.`,
        },
        {
          title: "Line caches up on one row",
          body: "Caches in different columns rise only when their own columns clear. Clear the column of the lower cache until both sit on the same row. Then one run across the row above both lifts them together, or one beacon on their row takes both.",
        },
        {
          title: "Know where the next cache comes from",
          body: `Caches drift in at the bottom with new loot, at most ${word(c.maxCaches)} on the field. With the field full of caches no more can come, so bring a group aboard to make room.`,
        },
      ],
      drill: `Play rounds where no cache is hauled alone. Check the summary: most caches in one swap should be two or more. You are there when a round finishes above ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Fire beacons where they pay most, through caches and into chains.",
      tips: [
        {
          title: "Hold a beacon for its line",
          body: `A beacon fired the moment it can is worth a few pieces at ${c.sweepPoints} each. A cross fired on the row or column your caches sit on hauls them all at once, worth ${caches(2)} for two. Keep the beacon out of runs until its line is worth firing.`,
          media: {
            kind: "clip",
            name: "two-caches",
            alt: "A swap puts a cross beacon into a run with two caches above it in its column. The beacon fires a cream line up its column and along its row, both caches are pulled aboard together, and the board pulses once.",
            caption: `One cross, two caches in its column: ${caches(2)} for the pair, on top of the run and the sweep.`,
          },
        },
        {
          title: "Chain beacons",
          body: "A beacon swept by another fires in turn. Two beacons on one line, a cross and a saltire, can clear half the field in one swap and lift every cache above the gap.",
        },
        {
          title: "Plan the wave, not only the run",
          body: `Waves climb to ${times(c.cascadePercent[c.cascadePercent.length - 1]!)}, so a swap that sets off three waves pays the third at ${waveTop} times. The best swaps line up a run whose rising pieces make the next run, and a beacon or a cache sits where the third wave lands.`,
        },
      ],
      drill: `Play rounds where every beacon fired hauls a cache or sets off another beacon. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    `**Hauling caches one at a time.** ${caches(1)} each, where two together are ${caches(2)}.`,
    "**Firing a beacon the first chance you get.** A cross through an empty row pays a few points. Through your caches it pays the most of anything on the field.",
    "**Clearing under a cache.** A run below a cache does not lift it. Only pieces going above it in its own column do.",
    "**Swapping without a run.** It is allowed, but it spends the clock. Swap quietly only to set up a run you can name.",
  ],
};
