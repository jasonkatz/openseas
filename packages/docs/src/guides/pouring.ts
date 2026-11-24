import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.pouring;
const c = p.config;
/** k lines served by one pour, on a rung square and on a clean one. */
const lines = (k: number): number => c.linePoints * k * k;
const clean = (k: number): number => Math.floor((lines(k) * c.cleanPercent) / 100);
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
const times = (percent: number): string => `×${percent / 100}`;
const stage = (id: string) => p.stages.find((s) => s.id === id)!;

export const pouring: Guide = {
  id: "pouring",
  tagline: "Take turns with rivals setting drinks down on one bar. Fill a row or a column to serve it.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Pouring bar: a ${c.size} by ${c.size} grid with a few drinks standing on it, each a glass outline with a mark cut into it, and a ring round each square where a pirate first set a drink: a solid amber circle for yours, broken circles for the rivals'. The rivals' hands sit over the bar, and your ${word(c.offer)} drinks under it, the picked one framed in amber.`,
    caption: "A few turns in. Every pirate has rung some squares; nobody has served a line yet.",
  },
  theme: {
    setting:
      "A dockside bar at the edge of the reach, one long top and a few pirates around it. Everyone takes a turn setting a drink down, and a drink only goes where it suits the drinks beside it. Fill a row or a column and you **serve** it, and the bar is cleared for the next round of drinks.",
    purpose:
      "Pouring is a prototype, a successor to the original's tavern puzzle, Drinking. It is on no ship yet. It tries out a puzzle played against other pirates in turn, where the board you leave is the board the next pirate plays.",
  },
  facts: [
    { label: "Bar", value: `${c.size} by ${c.size}` },
    { label: "Round", value: `${c.lastCall} turns each` },
    { label: "Rated against", value: "The puzzle, with rivals at the bar" },
    { label: "Rivals", value: `${c.rivals}` },
  ],
  rules: [
    `Every drink is a **glass** and a **brew**. There are ${word(c.glasses)} glasses, each its own outline, and ${word(c.brews)} brews, each its own colour and the mark cut into the glass.`,
    "A drink may be set down on an empty square only where it **suits every drink beside it**, up, down, left and right: each one must share its glass or its brew. Diagonals do not count.",
    `You hold ${word(c.offer)} drinks. On your turn, pour one, or **down one** instead. Your rivals take their turns after yours, one after another, and you see their hands.`,
    "Fill a row or a column and you **serve** it: it scores, and every drink in it is taken off the bar. Whoever fills it serves it, you or a rival.",
    "A drink leaves its pirate's **ring** on its square for good. A square with no ring is **clean**.",
    `Down too many drinks without pouring between them and you are **out cold** for your next turn. With nothing in hand that fits anywhere, you must drink.`,
    `The round ends at **last call**, when every pirate has taken ${c.lastCall} turns. There is no undo.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-pour",
    alt: "The pointer picks a drink in the hand and taps a square on the empty bar. The drink slides up onto the square and an amber ring appears round it. Then each rival sets a drink down in turn, and broken rings appear round theirs.",
    caption: "Your pour, then each rival's. Every first drink on a square leaves its pirate's ring.",
  },
  controls: [
    { action: "Pick a drink", touch: "Tap it in your hand", desktop: "Click it, or press 1, 2 or 3" },
    { action: "Pour it", touch: "Tap a square. The squares it suits are marked", desktop: "Click a square, or move the cursor with the arrow keys or WASD and press Space or Enter" },
    { action: "Down it instead", touch: "Tap the picked drink again", desktop: "The same, or press X" },
  ],
  scoring: [
    `**Every drink scores ${c.pourPoints}**, poured or downed${c.agePoints > 0 ? `, and ${c.agePoints} more for each turn it has waited in your hand, up to ${word(c.ageMax)} turns` : ""}. Its value is under it in your hand.`,
    `**The first ring on a clean square scores ${c.ringPoints}.**`,
    `**A line served scores ${lines(1)}**, and ${clean(1)} when the pour that serves it lands on a clean square (${times(c.cleanPercent)}).`,
    `**Lines served by one pour count together:** a row and a column at once are ${lines(2)}, or ${clean(2)} on a clean square. That is the **clean double**, the most one pour can score.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Set every drink where it suits, and serve the lines you can.",
      tips: [
        {
          title: "Look for the marked squares",
          body: "The squares your picked drink suits carry a cream dot. If your first drink suits nowhere useful, pick the other one: the dots change.",
        },
        {
          title: "Shared glass or shared brew",
          body: "A drink beside a tumbler can be any tumbler, or any glass of the same brew. Squares with three or four neighbours are hard to fill, so fill a line's squares before its neighbours close in on them.",
        },
        {
          title: "A full line is yours if you fill it",
          body: `A line serves for whoever sets down its last drink. ${lines(1)} is worth many drinks, so when a line is one short and you hold a drink that suits the gap, take it.`,
        },
      ],
      drill: `Play the Lines stage and serve at least two lines a round. You are there when a round finishes above ${stage("lines").thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Stop handing lines to the rival after you.",
      tips: [
        {
          title: "One short is an invitation",
          body: "Leave a line one drink short and the next pirate serves it if anything in their hand suits the gap. Their hand is on show over the bar: read it before you pour.",
          media: {
            kind: "clip",
            name: "steal",
            alt: "The player sets a drink down that leaves a row one square short. The next rival sets a drink into the gap, the row is served for them, and its drinks shrink away.",
            caption: "One short, and the rival after you had a drink that suited the gap.",
          },
        },
        {
          title: "Two short is safe",
          body: "A line two short cannot be served by the next pirate. Bring your lines to two short, then wait for the turn you can take the last two yourself, or for a pour that fills the last one.",
        },
        {
          title: "Downing a drink is a pass",
          body: `A drink downed puts nothing on the bar, so it gives nothing away. When every pour you have would hand a line over, down one. Mind the count: ${word(c.tolerance)} without pours between and you lose a turn.`,
        },
      ],
      drill: "Play rounds where no rival ever serves a line you left one short. Watch their hands before each pour.",
    },
    {
      level: "advanced",
      goal: "Serve your lines on clean squares.",
      tips: [
        {
          title: "Save a clean square for the last drink",
          body: `A line served by a pour onto a clean square scores ${clean(1)} instead of ${lines(1)}. Fill a line's rung squares first and keep one clean square for the drink that serves it.`,
          media: {
            kind: "clip",
            name: "serve",
            alt: "The player sets the last drink of a row down on a square with no ring. The row is served, its drinks shrink away, and the points rise over the square.",
            caption: `The last drink on a clean square: the line is worth ${clean(1)}.`,
          },
        },
        {
          title: "Clean squares run out",
          body: "Every pour rings a square for good, so the bar grows rung as the round goes on. A clean square in the middle of a line is worth more than the ring it scores today.",
        },
        {
          title: "Choose the square a gap needs",
          body: "The last gap of a line is easiest to fill when its neighbours share a glass or a brew. Set those neighbours down so the gap wants a drink you hold, and not one a rival holds.",
        },
      ],
      drill: `Play the Clean squares stage and serve every line on a clean square. You are there when a round finishes above ${stage("clean").thresholds[2]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Set up the clean double: a row and a column served by one pour.",
      tips: [
        {
          title: "Build a cross round one clean square",
          body: `Fill a row and a column that cross, both to one short, with their crossing square clean and empty. One drink there serves both for ${clean(2)}: more than four lines served one at a time on rung squares.`,
        },
        {
          title: "Keep it two short until it is yours",
          body: "A cross one short is a gift if the next rival holds a drink that suits the crossing square. Keep one of its lines two short until your hand holds the drink, then close it and serve both next turn, or both at once.",
        },
        {
          title: "Rags and ice change the gaps",
          body: "Ice suits any square and anything suits ice, so it closes a gap nothing else will. A rag wipes a drink off the bar: use it to open a line a rival was about to serve, or to clear the one square that kept your cross from closing.",
        },
      ],
      drill: `Play rounds where you serve a double at least once. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Leaving a line one short.** The pirate after you serves it if their hand suits the gap.",
    "**Pouring on clean squares just for the ring.** A clean square is worth most as the last drink of a line.",
    "**Downing drinks for their value.** A drink downed scores its value once, and the count it adds can cost you a turn. Drink to pass, not to score.",
    "**Closing a gap so tight nothing suits it.** A line with a gap that no drink suits cannot be served by anyone, you included, until a rag or ice opens it.",
  ],
};
