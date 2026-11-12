import { content, t } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.swordfight;
const c = p.config;
const raider = c.foes[0]!;
const seconds = (ticks: number): number => Math.round((ticks * c.tickMs) / 100) / 10;
const nth = (n: number): string => ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] ?? `${n}th`;
const words = (n: number): string => ["none", "one", "two", "three", "four", "five", "six"][n] ?? String(n);

/** What a slab of n blocks is worth when it shatters. */
const slab = (n: number): number => c.cellPoints * n + (c.slabBonus * n * (n - 1)) / 2;
/** Blocks of scrap those points make. */
const scrap = (points: number): number => Math.floor(points / c.attackPoints);
/** The column pairs come in down, counted from the left. */
const entryCol = Math.floor((c.width - 1) / 2) + 1;
/** A pair left alone falls a row in this long, and reaches an empty floor in this long. */
const rowSeconds = seconds(c.fallTicks);
const floorSeconds = Math.round((c.fallTicks * c.tickMs * c.height) / 1000);
const landSeconds = seconds(c.landAfterTicks);
/** The raider's blade, and how much of its scrap comes down the entry column. */
const raiderBlade = c.blades[raider.blade]!;
const entryShare = Math.round(raiderBlade.columns.length / raiderBlade.columns.filter((col) => col === entryCol - 1).length);
/** A block in a pair is a breaker about one time in this many. */
const breakerOneIn = Math.round(1000 / c.breakerPermille);
/** A win's attack a minute at a threshold: the score less the win band. */
const winRate = (i: number): number => p.thresholds[i]!.score - c.winPoints;

export const swordfight: Guide = {
  id: "swordfight",
  tagline: "Stack falling pairs into slabs, shatter them, and bury the raider in scrap.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Swordfighting board: a tall well six blocks wide with crimson, gold, cobalt and lime blocks stacked at the bottom, a fused slab, a breaker with a blade on it, grey scrap showing the colors it will turn, the next pair above the well and the raider's small board to the right.",
    caption: "Your board, the next pair above it, and the raider's board beside it. The outlined cell at the top is the entry.",
  },
  theme: {
    setting:
      "Two ships are locked together at the airlock and the crews are at each other with blades. Your board is your own duel. Every block you shatter is a blow, and it lands on the other side as **scrap**: dead metal that clogs their board.",
    purpose: `The boarding fight decides the plunder. Whoever boarded, the crew that holds the airlock takes the purse, and a crew that loses gets nothing. Every pirate fights on a board of their own, dealt the same pairs as the rest of the crew. Your share of the purse grows with your attack a minute: ${p.parRatePerMinute} counts as a full turn of duty.`,
  },
  facts: [
    { label: "Board", value: `${c.width} wide, ${c.height} tall` },
    { label: "Fight", value: `Up to ${p.roundSeconds} seconds` },
    { label: "Rated on", value: "Winning, then attack a minute" },
    { label: "A solid fight", value: `A win at ${winRate(2)} attack a minute` },
  ],
  rules: [
    `Pairs of blocks fall from the **entry**, the top of the ${nth(entryCol)} column. Steer and turn the pair. When it lands, each half drops to the top of its own column.`,
    "Four blocks of one color in a two by two square fuse into a **slab**. A slab grows a whole row or a whole column at a time.",
    "A **breaker** is a block with a blade on it. When it comes to rest touching its own color, everything of that color joined to it shatters, slabs and all. Touching nothing of its color, it waits.",
    "Whatever sat on the shattered blocks falls. If that brings a color against a waiting breaker, it shatters too: a **chain**.",
    `Shattering sends scrap to the raider, one block for every ${c.attackPoints} points. Scrap is grey and cannot be broken. After ${words(c.ripenMoves)} of that board's drops it ripens into colored blocks.`,
    "Scrap you send first cancels scrap waiting to land on you. Only what is left goes over.",
    `A board is out when its entry is covered. Cover the raider's and you win. If nobody is out after ${p.roundSeconds} seconds, nobody wins.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-break",
    alt: "A pair with a breaker is turned with a tap, dragged sideways and swiped down. The breaker lands against blocks of its own color and they shatter.",
    caption: "Tap to turn, drag to steer, swipe down to hurry. The breaker lands on its color and the group shatters.",
  },
  controls: [
    { action: "Steer the pair", touch: "Drag left or right, anywhere on the board", desktop: "Left and Right arrows, or drag" },
    { action: "Turn it", touch: "Tap: a quarter turn clockwise. Swipe up: counter-clockwise", desktop: "Up or X counter-clockwise, Down or Z clockwise. A click turns it clockwise" },
    { action: "Hurry it down", touch: "Swipe down and hold", desktop: "Hold Space" },
  ],
  scoring: [
    `A loose block is ${c.cellPoints} points. **A slab is worth more per block the bigger it is**: two by two is ${slab(4)}, two by three ${slab(6)}, three by three ${slab(9)}, three by four ${slab(12)}.`,
    "Each step of a chain multiplies by its number: the second step counts double, the third triple. Two breakers of different colors going off in the same step double that step.",
    `Your score is your **attack a minute**: every point you shattered, over the length of the fight. A fight shorter than ${c.minRateSeconds} seconds counts as ${c.minRateSeconds}.`,
    `A win adds ${c.winPoints} on top, so every win outranks every loss. Points count whether their scrap went over or cancelled what was coming.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Drop fast, keep each color together, and keep the entry clear.",
      tips: [
        {
          title: "Hurry every pair",
          body: `Left alone, a pair takes ${rowSeconds} seconds a row: about ${floorSeconds} seconds to reach an empty floor. The practice raider drops one every ${seconds(raider.thinkTicks)} seconds. Steer, turn, then swipe down and hold. Nothing else you learn pays as much as dropping twice as often as the raider.`,
        },
        {
          title: "Put like with like",
          body: `A breaker takes **everything** of its color that is joined to it. Three cobalt in a clump go with one breaker. Three cobalt scattered need three. About one block in ${breakerOneIn} is a breaker, so there are never enough to waste.`,
        },
        {
          title: "Guard the entry",
          body: `Only one cell can lose you the fight: the top of the ${nth(entryCol)} column. Build against the walls and keep that column the lowest on the board. The raider fights with the ${t(`swordfight.blade.${raiderBlade.id}`)}, and one block in ${entryShare} of its scrap comes down that very column.`,
        },
      ],
      drill: "Play a fight where no pair is ever left to fall on its own. You are there when you beat the practice raider, at any rate.",
    },
    {
      level: "intermediate",
      goal: "Stop breaking loose blocks. Build slabs and feed them to breakers.",
      tips: [
        {
          title: "A square, then strips",
          body: "Lay a pair flat on a matching pair and you have a two by two. From then on the slab only grows by a **full** side: two more of its color along a side of two, three along a side of three. A lone block against it stays loose until the strip is whole.",
          media: {
            kind: "clip",
            name: "slab",
            alt: "A pair lands beside two blocks of its color and the four fuse into one square slab. The next pair lands along the slab's side and the slab grows to six blocks.",
            caption: "Four fuse into a slab. Two more along a full side and it grows.",
          },
        },
        {
          title: "Bigger slabs hit far harder",
          body: `Twelve loose blocks shatter for ${c.cellPoints * 12} points: ${scrap(c.cellPoints * 12)} scrap. The same twelve as one three by four slab are ${slab(12)}: ${scrap(slab(12))} scrap. Everything joined to the slab goes with it, so build its color around it too.`,
          media: {
            kind: "clip",
            name: "big-break",
            alt: "A breaker is dropped against a tall slab of its color. The whole slab shatters at once and a shower of scrap flies across to the raider's board.",
            caption: "One breaker, one slab of eight. The scrap flies over and lands on the raider.",
          },
        },
        {
          title: "Park your breakers",
          body: "A breaker goes off the moment it touches its color, and another breaker of its color counts. When its slab is not ready, rest it on a different color, away from its own. It waits there, and it shatters the first block of its color you bring to it.",
        },
      ],
      drill: `Play fights where nothing is shattered that does not include a slab, unless the board is high. You are there when your wins pass ${winRate(3)} attack a minute.`,
    },
    {
      level: "advanced",
      goal: "Plan with the next pair, break in chains, and use the scrap you are sent.",
      tips: [
        {
          title: "Place two pairs at a time",
          body: "The next pair shows above the board. Before you drop the one in hand, decide where the next goes: leave the gap its strip needs, or keep a slab's side open for the breaker that follows. A bot that only added this to its play made nearly half again as many points with each drop.",
        },
        {
          title: "Stack a chain",
          body: `Park a breaker low. Lay another color over it, then a slab of the breaker's color on top of that. Shatter the color in between and the slab falls onto its breaker as step two, worth double. A two by three slab is ${slab(6)} alone and ${2 * slab(6)} on the second step.`,
          media: {
            kind: "clip",
            name: "chain",
            alt: "A breaker shatters one color. The blocks above drop, a slab comes down against a second breaker that was waiting, and it shatters as chain two.",
            caption: "The first break drops a slab onto a waiting breaker. Chain 2 counts double.",
          },
        },
        {
          title: "Scrap is blocks you have not got yet",
          body: `An attack waits over your board as a count, then lands with your next drop, or after ${landSeconds} seconds. One drop before it ripens it shows its color. ${c.scrapMatchPermille / 10}% of the time that is a color it landed beside, most often the block under it. So scrap on your slab's color mostly feeds your next break. Drop fast to ripen it.`,
          media: {
            kind: "clip",
            name: "scrap",
            alt: "A count appears over the board. With the next drop grey scrap rains onto the stacks, one drop later each piece shows a color, and one drop after that they turn into colored blocks.",
            caption: "Scrap lands grey, shows its color a drop later, and ripens into blocks.",
          },
        },
      ],
      drill: "Before each drop, say where the next pair will go. You are there when most fights show a best chain of 2 or more.",
    },
    {
      level: "expert",
      goal: "Parry attacks with breaks you held back, and keep your attack a minute high to the end.",
      tips: [
        {
          title: "Keep one break in hand",
          body: `Scrap you make cancels the count over your board before any goes over, block for block, and its points still count. So keep a slab one breaker from going off. When the count appears you have one drop, or ${landSeconds} seconds: fire then, and the attack never lands.`,
          media: {
            kind: "clip",
            name: "parry",
            alt: "A count of incoming scrap flashes over the board. A breaker is hurried down onto a slab, the slab shatters, and the count is gone with nothing landing.",
            caption: "The count shows, the held break goes off, and the attack is cancelled.",
          },
        },
        {
          title: "Two colors in one step",
          body: "Breakers of different colors that go off in the same step double it. A pair of two breakers laid flat so each half lands on its own color does it. So does a chain step that drops two colors onto two waiting breakers.",
        },
        {
          title: "Play for the rate",
          body: `It takes about a boardful of scrap to bury the raider, ${c.width * c.height} blocks, so the win comes when your points do. After the first ${c.minRateSeconds} seconds every idle second lowers your rate. Break a slab when the pair that grows it is not in sight, then start the next. Waiting for one giant slab did not score better in our trials than steady breaks of six to nine.`,
        },
      ],
      drill: `Play fights where no attack is allowed to land while a breaker sits on your board. You are there when a win passes ${winRate(5)} attack a minute.`,
    },
  ],
  mistakes: [
    "**Letting pairs fall on their own.** The fight is a race. Hurry every one.",
    `**Stacking in the ${nth(entryCol)} column.** It is the only place you can lose. Scrap lands there too.`,
    "**Firing a breaker into two or three loose blocks.** That is one block of scrap, and the breaker is gone.",
    "**Setting a breaker down beside its own color by accident.** Breakers of one color set each other off. Look at both halves before you let go.",
    "**Ignoring the count over your board.** Your next drop is the last chance to cancel it.",
  ],
};
