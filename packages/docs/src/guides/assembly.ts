import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.assembly;
const c = p.config;
/** What a fit of n parts scores at a place in the chain, with no core in it. */
const fit = (n: number, place = 1): number => c.fitPoints * (n - 2) * Math.min(place, c.chainCap);
/** What a chain of `k` fits of n parts scores in all. */
const chain = (n: number, k: number): number => Array.from({ length: k }, (_, i) => fit(n, i + 1)).reduce((a, b) => a + b, 0);
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
const stage = (id: string) => p.stages.find((s) => s.id === id)!;

export const assembly: Guide = {
  id: "assembly",
  tagline: "Move each part its own way, fit blueprints, and fit several in a row for a chain.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Assembly bay: ${c.width} columns and ${c.height} rows of parts, girders lying flat, struts standing up, cables laid corner to corner, square panels and a hex-nut core, with the tray of ${word(c.traySize)} blueprints underneath.`,
    caption: "The bay and the tray at the start of a round.",
  },
  theme: {
    setting:
      "A shipyard's parts bay. Girders, struts, cables and panels come down the line, and the tray beside you holds the blueprints for the next sections of hull. You are the fitter: get the right parts into the right shape, and the yard takes them away to build.",
    purpose:
      "Assembly is a prototype. It is on no ship yet. It tries out building in the yard: a puzzle of setting up, where the most patient fitter does the most work.",
  },
  facts: [
    { label: "Bay", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "Blueprints", value: `${c.traySize} in the tray` },
  ],
  rules: [
    "The bay is full of parts, and **each kind moves its own way**. A **girder** swaps sideways. A **strut** swaps up or down. A **cable** swaps corner to corner. Its shape shows the way.",
    "Two neighbouring parts can swap when **either one** moves that way. A **panel** has no way of its own: it moves only when a part beside it swaps with it. Two parts of one kind never swap.",
    "The tray holds the **blueprints**: shapes of three, four or five parts, each square asking for one kind. Pick one and drop it where the bay holds exactly those parts, in that shape. Blueprints never turn.",
    "The parts are **fitted** and taken away. New parts appear in the cells they left, nothing else in the bay moves, and a new blueprint takes the old one's place.",
    "A **core** never moves. In a blueprint it stands for any part.",
    `A swap scores nothing. The round is ${p.roundSeconds} seconds on the clock, with no undo.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-fit",
    alt: "A blueprint is picked from the tray and dropped on the bay where its parts sit. They shrink away and new parts grow in where they stood.",
    caption: `A first fit of three parts: ${fit(3)} points.`,
  },
  controls: [
    { action: "Swap two parts", touch: "Drag a part onto its neighbour, any of eight ways", desktop: "Drag with the mouse, or click a part and then its neighbour" },
    { action: "Fit a blueprint", touch: "Drag it from the tray onto the bay, or tap it and then tap the bay", desktop: "The same with the mouse. The strip over the bay shows what it scores where it is held" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Swap with the keyboard", touch: "", desktop: "Space holds the part under the cursor; then an arrow, or Q, E, Z or C for a corner, swaps it that way" },
    { action: "Fit with the keyboard", touch: "", desktop: "A number key picks that blueprint and sits it at the cursor; Space or Enter fits it" },
  ],
  scoring: [
    `**A fit scores ${c.fitPoints} for each part over two.** Three parts are ${fit(3)}, four are ${fit(4)}, five are ${fit(5)}.`,
    `**Fits in a chain multiply.** Fits made one after another with no swap between are a chain. The second pays ×2, the third ×3, up to ×${c.chainCap}. A swap ends the chain. Four fits of four parts one at a time are ${4 * fit(4)}; in one chain they are ${chain(4, 4)}.`,
    `**Each core a fit takes adds ${c.corePoints}**, times its place in the chain too.`,
  ],
  stageMedia: {
    full: {
      kind: "clip",
      name: "core",
      alt: "A blueprint is dropped over a spot where one of its squares sits on a hex-nut core. The core stands in for the part, and it is fitted with the rest.",
      caption: `A core stands for any part, and adds ${c.corePoints} to the fit.`,
    },
  },
  stages: [
    {
      level: "beginner",
      goal: "Learn how each part moves, and fit something in your first seconds.",
      tips: [
        {
          title: "Read the shape",
          body: "A girder lies flat and moves sideways. A strut stands up and moves up and down. A cable lies corner to corner and moves that way. Only one of the two parts has to move that way, so a girder can carry a panel sideways, and a cable can carry a strut to a corner.",
          media: {
            kind: "clip",
            name: "ways",
            alt: "A girder is dragged sideways onto the panel beside it and the two trade places. Then a strut is dragged up onto the part above it, and a cable corner to corner.",
            caption: "Each part moves the way its shape lies, and carries its neighbour with it.",
          },
        },
        {
          title: "Start with what is almost there",
          body: "Look at each blueprint and find a spot in the bay where all but one of its parts already sit. Then find a neighbour of the missing square that is the right kind and can move into it.",
        },
        {
          title: "Panels are the hard part",
          body: "A panel cannot move by itself. When a blueprint asks for a panel, build it round a panel that is already in place, rather than dragging one across.",
        },
      ],
      drill: `Play the Parts stage. You are there when a round finishes above ${stage("parts").thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Stop fitting as soon as you can. Set two or three up, then fit them in a row.",
      tips: [
        {
          title: "A swap ends the chain",
          body: `Fitting the moment something fits gives you ${fit(4)} for each four-part blueprint. Holding back until three are ready and fitting them in a row gives ${chain(4, 3)}. The swaps cost the same either way.`,
        },
        {
          title: "Set up, then fit them all",
          body: "A fit changes only the cells it takes. Every other blueprint you set up stays ready, so set up two or three, then fit them one after another.",
          media: {
            kind: "clip",
            name: "chain",
            alt: "Three blueprints sit ready in the bay. They are fitted one after another with no swap between: the first pays 10, the second 40 with a callout of chain times two, the third 60 with chain times three.",
            caption: "Three ready, then three fits in a row: each pays more by its place in the chain.",
          },
        },
        {
          title: "Look at what appears",
          body: "After each fit, new parts appear where it was and a new blueprint arrives. Sometimes it fits already. Check before you swap: a fit with no swap keeps the chain going.",
        },
      ],
      drill: `Play the Chains stage and never fit alone. You are there when a round finishes above ${stage("chains").thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Set the whole tray up, and keep it set while you build it.",
      tips: [
        {
          title: "Keep blueprints apart",
          body: "Two blueprints set up over the same cells cannot both be fitted. Give each one cells of its own, side by side or one above the other.",
        },
        {
          title: "Use cores late",
          body: `A core pays ${c.corePoints} times its place in the chain, so it pays most in the last fit of a long chain. A core also stands still: build round it, never through it.`,
        },
        {
          title: "Spend swaps on the big blueprints",
          body: `A five-part blueprint is worth three times a three-part one, at every place in the chain. Put it last in the chain, where its place is highest.`,
        },
      ],
      drill: `Aim for a chain of four or more every round. You are there when a round finishes above ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: `Chains of ${word(c.chainCap)}, every round.`,
      tips: [
        {
          title: "Read the new parts",
          body: "A fit leaves new parts where it stood. An expert sets the next blueprint up beside a fit, so the parts that appear have a chance to finish it.",
        },
        {
          title: "Know when to stop setting up",
          body: "The clock is the only limit. Six blueprints set up take a long time, and a round that ends mid-setup scores nothing for it. Start the chain when the next swap would cost more time than one more place is worth.",
        },
      ],
      drill: `You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    `**Fitting the moment something fits.** ${fit(4)} a time, where the same fits in a chain of four pay ${chain(4, 4)}.`,
    "**Setting two blueprints up on the same cells.** Only one of them can be fitted, and the swaps spent on the other are lost.",
    "**Dragging panels across the bay.** Each step needs a neighbour that moves that way. Build round the panels where they are.",
    "**Swapping in the middle of a chain.** It ends the chain. Fit everything ready first.",
  ],
};
