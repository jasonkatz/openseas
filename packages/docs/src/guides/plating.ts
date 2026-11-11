import { PENTOMINOES } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.plating;
const c = p.config;
const m = content.messages;
type Rating = keyof typeof c.multiplierPercent;
const label = (r: Rating): string => m[`plating.rating.${r}`]!;
const times = (percent: number): string => `×${percent / 100}`;
/** What sealing a breach of `cells` cells pays at a rating, before brushing and streak. */
const pays = (cells: number, r: Rating): number => (cells * c.basePerCell * c.multiplierPercent[r]) / 100;
/** Cells in a plate: every one is a pentomino. */
const PLATE = PENTOMINOES[0]!.length;
const two = 2 * PLATE;
const three = 3 * PLATE;
const brushed = 1 + c.brushBonusPercent / 100;
const streak = c.streakPercent;
const streakCap = streak[streak.length - 1]!;
const word = (n: number): string => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
const ordinal = (n: number): string => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n] ?? `${n}th`;
const perPlate = (n: number): string => String(Math.round(n));

export const plating: Guide = {
  id: "plating",
  tagline: "Lay five-cell plates over hull breaches. Fewer plates and no waste pay the most.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Plating board: a riveted hull ${c.width} cells wide with three dark breaches open onto space, and a tray of three five-cell metal plates under it.`,
    caption: "Three breaches, three plates in the tray. Every plate covers five cells.",
  },
  theme: {
    setting:
      "The hull has been holed and you are the pirate with the welder. Plates come up from the stores three at a time, cut in whatever shapes were lying about. You turn them, flip them and weld them over each **breach** until no open space shows.",
    purpose:
      "A damaged ship flies slow. Every turn, the points you made here repair hull damage, so the ship keeps its speed in a fight and on the way home. No other station mends the hull.",
  },
  facts: [
    { label: "Board", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.parScore} points` },
  ],
  rules: [
    `Three plates wait in the **tray**. Each covers ${PLATE} cells. Weld one down and a new plate takes its slot.`,
    "A plate goes anywhere it covers at least one open cell of a breach. You can turn it and flip it first.",
    "Cells that land on sound hull, on another plate or off the board are **waste**. The plate shows them hatched red before you weld.",
    "Cover every cell of a breach and it is **sealed**: it scores, its plates lift away and a new breach opens somewhere else.",
    `Up to ${c.breachesAtOnce} breaches are open at once. A breach left alone while ${c.growAfterMoves} plates go elsewhere **widens** by one cell.`,
    `The round is ${p.roundSeconds} seconds on the clock. There is no undo and no way to throw a plate away.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-plate",
    alt: "A plate is taken from the tray, carried over a breach of the same shape, turned a quarter and welded down. The breach seals and the board calls out Flawless.",
    caption: "Pick a plate, turn it, weld it. One plate that fills a breach exactly is a Flawless.",
  },
  controls: [
    { action: "Pick a plate", touch: "Drag it out of the tray", desktop: "Click it in the tray, or press 1, 2 or 3" },
    { action: "Carry it", touch: "Drag it and let go over the hull to set it down. Tap bare hull to bring it there", desktop: "Move the mouse over the hull, or use the arrow keys" },
    { action: "Turn it", touch: "The two turn buttons under the plate", desktop: "Right click or scroll, or R and Q" },
    { action: "Flip it", touch: "The flip button under the plate", desktop: "F" },
    { action: "Weld it down", touch: "The welder button under the plate", desktop: "Click, or Enter or Space" },
    { action: "Put it back", touch: "Drag it off the hull", desktop: "Escape" },
    { action: "Jump to the spot with the least waste", touch: "", desktop: "H" },
  ],
  scoring: [
    `A seal pays ${c.basePerCell} points a cell, times its **rating**. The rating counts plates over the fewest that could do it, one for every ${PLATE} cells.`,
    `None over and no waste is ${label("flawless")}, ${times(c.multiplierPercent.flawless)}. None over with waste, or one over, is ${label("solid")}, ${times(c.multiplierPercent.solid)}. Two over is ${times(c.multiplierPercent.holds)}, three ${times(c.multiplierPercent.tape)}, more ${times(c.multiplierPercent.gum)}.`,
    `If every plate on the breach is **brushed across**, its lines running side to side, the seal pays ${c.brushBonusPercent}% more.`,
    `${label("flawless")} seals in a row build a **streak**: ${streak.map(times).join(", ")}, and ${times(streakCap)} from the ${ordinal(streak.length)} on. Any lesser seal ends it.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Seal each breach with as few plates as you can.",
      tips: [
        {
          title: "Read the plate before you weld",
          body: "While you carry a plate it shows what it will do. A green edge means it will go down, and the breach it will join lights up. Red hatching is waste. Slide it a cell or turn it until the red is gone or as small as you can make it.",
          media: {
            kind: "still",
            name: "waste",
            alt: "A plate held half over a breach: three of its cells sit in the breach and two, hatched red, lie on sound hull.",
            caption: "Three cells in the breach, two hatched red on sound hull. That is waste.",
          },
        },
        {
          title: "Count plates, not cells",
          body: `A ${two}-cell breach wants two plates. Sealed with two it pays ${pays(two, "flawless")}. With three it pays ${pays(two, "solid")}, with four ${pays(two, "holds")}, with five ${pays(two, "tape")}. Every plate you add costs time and takes points away.`,
        },
        {
          title: "Take big bites",
          body: "A good plate covers four or five open cells. One that covers a single cell has spent a whole plate of the rating on almost nothing. Try every turn and the flip before you settle for a small bite: a plate can lie up to eight ways.",
        },
      ],
      drill: `Play a round where no plate goes down covering fewer than four open cells, unless it seals the breach. You are there when a round finishes above ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Take the brushing bonus on every seal, and know how many plates you can spend.",
      tips: [
        {
          title: "Lay every plate across",
          body: `The brushing bonus is on any seal, ${label("flawless")} or not. A quarter turn swaps a plate's lines between across and up and down. A flip does not change them. When two ways cover the same cells, take the one that lies across. That habit alone is worth about a fifth more points over a round.`,
          media: {
            kind: "clip",
            name: "solid-brushed",
            alt: "Two plates, both with their lines running across, are welded over a five-cell breach with some waste. The board calls out Solid work and Brushed true.",
            caption: `One plate over, so ${label("solid")}. Both brushed across, so ${pays(PLATE, "solid")} becomes ${Math.round(pays(PLATE, "solid") * brushed)}.`,
          },
        },
        {
          title: "Waste only costs you the Flawless",
          body: `Once a breach has any waste on it, more waste costs nothing. Hang plates over the hull, over each other or off the edge of the board as it suits. The rating from here is only the plate count.`,
        },
        {
          title: "You have one spare plate",
          body: `${label("solid")} is the fewest plates with waste, or one plate over. So on a breach that cannot be ${label("flawless")} any more, one extra plate is free. Spend it to make the fit easy. The second extra is the one that hurts: ${times(c.multiplierPercent.solid)} falls to ${times(c.multiplierPercent.holds)}.`,
        },
        {
          title: "Leave a gap one plate can close",
          body: "Keep the open cells of a breach in one clump as you fill it. Five cells in a clump close with one plate. Five cells in three corners need three, and that is two ratings gone.",
        },
      ],
      drill: `Play a round where every plate goes down lying across. You are there when Brushed true shows on most of your seals and a round passes ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Seal flawlessly on purpose, and give the plates that do not fit a home.",
      tips: [
        {
          title: "Find the whole seal in the tray",
          body: `A ${label("flawless")} pays ${perPlate(pays(two, "flawless") / 2)} points a plate. A ${two}-cell breach sealed with three plates pays about ${perPlate(pays(two, "solid") / 3)} a plate. Before the first plate touches a fresh breach, look for the plates in the tray that fill it exactly between them. If they are there, the ${label("flawless")} is certain.`,
          media: {
            kind: "clip",
            name: "pair",
            alt: "Two plates from the tray are turned and welded into a ten-cell breach. They fill it exactly, with no red hatching, and the board calls out Flawless.",
            caption: `Both plates were in the tray before the first went down. ${two} cells, two plates, ${pays(two, "flawless")} points.`,
          },
        },
        {
          title: "Leave a hole shaped like a plate",
          body: `When only one plate fits clean, lay it so the ${PLATE} cells left over are one plate's shape, not an awkward scatter. Now a single shape finishes the ${label("flawless")}, and there are ${p.shapes.length} shapes, so each new plate dealt is a 1 in ${p.shapes.length} chance.`,
        },
        {
          title: "Keep a scrap breach",
          body: `You cannot throw a plate away, so a plate that fits nothing clean must go somewhere. Put it on a breach that already has waste or has widened, covering as many open cells as it can. Never on the breach you are filling clean. Played this way a round scores about two fifths more than simply covering the most cells every time.`,
        },
      ],
      drill: `Before the first plate on each fresh breach, name the plates that would seal it flawlessly. You are there when one seal in four is ${label("flawless")} and a round passes ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Put your flawless seals back to back, and keep every breach's count in your head.",
      tips: [
        {
          title: "Order the seals you have ready",
          body: `The streak counts ${label("flawless")} seals with no lesser seal between them. If a scrap breach is one plate from sealing, close it before a run starts, not in the middle of one. The second ${label("flawless")} in a row pays ${times(streak[1]!)}, the third ${times(streak[2]!)}. Do not stall for it: laying thin plates to keep a streak alive costs more than the streak pays.`,
          media: {
            kind: "clip",
            name: "streak",
            alt: "With two flawless seals already made, a third breach is filled exactly and the board calls out Flawless and three flawless in a row.",
            caption: `The third ${label("flawless")} in a row, worth ${times(streak[2]!)}.`,
          },
        },
        {
          title: `Count to ${word(c.growAfterMoves)}`,
          body: `Each breach counts the plates laid elsewhere since you last touched it. At ${c.growAfterMoves} it widens, and a widened breach can never be ${label("flawless")}. An amber rim means two plates left. A red rim means the next plate laid elsewhere widens it. So a clean breach waiting for its shape can wait through ${c.growAfterMoves - 1} plates, and any plate laid on it starts the count again.`,
          media: {
            kind: "clip",
            name: "widen",
            alt: "One breach pulses with a red rim. A plate is welded onto a different breach, the board calls out A breach widened and the red-rimmed breach gains a cell.",
            caption: "The red rim was the warning. One more plate elsewhere and the breach widens.",
          },
        },
        {
          title: "A widened breach is not ruined",
          body: `It is one cell bigger, and bigger pays more. The extra cell can also raise the plate count the rating allows: ${two + 1} cells need three plates, so four are still ${label("solid")}, where four on ${two} cells are only ${label("holds")}. Guard the clean breaches. Let the scrap breach widen.`,
        },
        {
          title: "V, W and X plates brush either way",
          body: "Most plates show one brushing for each way they can lie. These three do not. An X plate looks the same after a quarter turn, and a V or a W covers the same cells after a turn and a flip. Whatever cells they cover, they can cover them brushed across.",
        },
      ],
      drill: `Call the streak count out loud before every seal, and call each breach's count when its rim turns amber. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Nibbling.** A plate that covers one or two open cells still counts as a whole plate against the rating.",
    "**Fearing waste on a spoiled breach.** After the first wasted cell, waste is free. Plates are not.",
    "**Ignoring the brushing.** One plate lying up and down takes the bonus off the whole breach.",
    "**Dumping a misfit on a clean breach.** It was your next Flawless. The scrap breach is there for that.",
    `**Starving a clean breach.** ${word(c.growAfterMoves).replace(/^./, (ch) => ch.toUpperCase())} plates elsewhere and it widens. Watch for the amber rim.`,
  ],
};
