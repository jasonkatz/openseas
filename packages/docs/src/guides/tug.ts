import { tugDeliveryPoints } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.tug;
const c = p.config;
/** What a clamp of this par is worth. */
const worth = (par: number): number => c.parPoints[par - 1]!;
/** A clean delivery of this par as the `streak`th clean one in a row. */
const clean = (par: number, streak = 1): number => tugDeliveryPoints(c, par, "clean", streak);
const slow = (par: number): number => tugDeliveryPoints(c, par, "slow", 0);
/** Clean deliveries in a row before the streak stops growing. */
const streakFull = c.streakPercent.length;
const streakMax = c.streakPercent[streakFull - 1]! / 100;
const top = clean(c.maxPar, streakFull);
/** What the deliveries after a broken full streak fall short by while it is built again, at the top par. */
const rebuild = Array.from({ length: streakFull - 1 }, (_, i) => top - clean(c.maxPar, i + 1)).reduce((a, b) => a + b, 0);
/** Clean deliveries that bring the clamps from the first par to the top one. */
const cleansToTop = (c.maxPar - c.startPar) * c.cleanPerStep;
const pars = Array.from({ length: c.maxPar - c.startPar + 1 }, (_, i) => c.startPar + i);
const list = (xs: readonly (string | number)[]): string => `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]!}`;
const topMark = p.thresholds[p.thresholds.length - 1]!.score;

export const tug: Guide = {
  id: "tug",
  tagline: "Flick a pod and it slides until something stops it. Park the right one on the lit clamp.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Tug bay: a seven by seven floor with five grey blocks, four cargo pods of different shapes, and one lit clamp showing the outline of the drum. Dotted tracks show where the drum would slide.",
    caption: "The bay. The lit clamp wants the drum, and the dotted tracks show where each flick would carry it.",
  },
  theme: {
    setting:
      "The cargo bay has no gravity, so nothing in it stops by itself. You are the pirate stowing cargo: you flick a pod and it sails across the bay until a wall, a block or another pod gets in its way. One floor **clamp** is lit at a time, and it wants one pod at rest on it.",
    purpose:
      "Tug is a prototype. It is on the test bench only and belongs to no ship yet. It is trying out a puzzle with almost no luck in it: the only thing dealt is the next clamp. The skill it asks for is seeing where a slide will end, and building the stop that is not there yet.",
  },
  facts: [
    { label: "Bay", value: `${c.width} by ${c.height}, ${c.pods} pods, ${c.blocks} blocks` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.thresholds[2]!.score} points` },
  ],
  rules: [
    "Flick a pod and it slides in a straight line until a **wall, a block or another pod** stops it. It cannot stop anywhere else.",
    "One clamp is lit, with the outline of the pod it wants. Bring that pod to **rest** on it. A pod that slides over the clamp keeps going, and that does not count.",
    "A delivered pod stays where it stopped. Another clamp lights, for some pod, somewhere else.",
    "Every clamp has a **par**: the fewest flicks that can deliver it from the bay as it stood when it lit. Every flick counts against it, whichever pod you flick. The strip over the bay shows the par and the flicks you have spent.",
    "A flick into something the pod already rests against moves nothing and costs nothing.",
    `**Skip** gives the clamp up for ${c.skipPenalty} points and lights another.`,
    `The round is ${p.roundSeconds} seconds on the clock. The blocks stay put for the whole round, and there is no undo.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-delivery",
    alt: "The crate is flicked right and slides to the wall, then flicked down and slides the length of the bay to rest on the lit clamp in the corner. The board says Clean.",
    caption: "Two flicks of one pod on a par two: across to the wall, then down onto the clamp.",
  },
  controls: [
    { action: "Flick a pod", touch: "Swipe starting on the pod. It goes as soon as the swipe has a direction", desktop: "Drag from the pod the same way" },
    { action: "Pick a pod and see its ghosts", touch: "Tap the pod", desktop: `Click the pod, or press 1 to ${c.pods}. Space picks the next one` },
    { action: "Flick the picked pod", touch: "Swipe anywhere, or tap a cell in its row or column", desktop: "Arrow keys or W A S D, or click a cell in its row or column" },
    { action: "Skip the clamp", touch: "Tap Skip over the bay", desktop: "X or Backspace" },
    { action: "Let go of the pod", touch: "", desktop: "Escape" },
  ],
  scoring: [
    `A clamp is worth more the higher its par: ${list(pars.map((n) => `${worth(n)} at par ${n}`))}.`,
    `Delivered **at par** it is **clean** and pays double. Up to ${c.slack} flicks over par it pays its plain worth. Slower than that it pays half.`,
    `Clean deliveries in a row build a **streak** that multiplies them: ${c.streakPercent.map((x) => `×${x / 100}`).join(", ")}. Any other delivery, or a skip, ends it.`,
    `**The clamps follow you.** Every ${c.cleanPerStep} clean deliveries raise the par of the clamps to come by one, up to par ${c.maxPar}. A slow delivery or a skip takes one clean delivery back.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Know where a pod will stop before you flick it, and deliver the par two clamps in two.",
      tips: [
        {
          title: "Read the ghosts",
          body: "When a clamp lights, the pod it wants is picked for you. Dotted tracks run from it to where each of its flicks would end. A **green ring** on the clamp means that flick delivers: take it. The ghosts look one flick ahead and no further.",
          media: {
            kind: "still",
            name: "ghosts",
            alt: "The crate sits in the top right corner with dotted tracks running left and down. The track running down ends in a green ring on the lit clamp in the bottom right corner.",
            caption: "One flick in. The green ring says the flick down delivers.",
          },
        },
        {
          title: "Two flicks, one pod",
          body: `The first clamps are par ${c.startPar}. About three times in four the wanted pod does both flicks itself: one to reach the clamp's row or column, one to slide onto it. So look along the clamp's row and column for a cell your pod can stop on.`,
        },
        {
          title: "It has to stop there",
          body: "A pod only rests on the clamp if something stands just **beyond** it: a wall, a block or a pod. Before you flick toward a clamp, look at the cell on its far side. If that cell is empty the pod sails over and you have spent a flick.",
        },
      ],
      drill: `Before every flick, point at the cell where the pod will stop, then check the ghost. A practice round shows the first flick of a par route if you wait a few seconds: try to beat it. You are there when a round passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Work back from the clamp: find the stop first, and when there is none, put one there.",
      tips: [
        {
          title: "Start at the clamp",
          body: "Look at the four cells around the clamp. A wall, block or pod on one side means the cargo can arrive from the **opposite** side, sliding toward it. That names the lane the last flick uses. Then ask how the pod gets into that lane.",
          media: {
            kind: "still",
            name: "open-clamp",
            alt: "A lit clamp for the crate stands in open floor near the top of the bay, with empty cells on all four sides. The crate is in the middle row with the wedge and drum to its right.",
            caption: "A clamp in the open. Nothing beside it will stop the crate yet.",
          },
        },
        {
          title: "Park a stop",
          body: `When no side of the clamp has a stop you can use, flick **another pod** there first, then send the cargo into it. About three in four par ${c.startPar + 1} routes need this. The helper's flick counts against par, so it must reach its place in one.`,
          media: {
            kind: "clip",
            name: "park-a-stop",
            alt: "The wedge is flicked up, slides over the clamp and stops at the top wall, just above it. The crate is flicked right into the clamp's column, then up, and stops on the clamp against the wedge.",
            caption: "Par three. The wedge goes up to the wall first, and the crate stops against it.",
          },
        },
        {
          title: "Look without flicking",
          body: "Tap any pod, or press its number, and the ghosts move to it. That costs no flick. Use it to check that a helper really stops where you need it before you send it.",
        },
        {
          title: "Decide before the first flick",
          body: "Clean means exactly par, so one flick off the route and the double is gone for that clamp. There is no undo. Do all the looking first, then flick.",
        },
      ],
      drill: `On every par ${c.startPar + 1} clamp, name the thing the cargo will stop against before you touch a pod. You are there when the strip reads par ${c.maxPar} in most rounds: that takes ${cleansToTop} clean deliveries.`,
    },
    {
      level: "advanced",
      goal: `Read a par ${c.maxPar} route whole, and carry the streak through it.`,
      tips: [
        {
          title: "The cargo rarely goes first",
          body: `Nine in ten par ${c.maxPar} routes use a second pod, and in six of ten the first flick is not the cargo's. Plan it backward: the stop the cargo ends against, how the cargo reaches that lane, then which pod has to move first to make either one possible. A helper may need two flicks of its own.`,
          media: {
            kind: "clip",
            name: "par-four",
            alt: "On a par four the crate is flicked right and then down, sliding over the clamp to park against the wall below it. Then the wedge is flicked left and down, and stops on the clamp against the crate. The board says Clean.",
            caption: "Par four. Two flicks park the crate under the clamp. Then two bring the wedge onto it.",
          },
        },
        {
          title: "Use par as a check",
          body: "Par is exact. If your route is shorter than par you have misread a slide: something stops the pod early, or nothing stops it at all. If it is longer, a shorter one exists. Keep looking until your count matches the strip.",
        },
        {
          title: "What the streak pays",
          body: `A clean par ${c.maxPar} is ${clean(c.maxPar)}. As the ${streakFull}th clean delivery in a row it is ${top}. The same clamp one flick over par is ${worth(c.maxPar)} and the streak starts again. Par ${c.maxPar} at a full streak is where a round's points are.`,
        },
      ],
      drill: `On a par ${c.maxPar} clamp, say the whole route pod by pod before the first flick. You are there when a streak reaches ${streakFull}.`,
    },
    {
      level: "expert",
      goal: "Spend the clock on reading, not on recovering, and know what to do with a clamp gone wrong.",
      tips: [
        {
          title: "Read whole, then fire",
          body: `A swipe flicks the moment it has a direction, and on keys it is a number and an arrow. Playing a route you have read takes a second or two. All the time is in the reading, and ${Math.ceil(topMark / top)} full streak par ${c.maxPar} deliveries are the top mark of ${topMark}.`,
          media: {
            kind: "clip",
            name: "streak",
            alt: "With four clean deliveries already made, a par four clamp is delivered in four flicks: the drum goes up and right into the top corner, then the crate goes up and right and stops on the clamp against it. The board says Clean times five.",
            caption: `The fifth clean delivery in a row, a par ${c.maxPar}: ${clean(c.maxPar, 5)} points.`,
          },
        },
        {
          title: "Count what a wrong flick costs",
          body: `At a full streak, one flick off the route turns ${top} into ${worth(c.maxPar)}. The next ${streakFull - 1} clean deliveries then pay ${rebuild} less between them while the streak builds again. A few more seconds of looking are always cheaper than that.`,
        },
        {
          title: "Over par, finish inside the slack",
          body: `Once you are past par the streak is gone whatever you do. A delivery within ${c.slack} flicks of par still pays ${worth(c.maxPar)} at par ${c.maxPar} and keeps the clamps at that par. Later than that it pays ${slow(c.maxPar)} and takes one clean delivery back.`,
        },
        {
          title: "Skip only when you are lost",
          body: `A skip costs ${c.skipPenalty} points and takes one clean delivery back, the same step down as a slow delivery, which at least pays. So if you can see the finish, finish. Skip when you can see no route at all: the seconds are worth more than the ${c.skipPenalty} points.`,
        },
      ],
      drill: `Play rounds where you may not touch a pod until you can say the whole route. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    "**Flicking to see what happens.** Every flick counts against par. The ghosts show the same thing for nothing.",
    "**Aiming at a clamp with nothing beyond it.** The pod slides over. Find the stop first.",
    "**Moving the cargo first on a hard clamp.** At par three and four the first flick usually belongs to another pod.",
    "**Skipping a clamp you could still finish.** Any delivery pays something. A skip only costs.",
    "**Rushing the first flick on a long streak.** That one flick is worth more than the seconds it saves.",
  ],
};
