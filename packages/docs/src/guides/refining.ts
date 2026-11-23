import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.refining;
const c = p.config;
/** What the k-th clear column of a run pays, before catalysts. */
const clear = (k: number): number => c.clearPoints * Math.min(k, c.runCap);
const seconds = (ticks: number): number => Math.round((ticks * c.tickMs) / 100) / 10;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
const ordinal = ["", "first", "second", "third", "fourth", "fifth", "sixth"];
const nth = (n: number): string => ordinal[n] ?? `${n}th`;
const runTotal = (n: number): number => Array.from({ length: n }, (_, i) => clear(i + 1)).reduce((a, b) => a + b, 0);

export const refining: Guide = {
  id: "refining",
  tagline: "Sort a refinery's tower so every column that reaches the outlet is pure vapour.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Refining tower: ${word(c.width)} columns of ${word(c.height)} pieces, plumes of vapour, round drops of oil and square blocks of tar, with small dots between the pairs that can swap, a hairline down the right edge for the outlet and a round lamp over the outlet column.`,
    caption: "The tower at the start of a round. The dots between pieces are the links: every swap there is.",
  },
  theme: {
    setting:
      "Out on a refinery rock, the feed comes up the pipes in three fractions: light **vapour**, middling **oil** and heavy **tar**. You sort it in the tower before the burners draw each column off, so the tank fills with clean vapour and the tar sinks to the sump.",
    purpose:
      "Refining is a prototype. It is on no ship yet. It tries out a crafting job: patient sorting against a steady clock, where a run of clean batches pays far more than a lucky one.",
  },
  facts: [
    { label: "Tower", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "A draw", value: `Every ${seconds(c.pulseTicks)} seconds, or sooner` },
    { label: "Rated against", value: "The puzzle" },
  ],
  rules: [
    "The tower holds three fractions: **vapour**, **oil** and **tar**. They stand in a cycle: vapour, oil, tar, and back to vapour.",
    "Two neighbours swap when the lower one is next in the cycle after the upper: vapour over oil, oil over tar, tar over vapour. Read left to right, the same. A small dot between two pieces marks every pair that can swap, and no swap can be undone straight away.",
    `Every ${seconds(c.pulseTicks)} seconds the **outlet**, the rightmost column, is drawn. Every other column moves one place right and fresh feed comes in on the left. You can draw early, and the clock starts again from there.`,
    "A drawn column with more tar than vapour **sinks** to the sump. Anything else **rises** to the tank.",
    "A column of nothing but vapour is **clear**. Clear columns in a row make a **run**, and each pays more than the last.",
    `The round is ${p.roundSeconds} seconds on the clock. Swaps are not limited and there is no undo.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "swap",
    alt: "The pointer drags a vapour plume sideways onto the oil drop beside it. The two trade places along the dot that linked them, and the dots around them move to show the swaps there are now.",
    caption: "Vapour moves right past oil. The dots show every swap on the tower.",
  },
  controls: [
    { action: "Swap two neighbours", touch: "Drag a piece onto its neighbour", desktop: "Drag with the mouse, or click a piece and then its neighbour" },
    { action: "Draw the outlet now", touch: "Tap the lamp over the outlet", desktop: "Click the lamp, or press Enter" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Swap with the keyboard", touch: "", desktop: "Space picks the piece under the cursor; an arrow then swaps it that way" },
  ],
  scoring: [
    `**A clear column pays ${c.clearPoints} times its place in the run**, up to the ${nth(c.runCap)}: ${Array.from({ length: c.runCap }, (_, i) => clear(i + 1)).join(", ")}. A column that sinks with no vapour in it, a **dump**, leaves the run alone. Anything else ends it.`,
    `**A smooth column**, no tar and more vapour than oil, pays ${c.smoothPoints}. A column with tar or smoke that rises costs ${c.foulPoints} for each. The score never goes below zero.`,
    `**A catalyst** in a clear or smooth column adds ${c.catalystPoints}. Catalysts never move.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Read the links and make the outlet clear before it is drawn.",
      tips: [
        {
          title: "Follow the dots",
          body: "You never need to work out the cycle in your head. Every pair that can swap has a dot between them. Look at the outlet column, find the oil and tar in it, and follow the dots to see which can be swapped for vapour.",
        },
        {
          title: "Vapour comes in past oil",
          body: "Vapour moves right only by swapping with oil on its right. To bring vapour into the outlet, first get oil into the outlet beside it. Tar moves left out of the outlet by swapping with oil on its left.",
        },
        {
          title: "Watch the lamp",
          body: "The lamp over the outlet fills as the clock comes round, and its heart lights when the outlet is clear. The strip beside it says how the outlet would go if drawn now.",
        },
      ],
      drill: `Play a round where you draw every clear column yourself, before the clock does. You are there when a round finishes above ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Work the column behind the outlet, not only the outlet.",
      tips: [
        {
          title: "The next column is the next outlet",
          body: `Every draw moves the tower right, so the column beside the outlet is the next one drawn. It has only ${seconds(c.pulseTicks)} seconds as the outlet; it has twice that if you start on it now.`,
        },
        {
          title: "Draw early when it is ready",
          body: "A clear outlet will not get any better. Draw it at once and the clock starts again, which gives you more columns in a round.",
          media: {
            kind: "clip",
            name: "clear",
            alt: "One last swap moves a vapour plume into the outlet column, which is now all vapour. The lamp over it lights, the outlet is drawn early, the column rises off the top of the tower, every column moves right and fresh feed slides in on the left.",
            caption: "The outlet is clear the moment its last piece of oil leaves: draw it at once.",
          },
        },
        {
          title: "Line up before you swap across",
          body: "Swaps up and down a column change nothing about what is in it, but they line a piece up beside the one it should trade with. One quiet swap down often sets up the swap across.",
        },
      ],
      drill: `Count your clear columns in the summary. Aim for one in every four drawn. You are there when a round finishes above ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Keep the run alive with dumps.",
      tips: [
        {
          title: "Sort into two kinds of column",
          body: `A column that sinks with no vapour in it is a dump, and a dump leaves the run alone. So sort the feed into clear columns and dumps: vapour one way, oil and tar the other. Three clear columns in a row are worth ${runTotal(3)}, where three apart are worth ${3 * clear(1)}.`,
          media: {
            kind: "clip",
            name: "dump",
            alt: "The outlet holds only oil and tar. The lamp over it is tapped, the column is drawn early and sinks off the bottom of the tower, the rest move right, and the callout says Dump.",
            caption: "A dump: tar and oil to the sump, and the run keeps going.",
          },
        },
        {
          title: "A smooth column ends the run",
          body: `A smooth column pays ${c.smoothPoints}, but it ends the run. In the middle of a run, one more swap to make it clear, or a dump instead, is worth far more.`,
        },
        {
          title: "Never spill vapour",
          body: "Vapour in a column that sinks is spilled, and spilling ends the run as surely as a foul column. Move the vapour out of a dump before it is drawn.",
        },
      ],
      drill: `Play rounds where nothing but clear columns and dumps leave the tower. You are there when a round finishes above ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Plan the whole tower: runs that reach the cap, smoke kept out, catalysts used.",
      tips: [
        {
          title: "Smoke comes back where it hurts",
          body: `Every ${word(c.smokeEvery)} vapour spilled come back as one smoke, on the vapour nearest the outlet: the column you were about to make clear. Smoke swaps like vapour, so swap it into a dump.`,
        },
        {
          title: "Build around catalysts",
          body: `A catalyst never moves, and it pays ${c.catalystPoints} in a clear or smooth column. A column with a catalyst needs one vapour fewer to be clear. A catalyst also blocks every swap through it, so plan your routes around it.`,
        },
        {
          title: "Two columns ahead",
          body: `The run pays its most from the ${nth(c.runCap)} clear column on. Keep the next two columns sorted, one clear and one a dump, so the run never waits on a column you have not started.`,
        },
      ],
      drill: `Play rounds where your longest run reaches ${word(c.runCap)}. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Working only the outlet.** It is drawn in seconds. The columns behind it are where a run is built.",
    `**Cashing in a smooth column mid-run.** ${c.smoothPoints} now, where one more clear column would pay ${clear(2)} or more.`,
    "**Letting vapour sink.** A spill ends the run, and spilled vapour comes back as smoke.",
    "**Waiting for the clock.** A clear outlet or a dump is ready. Draw it and get the next column sooner.",
  ],
};
