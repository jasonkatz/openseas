import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.reactor;
const c = p.config;
const roman = (grade: number): string => ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][grade] ?? String(grade);
/** The grade two of which fuse into a hot rod. */
const top = roman(c.hotGrade - 1);
/** Grade I rods in one hot rod. */
const rodsInHot = 2 ** (c.hotGrade - 1);
/** What fusing one hot rod up from grade I scores on the way. */
const fuseAll = c.fusePoints.reduce((sum, pts, i) => sum + pts * 2 ** (c.fusePoints.length - 1 - i), 0);
/** The most hot rods the core holds without a scram. */
const holdMax = c.criticalHot - 1;
const twoOneIn = Math.round(1000 / c.twoPermille);
const pipeTop = c.pipelinePercent[c.pipelinePercent.length - 1]!;
/** One rod out, as the nth of a pipeline run. */
const single = (n: number): number => Math.floor((c.dischargePoints * c.pipelinePercent[Math.min(n, c.pipelinePercent.length) - 1]!) / 100);
const salvoTimes = (rods: number): number => c.salvoPercent[Math.min(rods, c.salvoPercent.length) - 1]! / 100;
/** Two rods out in one swipe, as the nth and the next of a run. */
const pair = (n: number): number => Math.floor(((single(n) + single(n + 1)) * c.salvoPercent[1]!) / 100);
const atTop = c.pipelinePercent.length;

export const reactor: Guide = {
  id: "reactor",
  tagline: "Swipe the whole core to fuse fuel rods. Push each hot rod out through an open port.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Reactor board: a core ${c.size} cells wide and ${c.size} tall holding fuel rods with one, two or three bars on their casings and one hot rod, a glowing toothed disc, beside a gate in the right wall that shows a chevron. A second gate in the left wall shows a dot. A strip above shows the next rod and ${c.criticalHot} heat lamps with one lit. A bar below reads pipeline.`,
    caption: "The core. Bars on a casing are its grade, the toothed disc is a hot rod, and the gates in the wall are the ports.",
  },
  theme: {
    setting:
      "The ship's reactor burns fuel rods, and the core is where they are made. You are the pirate at the core with one lever: it slides the whole load to one wall. Rods of a grade fuse as they meet. A rod fused to the top grade runs hot, and has to go out through a port before too many pile up.",
    purpose:
      "Reactor is a **prototype**: it is played on the test bench and is in no ship yet. It is trying out a sliding and fusing game where making the big piece is only half the job, because you then have to deliver it. The skill it asks for is planning a few swipes ahead, and later the nerve to hold a hot rod back.",
  },
  facts: [
    { label: "Core", value: `${c.size} by ${c.size}` },
    { label: "Round", value: `${p.roundSeconds} seconds, swipes untimed` },
    { label: "Ports", value: `${c.ports} open at a time` },
    { label: "Status", value: "Prototype, on the test bench" },
  ],
  rules: [
    "A swipe slides every rod as far as it will go that way. A swipe that would change nothing is not taken: the rods lean and settle back.",
    "Two rods of one grade that meet **fuse** into one rod of the next grade. A rod fuses once a swipe.",
    `After every swipe a new rod enters on the edge the rods slid away from, in a lane where something moved. The strip over the core shows its grade beforehand: grade I, or grade II about one time in ${twoOneIn}.`,
    `A grade ${roman(c.hotGrade)} rod is **hot**. It fuses with nothing and takes up room until it leaves.`,
    `${c.ports} **ports** are open in the core's wall, each at the end of one row or column. Swipe toward a port's wall when a hot rod is the first rod in that lane and it is **discharged**. That port closes and another opens somewhere else on the rim.`,
    "A rod fused hot right at a port stays for that swipe. The next swipe that way sends it out.",
    `${c.criticalHot} hot rods in the core at once, or a core where no swipe can change anything, is a **scram**: the core is emptied, you lose ${c.scramPenalty} points, and it starts again with ${c.startRods} rods.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "fuse",
    alt: "A core with two grade I rods. A swipe right slides both to the right wall where they fuse into a grade II, and a new rod enters on the left edge. Two more swipes follow, and the last fuses two grade II rods into a grade III.",
    caption: "Every rod slides, like grades fuse, and a new rod comes in on the edge they left.",
  },
  controls: [
    { action: "Swipe the core", touch: "Swipe anywhere on the board. It is taken after a quarter of a cell, so you need not lift first", desktop: "Drag anywhere on the board, or press an arrow key or W, A, S, D" },
    { action: "Swipe again", touch: "Lift and swipe again. One touch is one swipe", desktop: "Release and drag again, or press the next key" },
  ],
  scoring: [
    `**Discharging a hot rod is the score:** ${c.dischargePoints} points. Fusing pays ${c.fusePoints.join(", ")} for making a grade ${c.fusePoints.map((_, i) => roman(i + 2)).join(", ")}, so fusing a whole hot rod up from grade I is ${fuseAll} in all.`,
    `**The pipeline.** A discharge within ${c.pipelineSwipes} swipes of the last one builds a run. The rods of a run are worth ${c.pipelinePercent.join(", ")} percent, so from the ${ordinal(atTop)} on each is ${single(atTop)}. ${c.pipelineSwipes} swipes with no discharge and the run is lost.`,
    `**The salvo.** Hot rods that leave in one swipe multiply each other: two score ${salvoTimes(2)} times what they would apart, three score ${salvoTimes(3)} times.`,
    `A scram costs ${c.scramPenalty}, the whole core and the pipeline. The score never goes below zero.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Cook one hot rod at a time and get each one out before you make the next.",
      tips: [
        {
          title: "Every swipe should fuse",
          body: `Each swipe brings one rod in and each fusion takes one away. So a swipe that fuses nothing leaves the core one rod fuller, and a full core scrams. A hot rod is ${rodsInHot} grade I rods and the core has ${c.size * c.size} cells: there is no room to drift. Before you swipe, find the two like rods it will bring together.`,
        },
        {
          title: "Read the gate",
          body: "A port is a gate in the wall, with a faint band along its lane. A dot means nothing is ready. A bar means a hot rod is in the lane with another rod in its way. Chevrons mean swipe that way now, one chevron for each rod that will leave.",
          media: {
            kind: "still",
            name: "gates",
            alt: "A core with two hot rods and a grade III rod stacked in the left column. The gate at the bottom of that column shows two chevrons. The gate at the top of the same column shows a bar, because the grade III rod is between it and the hot rods. Two heat lamps are lit.",
            caption: "Two gates on one column. The bottom one shows chevrons: swipe down. The top one shows a bar: the grade III is in the way.",
          },
        },
        {
          title: "First in the lane",
          body: `A hot rod leaves only when it is the first rod in the port's lane, counting from the port's wall. Rods behind it do not matter. When you fuse two grade ${top} rods right at a port the new hot rod stays put, and the same swipe again sends it out.`,
          media: {
            kind: "clip",
            name: "discharge",
            alt: "Two grade III rods sit in the left column under a gate in the left wall. A swipe up fuses them into a hot rod in the top left corner and the gate shows a chevron. A swipe left sends the hot rod out through the gate for 100 points, and a new gate opens elsewhere.",
            caption: `Fuse two grade ${top} rods, then push the hot rod at the chevron. The port it used closes and another opens.`,
          },
        },
        {
          title: "Watch the lamps",
          body: `Each lit lamp over the core is a hot rod inside it. The last lamp is a diamond, and lighting it is the scram. A scram costs ${c.scramPenalty}, which is more than the ${c.dischargePoints} a rod pays, and it takes every rod you were cooking. With a lamp lit, getting that rod out comes before making another.`,
        },
      ],
      drill: `Play rounds where you name the two rods that will fuse before every swipe, and never light a second lamp. You are there when a round has no scram and passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Deliver a hot rod to any port on the rim in two or three swipes.",
      tips: [
        {
          title: "Outer lanes need no help",
          body: "A port at the end of an outer row or column is the easy kind. Slide the hot rod to that side wall, then toward the port. It only has to be the first rod each time. So keep a hot rod at the front of its row or column, never tucked behind cooler rods.",
        },
        {
          title: "Inner lanes need a stop",
          body: "A rod slides until it hits the wall or another rod. To reach a port on an inner lane, the hot rod needs a rod ahead of it to stop against. Count the rods between it and the wall: one puts it in the second lane, two in the third. Two rods that will fuse on the way count as one.",
          media: {
            kind: "clip",
            name: "inner",
            alt: "A hot rod sits in the bottom right corner and a gate is open in the bottom wall under the second column. A swipe left fuses two grade I rods in the bottom row into one rod at the left wall, and the hot rod stops against it in the second column. The gate shows a chevron, and a swipe down sends the hot rod out.",
            caption: "The swipe left leaves one rod ahead of the hot rod, so it stops in the second column, over the port.",
          },
        },
        {
          title: "Choose where the new rod lands",
          body: "The new rod enters only in a lane where something moved, on the edge the rods left. A swipe that moves a single row or column puts the next rod in that lane for certain. Use it to drop a stop where an inner port needs one, and to keep a fresh rod out from in front of a hot one.",
        },
        {
          title: "Do not live in a corner",
          body: "Sweeping everything into one corner is the habit from other sliding games, and here it loses. Ports open anywhere on the rim, and a hot rod buried in a corner pile cannot travel. In bot rounds, a bot that kept to one corner scored less than one that swiped at random.",
        },
      ],
      drill: `Each time a rod turns hot, say the swipes that take it to a port before you make the first one. You are there when most rods leave within three swipes of turning hot and a round passes ${p.thresholds[3]!.score}.`,
    },
    {
      level: "advanced",
      goal: "Keep the pipeline running from the first discharge to the end of the round.",
      tips: [
        {
          title: `${c.pipelineSwipes} swipes, and a rod takes about seven`,
          body: `The bar under the core counts the swipes left to discharge again. A hot rod is ${rodsInHot} grade I rods and one rod enters a swipe, so even a clean player needs about seven swipes a rod. That leaves one spare. Two swipes that fuse nothing and the run is gone.`,
        },
        {
          title: "What a run is worth",
          body: `Each rod in a run pays more than the last until the ${ordinal(atTop)}, and from there every rod is ${single(atTop)} instead of ${single(1)}. In bot rounds a player who kept the run going averaged over one and a half times the plain score on every rod of the round. A scram ends the run as well as the core, so the lamps matter twice.`,
        },
        {
          title: "Cook the next rod first",
          body: `The run survives only if the next hot rod is nearly made when this one leaves. Before you deliver, look for the next pair of grade ${top} rods, or the grade II rods that will make one. The best delivery swipes fuse something as well. When the bar has swipes to spare and the next rod is far off, spend one on a fusion and deliver after.`,
          media: {
            kind: "clip",
            name: "pipeline",
            alt: "A pipeline run is going and the bar under the core is nearly empty. A hot rod is swiped out through the top wall for 125 points and the bar refills. Three swipes later two grade III rods that were already on the board have fused into a hot rod at the top wall, and it goes out for 150.",
            caption: "One rod out, and the next follows four swipes later because its two grade IIIs were already cooking.",
          },
        },
      ],
      drill: `Watch the bar, not the score. Play rounds where the only aim is that it never empties. You are there when one run lasts the whole round and the score passes ${p.thresholds[4]!.score}.`,
    },
    {
      level: "expert",
      goal: "Send hot rods out two at a time.",
      tips: [
        {
          title: "Park one, bring one",
          body: `Leave the first hot rod standing at its port with the chevron showing. Cook a second and slide it into the same lane right behind the first, with nothing between them. The gate shows two chevrons, and one swipe sends both for ${salvoTimes(2)} times their worth.`,
          media: {
            kind: "clip",
            name: "salvo",
            alt: "A hot rod is parked in the top left corner under a gate in the top wall, and three grade III rods are in the core. Two swipes fuse a second hot rod and bring it into the left column right under the first. The pipeline lapses on the way. The gate shows two chevrons, a swipe up sends both rods out, and the board calls Salvo x2 for 562 points.",
            caption: `The first rod waits at its port while the second is made. The wait loses the pipeline and the pair still pays ${pair(1)}.`,
          },
        },
        {
          title: "A pair beats the pipeline",
          body: `Two rods sent apart at the top of the pipeline pay ${2 * single(atTop)}. A pair with no pipeline at all pays ${pair(1)}. So when holding for a pair would cost the run, hold anyway: in bot rounds that scored over a third more than never holding. The best is both. A pair counts as two rods of the run, and at the top it pays ${pair(atTop)}.`,
        },
        {
          title: "Do not wait for a third",
          body: `Three rods together score ${salvoTimes(3)} times, but holding ${holdMax} lights every lamp short of the diamond, and one stray fusion of two grade ${top} rods is then a scram. In bot rounds, waiting for three scored no more than taking pairs and scrammed more often. Take three only when the third falls into line by itself.`,
        },
        {
          title: "Two ports on one wall",
          body: "Rods that leave by different ports in the same swipe are a salvo too. When both ports open on one wall, you do not need to stack: put a hot rod first in each lane and one swipe sends both. Check for this every time a new port opens.",
        },
      ],
      drill: `Play rounds where no hot rod leaves alone unless a third lamp is about to light. You are there when a round has four or more salvos, no scram, and passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    "**Sweeping to one corner.** The ports move all round the rim. Keep hot rods at the front of a lane where they can still travel.",
    "**Swiping at a gate that shows a bar.** Nothing leaves, and a new rod enters anyway. Clear the rod in the way first, or go to the other port.",
    `**Making a hot rod with no way out.** Before you fuse two grade ${top} rods, count the lamps. If the fusion lights the diamond, discharge first.`,
    "**Swipes that fuse nothing.** Each one fills a cell and uses up the pipeline bar. If no swipe fuses, pick the one that sets up a fusion on the next.",
    "**Sending one rod when a second is nearly made.** Two swipes of waiting more than doubles what the pair pays.",
  ],
};

function ordinal(n: number): string {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
}
