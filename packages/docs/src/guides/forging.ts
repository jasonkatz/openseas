import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.forging;
const c = p.config;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
/** What the n-th strike of a chain adds. */
const chain = (n: number): number => c.chainPoints * Math.min(n - 1, c.chainCap);
/** What the k-th set of a weave scores. */
const set = (k: number): number => c.setPoints * Math.min(k, c.weaveCap);
const blows = c.width * c.height * c.blows;
/** A stall with this many blows of the plate left. */
const stall = (left: number): number => Math.floor((c.stallCost * left) / blows);

export const forging: Guide = {
  id: "forging",
  tagline: "Strike a hot plate spot by spot. Each mark says where the press lands next.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Forging plate: ${c.width} by ${c.height} square tiles, all hot and the same size, each with a mark cut through it: one to four round pips, a plus, an X, an eight-spoked star or an L. Over the plate, a strip shows the next ${word(c.preview)} marks the deal will give.`,
    caption: "A fresh plate. The first strike can land anywhere.",
  },
  theme: {
    setting:
      "Down in the ship's forge a plate glows on the anvil, and you work the press. Every spot of the plate needs striking until it is set, and each spot's mark says where the press can land next. Keep it moving, and keep it out of corners.",
    purpose:
      "Forging is a prototype. It is on no ship yet. It tries out crafting: a round that is a thing made, scored on how cleanly it was made.",
  },
  facts: [
    { label: "Plate", value: `${c.width} by ${c.height}, ${word(c.blows)} strikes a spot` },
    { label: "Round", value: `The plate, or ${p.roundSeconds / 60} minutes` },
    { label: "Rated against", value: "The puzzle" },
    { label: "Preview", value: `The next ${word(c.preview)} marks` },
  ],
  rules: [
    `Tap a spot to **strike** it. Every spot takes ${word(c.blows)} strikes, shrinking a step each time, and then it is **set**: a dot the press can no longer land on. Setting the whole plate ends the round.`,
    "Every live spot shows a **mark**, and the mark you strike says where the next strike may land. The struck spot turns up a new mark at once, so the strip over the plate keeps the one you struck, framed. The spots it reaches are ringed; the rest go faint. The first strike may land anywhere.",
    "A **step** of one, two, three or four lands exactly that far in a straight line, any of eight ways, jumping what is between. A **rail** lands on the plate's edge along its row or column, a **slant** on the edge along a diagonal, a **star** on either. A **hook** lands two along and one across.",
    "New marks come from the deal in order, whatever you strike, and the strip over the plate shows the next ones: the first is what your next strike turns up.",
    "A strike that leaves the press nowhere to land is a **stall**. It costs points, then the next strike may land on any live spot.",
    "When the whole plate has been struck once, the last spot you struck shows a **spark**, and again when it has all been struck twice. A spark lands on any live spot.",
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-strikes",
    alt: "The pointer taps a tile with two pips. It squashes, comes back smaller with a new mark, and the spots two away in each straight line light up with rings while the rest go faint. The pointer taps one of the ringed spots, and the rings move on.",
    caption: "Each strike lights where the next can land: here a step of two, then the mark it lands on.",
  },
  controls: [
    { action: "Strike a spot", touch: "Tap it", desktop: "Click it" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Strike the cursor's spot", touch: "", desktop: "Space or Enter" },
  ],
  scoring: [
    `**Every strike scores ${c.strikePoints}.** The same mark struck twice in a row makes a **chain**: its second strike adds ${chain(2)}, its third ${chain(3)}, and from the ${word(c.chainCap + 1)}th on ${chain(c.chainCap + 1)} each. A spark stands in for any mark.`,
    `**Four strikes in a row holding each step once (one, two, three, four) are a count.** Four holding rail, slant, star and hook once each are a **span**. Either scores ${set(1)}.`,
    `**A set begun right after a set of the other kind links into a weave.** The second set of a weave scores ${set(2)}, the third ${set(3)}, up to ${set(c.weaveCap)}. Weaving counts and spans is the move the puzzle pays most for.`,
    `**A stall costs more the more plate is left.** With the whole plate to strike it would cost ${c.stallCost}; halfway, ${stall(blows / 2)}; with ten strikes left, ${stall(10)}. The score never goes below zero.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Strike the whole plate without stalling before the last few spots.",
      tips: [
        {
          title: "Look at where you land, not where you are",
          body: "Before you strike a ringed spot, look at its mark: that is where the press can go next. A spot whose mark reaches only set spots or the plate's far side is a stall waiting to happen.",
          media: {
            kind: "clip",
            name: "stall",
            alt: "The pointer strikes a spot with four pips near the middle of the plate. Four spots away in every direction is off the plate, so nothing lights up. Stalled and the points it cost rise in red, and the strip says Strike anywhere.",
            caption: "A step of four from the middle reaches nothing: a stall. The next strike may land anywhere.",
          },
        },
        {
          title: "Hot spots first",
          body: "Big tiles have strikes to spare. Spread your strikes over the plate and keep the hot spots for later, when you need somewhere to land.",
        },
        {
          title: "Steps are easy to keep moving",
          body: "A step of one almost always has somewhere to go. A step of four from the middle of the plate reaches nothing. Save the far steps for spots near the edge, where they reach across.",
        },
      ],
      drill: `Play a round on the Steps stage with no stall until the last ten strikes. You are there when a round finishes above ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Use the preview, and keep chains going when they are free.",
      tips: [
        {
          title: "Read the strip",
          body: `The strip shows the next ${word(c.preview)} marks the deal will give. Whichever spot you strike turns up the first one. When a hook is coming, strike a spot that a hook can get out of.`,
        },
        {
          title: "Edges are for rails and slants",
          body: "Rails, slants and stars only ever land on the edge. Every edge spot you set leaves them fewer places to go. Strike edges with the marks that need them, and land in the middle with steps and hooks.",
        },
        {
          title: "Take the chain when it is safe",
          body: `Striking the same mark twice in a row adds ${chain(2)}, three times ${chain(2) + chain(3)} in all. When two ringed spots are equally safe, take the one with the mark you just struck.`,
        },
      ],
      drill: `Play rounds where you never strike a spot without looking at where its mark lands. You are there when a round finishes above ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Build counts and spans on purpose.",
      tips: [
        {
          title: "Plan four strikes, not one",
          body: `A count needs one, two, three and four in a row, in any order. Find a path: a ringed spot with a step you still need, whose mark reaches another step you still need. The HUD shows how far the set has come. A set is worth ${set(1)}, more than a long chain.`,
          media: {
            kind: "clip",
            name: "count",
            alt: "Four strikes in a row, each landing on a lit spot: steps of one, two, three and four pips, each once. On the fourth the word Count rises over the plate and the points pop up from the spot.",
            caption: `Each step once in four strikes: a count, ${set(1)} on top of the strikes.`,
          },
        },
        {
          title: "A repeat breaks the set",
          body: "The same step twice in a set in the making ends it, and it starts again from that strike. A chain and a set pull against each other: choose which you are building.",
        },
        {
          title: "A spark fills the gap",
          body: "A spark counts as whatever mark the set is missing. Strike it as the set's last piece, and it also lets the press land anywhere for the next one.",
        },
      ],
      drill: `Play rounds on the Sets stage aiming for one set in every twenty strikes. You are there when a round finishes above ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Weave counts and spans, and finish the plate with few stalls.",
      tips: [
        {
          title: "End a count where a span can start",
          body: `The set after a count links only if it is a span begun on the very next strike. So the last step of a count should land the press where a rail, slant, star or hook is waiting. The second link pays ${set(2)}, the third ${set(3)}.`,
        },
        {
          title: "Keep the endgame alive",
          body: "Stalls come at the end, when few spots are left and they sit far apart. Leave the last spots where steps and hooks can reach each other, not scattered on the edges, and keep the second spark for the last few strikes.",
        },
        {
          title: "Not every set is worth chasing",
          body: "A set that needs a far step from the middle of a nearly set plate is a stall. Late in the round, one clean strike is worth more than a gamble on a span.",
        },
      ],
      drill: `Play rounds where your longest weave is three or more. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Landing on a spot that leads nowhere.** Check where the mark you are about to strike reaches before you strike it.",
    "**Using up the edges early.** Rails, slants and stars can only land there.",
    "**Chasing chains through a set.** A repeated mark scores a little and breaks a set worth far more.",
    "**Spending the spark at once.** A spark anywhere in the middle of the round is one strike. Near the end it saves a stall.",
  ],
};
