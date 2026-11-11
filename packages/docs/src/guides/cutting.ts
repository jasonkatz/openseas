import { cuttingSlabShape, cuttingStreakPercentAt } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.cutting;
const c = p.config;
/** What a pure piece of n cells banks. */
const v = (n: number): number => c.cellPoints * n * n;
/** Slabs in a row before the streak stops growing, and what it multiplies the bonus by then. */
const streakFull = c.streakPercent.length;
const streakMax = c.streakPercent[streakFull - 1]! / 100;
const bonusAt = (base: number, streak: number): number => Math.floor((base * cuttingStreakPercentAt(c, streak)) / 100);
const flawlessTop = bonusAt(c.flawlessBonus, streakFull);
const cleanTop = bonusAt(c.cleanBonus, streakFull);
/** What a rough slab at full streak costs a player who is flawless before and after it: its own bonus, and the climb back. */
const roughCost = flawlessTop + Array.from({ length: streakFull - 1 }, (_, i) => flawlessTop - bonusAt(c.flawlessBonus, i + 1)).reduce((a, b) => a + b, 0);
/** The first slab, counting from one, that is as busy as slabs get. */
let busiest = 0;
while (cuttingSlabShape(c, busiest).parts < c.partsMax || cuttingSlabShape(c, busiest).flaws < c.flawsMax) busiest++;
busiest += 1;
const cleanShare = c.cleanPercent % 20 === 0 ? `${["no", "one", "two", "three", "four"][c.cleanPercent / 20]} fifths` : `${c.cleanPercent} percent`;

export const cutting: Guide = {
  id: "cutting",
  tagline: "Slice a slab along its grid. Bank the pieces of one ore, and bank them big.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Cutting board: a slab ${c.width} cells wide and ${c.height} tall made of blocks of ore, each ore with its own shape stamped on it. A strip above shows a lamp for each cut left, what is banked against the slab's best, and a chip that reads Next slab.`,
    caption: "A fresh slab. The lamps are your cuts, and the number is what you have banked against the best this slab can pay.",
  },
  theme: {
    setting:
      "A slab of salvage is on the cutting table, fused from blocks of different ore. You are the pirate with the torch. Every cut runs straight along the grid, and a piece that comes away as one ore goes to the hold.",
    purpose:
      "Cutting is a **prototype**: it is played on the test bench and is in no ship yet. It is trying out a puzzle with no clock on the move, where the whole slab can be planned before the first cut and there is always one cut too few. The skill it asks for is order, then choosing what to give up.",
  },
  facts: [
    { label: "Slab", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Cuts", value: `${c.minCuts} to ${c.maxCuts} a slab` },
    { label: "Status", value: "Prototype, on the test bench" },
  ],
  rules: [
    "A slab is made of blocks of ore. A **flaw** is a single cell of the wrong ore sitting in a block.",
    "A cut runs along a grid line, the whole way across the piece it is made in, and splits that piece in two. So every piece is a rectangle.",
    "A piece that holds one ore only is **pure**. It is banked at once and leaves the table. A mixed piece stays.",
    `Each slab comes with ${c.minCuts} to ${c.maxCuts} cuts, shown as lamps. It is always about one cut fewer than the slab wants.`,
    "A slab ends when the table is bare, when the cuts are spent, or when no cut left could bank anything. What is still on the table is **scrap** and pays nothing.",
    `The slab is then graded against the best any plan could have banked from it with its cuts. All of the best is **flawless**, ${cleanShare} of it is **clean**, less is **rough**. The next slab is dealt at once.`,
    `Slabs get busier: ${c.partsStart} blocks and ${c.flawsStart} flaw at first, ${c.partsMax} blocks and ${c.flawsMax} flaws from slab ${busiest} on.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-cut",
    alt: "A swipe along a grid line of a fresh slab. A line appears across the whole slab, the side that holds one ore lights up with the points it would pay, and on release that side is banked and leaves the table.",
    caption: "Swipe along a line. The side that is one ore lights up with what it pays, and is banked when you let go.",
  },
  controls: [
    { action: "Make a cut", touch: "Swipe along a grid line inside a piece and lift", desktop: "Drag along the line and release" },
    { action: "Line a cut up, then make it", touch: "Tap near a line, then tap the same line again", desktop: "Click near a line, then click it again" },
    { action: "Move a lined-up cut", touch: "Tap another line", desktop: "Left and right move a cut that runs down. Up and down move one that runs across" },
    { action: "Take the next piece", touch: "Tap in it", desktop: "Tab or N" },
    { action: "Cut at the line", touch: "", desktop: "Space or Enter" },
    { action: "Drop the cut", touch: "Tap off the slab", desktop: "Escape" },
    { action: "Give the slab up for the next one", touch: "Tap Next slab", desktop: "Click Next slab, or press D" },
  ],
  scoring: [
    `**A pure piece pays its cells times its cells.** ${[2, 4, 6, 12].map((n) => `${n} cells is ${v(n)}`).join(", ")}. One piece of twelve pays ${v(12) / (2 * v(6)) === 2 ? "twice" : `${v(12)} against the ${2 * v(6)} of`} two pieces of six.`,
    `A flawless slab pays a bonus of ${c.flawlessBonus} and a clean one ${c.cleanBonus}. A rough slab pays none.`,
    `Clean and flawless slabs in a row build a **streak** that multiplies the bonus, up to ×${streakMax} from the ${ordinal(streakFull)} in a row. A rough slab breaks it.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "See a rectangle of one ore, and know what a cut will bank before you make it.",
      tips: [
        {
          title: "Look for rectangles",
          body: "Only a rectangle of one ore banks. Blocks of the same ore run together into odd shapes, and a flaw spoils the block it sits in. So look for the biggest clean rectangle inside each shape, not the shape itself.",
        },
        {
          title: "Line it up first",
          body: "Tap near a line and the cut is drawn across the whole piece without being made. A side that would be banked lights up with what it pays. A side that would stay is dimmed. Nothing is spent until you tap that line again.",
          media: {
            kind: "still",
            name: "preview",
            alt: "A slab with a cut lined up across it. The side of the line that is all one ore is outlined and lit with the points it would pay. The other side, which mixes ores, is dimmed.",
            caption: "A cut lined up by one tap. The lit side would be banked for the number on it. The dim side would stay on the table.",
          },
        },
        {
          title: "Big before small",
          body: `Size is squared, so a piece of ${c.width} cells pays ${v(c.width)} and one of ${2 * c.width} pays ${v(2 * c.width)}. With only a few cuts, each one should free the biggest rectangle it can. Do not trim a big block down to make a neat small one.`,
        },
      ],
      drill: `Before every cut, say what it will bank, then line it up and read the number. You are there when your number is right, the bar passes its notch on most slabs, and a round passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Plan the whole slab before the first cut, because the first cut decides it.",
      tips: [
        {
          title: "The first cut crosses everything",
          body: "On a fresh slab the piece is the whole slab, so the first cut goes through every block on its line. In bot rounds only about two of the ten first cuts keep the slab's best in reach. The cut that banks most at once is one of them about half the time.",
          media: {
            kind: "still",
            name: "through",
            alt: "A fresh slab with a cut lined up along its bottom row. The row is one ore and lit with its points, but the line runs through the middle of the biggest block on the slab.",
            caption: "Tempting: it banks a row now. It also runs through the biggest block, which was worth far more whole.",
          },
        },
        {
          title: "Start from the biggest block",
          body: "The best plan banks the slab's biggest pure rectangle whole on almost every slab. Find it first and never cut through it. A bot that looks one cut ahead has a third fewer rough slabs once it is given that one rule.",
        },
        {
          title: "The cut that banks nothing",
          body: "Look for a **seam**: a line that crosses the whole piece along the edges of the blocks you want. Cutting it may light nothing up. But now each half is its own piece, and a cut in one no longer runs through the other. On busy slabs the right first cut banks nothing more often than not.",
          media: {
            kind: "clip",
            name: "setup",
            alt: "The same slab. The first cut is made along a seam near the top and banks nothing. The second banks a full row. The third frees the biggest block whole for a large score, and the bar fills to the slab's best.",
            caption: "The same slab, three cuts. The first banks nothing and sets up the other two. The big block comes away whole.",
          },
        },
        {
          title: "Count what a block costs",
          body: "A block in the corner of its piece takes two cuts to free. One on an edge takes three, and one in the middle takes four. One that spans the piece from side to side takes one or two. Count the big blocks against the lamps before you start.",
        },
      ],
      drill: `Do not touch a new slab until you can name every cut you will make. In practice rounds, wait a few seconds and a cut from a best plan pulses: check your first cut against it. You are there when a round passes ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Choose the scrap on purpose, and know the plan is flawless before the torch is lit.",
      tips: [
        {
          title: "Decide what to give up",
          body: `There is always a cut too few, so the best plan leaves scrap on almost every slab: about a fifth of a first slab and more than a quarter of a busy one. Give up what is small. Two cells pay ${v(2)}, and a best plan almost never spends a cut to bank a piece that size.`,
          media: {
            kind: "clip",
            name: "budget",
            alt: "A busy slab with seven blocks and two flaws, and four cuts. A seam is cut down the middle, then three blocks are banked whole one after another. Two mixed pieces are left on the table as scrap and the bar is full.",
            caption: "Four cuts on a busy slab. Three blocks are banked whole. The pieces with the flaws in them are left as scrap, and the slab is still flawless.",
          },
        },
        {
          title: "Go round a flaw",
          body: `Cutting a flaw out of a block takes cuts you do not have. Bank the biggest pure rectangle beside it. A flaw on the edge of a block of ${4 * 4} still leaves a rectangle of ${3 * 4} for ${v(3 * 4)}. The strip with the flaw in it is scrap.`,
        },
        {
          title: "One line, two blocks",
          body: "Where two wanted blocks share an edge, one cut is a side of both. Where their edges line up across the piece, one cut trims both at once. These shared lines are how a plan fits the budget. Look for them before you count a block as too dear.",
        },
        {
          title: "Add it up against the strip",
          body: "The strip shows the slab's best from the start. Square each piece of your plan and add them up. If the sum is the best, cut. If it is short, there is a better plan on the table, and you know it before a cut is spent.",
        },
      ],
      drill: `On every slab, say which blocks you will scrap before the first cut, and add your plan up against the best. You are there when most slabs are flawless, none is rough, and a round passes ${p.thresholds[4]!.score} points.`,
    },
    {
      level: "expert",
      goal: `Hold the streak at ×${streakMax} and cut more slabs: the bonus is now as big as the slab.`,
      tips: [
        {
          title: "The bonus is the round",
          body: `At full streak a flawless slab pays ${flawlessTop} on top, about what a busy slab banks in all. A clean one pays ${cleanTop}. For a bot on the best plan the bonuses are two fifths of the round. The streak is full on the ${ordinal(streakFull)} slab, so the easy early slabs are where it is built.`,
        },
        {
          title: "Never rough",
          body: `A rough slab at full streak pays no bonus, and the next ${streakFull - 1} climb back from the start. Between flawless slabs that costs ${roughCost} points. When you cannot find the flawless plan, take the one you are sure passes the notch on the bar.`,
        },
        {
          title: "Pace is score",
          body: "Moves are not timed but the round is, and a bot on the best plan scores in step with the slabs it finishes. A flawless slab at full streak is worth about half as much again as a clean one. So it is worth about half as long again of looking, and no more.",
          media: {
            kind: "clip",
            name: "streak",
            alt: "A slab cut in three quick swipes, each banking a piece, the second a large block. The bar fills, the board calls out Flawless with its bonus and shows Streak x2.",
            caption: `Three swipes, no taps. A second flawless slab in a row pays ${bonusAt(c.flawlessBonus, 2)} in place of ${c.flawlessBonus}.`,
          },
        },
        {
          title: "Swipe the plan",
          body: "Two taps are for checking a cut. Once the plan is whole in your head, swipe each cut in one stroke and do not wait for the pieces to fly: a new swipe finishes the animation. Plan with your eyes, then cut without stopping.",
        },
      ],
      drill: `Play rounds where every slab is planned in full and then cut in one burst. Watch the result for rough slabs: the target is none. You are there when a round passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    "**Taking the cut that banks now.** The first cut of a best plan often banks nothing. Find the biggest block and the seam beside it before you look at what lights up.",
    "**Cutting through the big block.** A small piece banked today is paid for with the block it split. Halves of a block pay half of what it paid whole.",
    `**Spending a cut on a flaw.** A single cell pays ${v(1)}. Go round it and let the strip it sits in be scrap.`,
    "**Tapping Next slab below the notch.** A slab given up is graded as it stands. Under the notch it is rough, and the streak goes with it.",
    "**Cutting while still looking.** Every cut narrows what is left. Finish the plan first: the round's clock allows it, and the slab cannot be put back.",
  ],
};

function ordinal(n: number): string {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
}
