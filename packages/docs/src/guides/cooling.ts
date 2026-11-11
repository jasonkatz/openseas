import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.cooling;
const c = p.config;
const streakMax = c.streakMaxPercent / 100;
/** Scoring moves in a row before the streak stops growing. */
const streakFull = (c.streakMaxPercent - 100) / c.streakStepPercent + 1;
/** What k slag are worth coming off together: the engine's 15 a piece, times k for the group count. */
const slag = (k: number): number => 15 * k * k;
const run = (n: number): number => n * (n - 2);
const lastCascade = c.cascadeMultipliers[c.cascadeMultipliers.length - 1]!;

export const cooling: Guide = {
  id: "cooling",
  tagline: "Swap pieces side by side, clear runs of three, and plan one swap that clears two.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Cooling board: six columns of cogs, valves, bolts, fuses, crystals, coils and chips, with the bottom three rows glowing orange under the heat line.",
    caption: "The heat sinks. The orange rows at the bottom are overheated.",
  },
  theme: {
    setting:
      "The ship's heat sinks are clogged with spare parts. You are the pirate at the vent lever, shaking parts loose so the heat has somewhere to go. Under the glowing **heat line** the metal is too hot to handle quickly.",
    purpose:
      "A ship that runs hot flies slow. Every turn, the points you made here vent the ship's heat, so the engines' work turns into real speed. Nobody else aboard can do that job.",
  },
  facts: [
    { label: "Board", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.parScore} points` },
  ],
  rules: [
    "Swap any two pieces that sit **side by side**. Swaps are always sideways, never up and down.",
    "Three or more of a kind in a line, across or down, clear.",
    "The pieces **below** a gap rise to fill it, and new pieces come in at the bottom. A rise can line up new runs: that is a **cascade**.",
    "A swap that clears nothing is allowed. It is how you set up a bigger one.",
    `Below the heat line a swap is slow: the board waits about half a second before it takes another.`,
    `The round is ${p.roundSeconds} seconds on the clock. There is no move limit and no undo.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-match",
    alt: "A piece is dragged one cell sideways, completes a line of three, the three clear and the pieces below rise.",
    caption: "Drag a piece sideways. Three in a line clear, and the board rises from below.",
  },
  controls: [
    { action: "Swap a pair", touch: "Drag a piece onto its neighbour, or tap one and then the other", desktop: "Click the left piece of the pair, or drag" },
    { action: "See what a swap clears", touch: "Hold a finger on a piece", desktop: "Hover over the pair" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys" },
    { action: "Swap at the cursor", touch: "", desktop: "Space or Enter swaps with the piece to the right" },
  ],
  scoring: [
    `**Longer runs pay much more.** A run of 3 is ${run(3)} points, 4 is ${run(4)}, 5 is ${run(5)}, 6 is ${run(6)}.`,
    "**Two runs from one swap double the lot**, three triple it. This is the multiplier you control.",
    `Each step of a cascade multiplies too: ${c.cascadeMultipliers.map((m) => `×${m}`).join(", ")}, and ×${lastCascade} after that.`,
    `Scoring swaps in a row build a **streak**: +${c.streakStepPercent}% each, up to ×${streakMax}. One empty swap keeps it. Two in a row lose it.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Find a match quickly, every time, and keep your hands off the hot rows.",
      tips: [
        {
          title: "Look for two with a gap",
          body: "Every match starts as two of a kind in a line with a third one a single sideways step away. Scan for pairs, then look left and right of the empty end for the third. Vertical pairs count: the third piece can slide in from either side.",
        },
        {
          title: "Work above the heat line",
          body: `Swaps in the orange rows are slow, and the clock does not wait. On a cool ship that leaves ${c.height - c.minHeatRow} rows to work in. Play there unless the hot rows hold something special.`,
        },
        {
          title: "Know the three specials",
          body: "A **Spark Charge** clears the 3 by 3 block around where it lands when you swap it. A **Magnet** clears every piece of the kind you swap it with. **Slag** cannot be matched at all: it leaves by itself once it rides above the heat line.",
          media: {
            kind: "clip",
            name: "charge",
            alt: "A Spark Charge is swapped sideways and blows a three by three hole in the board.",
            caption: "A Spark Charge: swap it and the 3 by 3 around it goes.",
          },
        },
      ],
      drill: `Play a round where you never stop to think for more than two seconds. Any match will do. You are there when a round finishes above ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Stop taking threes. Make every swap either a long run or two runs at once.",
      tips: [
        {
          title: "One swap, two runs",
          body: `A swap moves two pieces. If each one finishes a run of its own, you clear two groups in one step and the points double. Two plain threes are ${run(3)} + ${run(3)} = ${2 * run(3)}, doubled to ${4 * run(3)}: the same as four separate threes.`,
          media: {
            kind: "clip",
            name: "double",
            alt: "One sideways swap completes a run on the left piece and a run on the right piece at once, and the board calls out Double.",
            caption: "Both halves of the swap finish a run. The board calls it a Double.",
          },
        },
        {
          title: "Prefer four and five",
          body: `A run of 4 is worth nearly three threes, and a run of 5 is worth five. When you see a three, check whether one more swap first would make it a four. That extra swap scores nothing, and the streak forgives one of those.`,
        },
        {
          title: "Keep the streak alive",
          body: `From the ${["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][streakFull] ?? `${streakFull}th`} scoring swap in a row, everything you make is worth ×${streakMax}. You may spend **one** empty swap on a setup. If the setup needs two, take a cheap three in between.`,
        },
      ],
      drill: "Before each swap, hold or hover to see what it clears, and only take it if it clears four or more pieces. You are there when Doubles stop being a surprise.",
    },
    {
      level: "advanced",
      goal: "Read how the board will rise, and aim your specials.",
      tips: [
        {
          title: "Plan the rise, not just the clear",
          body: "When a run clears, only the pieces **under** it move, and they move straight up. A run lying across lifts three columns by one row. A run standing up lifts one column by three. Look at what sits under your match and one row to the side of where it will arrive: that is your next match, already made.",
          media: {
            kind: "clip",
            name: "cascade",
            alt: "One swap clears a run, the columns below rise and form a second run, which clears and forms a third.",
            caption: "One swap, three steps. Each step multiplies: the third is worth ×3.",
          },
        },
        {
          title: "Feed the Magnet",
          body: "A Magnet takes every piece of one kind. Count before you swap it: use it on the kind the board holds most of. It also leaves holes all over the board, so the rise that follows often cascades.",
          media: {
            kind: "clip",
            name: "magnet",
            alt: "A Magnet is swapped with a cog and every cog on the board is pulled off at once.",
            caption: "The Magnet swapped with a cog: every cog goes.",
          },
        },
        {
          title: "Place the Spark Charge",
          body: "A charge clears around where it **lands**, so you choose the spot by choosing which way to swap it. Use it to cut out the clutter between two halves of a big run, or to drop a slag piece's column a long way at once.",
        },
      ],
      drill: "Before you clear a run, say out loud what the rise will line up. Check whether you were right. You are there when half your swaps chain at least once.",
    },
    {
      level: "expert",
      goal: "Bank slag, lift it together, and never let the streak drop.",
      tips: [
        {
          title: "Slag is the biggest prize on the board",
          body: `One slag piece coming off is worth ${slag(1)}. Two coming off **together** are worth ${slag(2)}, three ${slag(3)}. They leave the moment they rise to the heat line, so the skill is to stop them leaving one at a time.`,
          media: {
            kind: "still",
            name: "slag-before",
            alt: "Two slag pieces sit side by side in the overheated rows, one clear below the heat line.",
            caption: "Two slag pieces waiting under the line. Do not lift either alone.",
          },
        },
        {
          title: "Line them up, then lift once",
          body: "Slag rises only when something **above it in its own column** clears. Leave those columns alone until two or three slag pieces sit one row under the line. Then clear a single run lying across all of their columns, just above them. They cross the line in the same step and pay together.",
          media: {
            kind: "clip",
            name: "slag-pair",
            alt: "A run is cleared across two columns that hold slag; both slag pieces rise over the heat line and come off in the same step.",
            caption: `One run above both columns. Two slag come off together for ${slag(2)}.`,
          },
        },
        {
          title: "Play at full streak",
          body: `At ×${streakMax} a two-slag lift is ${Math.floor(slag(2) * streakMax)} and a double of fours is ${Math.floor(run(4) * 4 * streakMax)}. Set your big moves up while the streak is full, and keep a cheap three in sight as a spare so a setup never costs you the multiplier.`,
        },
        {
          title: "Stay cool where it counts",
          body: "Slag setups live in the slow rows. Do the thinking while a slow swap lands, and spend your fast swaps in the cool rows. A ship that is already hot has a higher line: more slow rows, but slag reaches the line sooner.",
        },
      ],
      drill: `Play rounds where no slag piece is allowed to leave alone. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Taking every three you see.** Threes are the smallest thing on the board. Take one to keep a streak, not as a plan.",
    "**Two empty swaps in a row.** The second one throws the streak away. Score something small between setups.",
    "**Clearing above a lone slag piece.** It comes off for the least it can be worth and the chance to pair it is gone.",
    "**Fighting in the hot rows.** Slow swaps there cost seconds you cannot get back.",
    "**Spending a Magnet on a rare kind.** Count first.",
  ],
};
