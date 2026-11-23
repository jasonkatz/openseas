import { FREEFALL_LEGS } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.freefall;
const c = p.config;
/** A leg's berths, left to right, as the board shows them: the content's list mirrored. */
const berths = (leg: number): number[] => {
  const half = c.bays[FREEFALL_LEGS[leg]!];
  return [...half].reverse().concat(half);
};
const top = (leg: number): number => Math.max(...berths(leg));
const low = (leg: number): number => Math.min(...berths(leg));
/** What a cluster of n pays in a berth worth v. */
const cluster = (v: number, n: number): number => (c.squareClusters ? v * n * n : v * n);
const legs = ["first", "second", "third", "fourth"];

export const freefall: Guide = {
  id: "freefall",
  tagline: "Drop pods into a widening shaft of rockers. Tip the full cradles so they fall together.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Freefall shaft: ${c.entry} drop lanes at the top, widening over ${c.rows} rows of rockers in a brick pattern to ${c.width} lanes at the foot, each rocker a cup on one side and a lever on the other, over a row of berths with their values written in them.`,
    caption: "The shaft at the start of a round, every cradle empty.",
  },
  theme: {
    setting:
      "A salvage station drops its cargo down a long shaft of rockers into the berths below. You and a rival crew take turns at the top, and whatever reaches the berths on your drop is yours. Pods left resting in the rockers are there for whoever tips them next.",
    purpose:
      "Freefall is a prototype. It is on no ship yet. It tries out a race against another crew where reading what you leave behind matters as much as what you take.",
  },
  facts: [
    { label: "Shaft", value: `${c.entry} lanes in, ${c.width} berths out, ${c.rows} rows of rockers` },
    { label: "Round", value: `Four legs, at most ${p.roundSeconds} seconds` },
    { label: "Rated against", value: "Your lead over the rival" },
  ],
  rules: [
    `The shaft is narrow at the top and wide at the foot: ${c.entry} lanes to drop down, marked by dots, over ${c.width} berths. Tap one of the top lanes to drop a **pod**. It falls straight down, a row at a time, and rockers lower down spread it outward.`,
    "A **rocker** spans two lanes: a cup on one side, its **cradle**, and a lever on the other, its **arm**. A pod that lands in an empty cradle stays there.",
    "A pod that lands on a full cradle rolls over to the arm. A pod that passes an arm flips the rocker: the cradle swings to the other side and the pod resting in it is tipped out and falls.",
    "Pods that reach the same lane in the same row fuse into a **cluster** and fall as one. Two pods passing an arm flip it twice, so a resting pod lands back.",
    `Whatever reaches the **berths** at the foot on your drop is yours. ${c.rival ? "A rival drops after every drop of yours, down whatever lane pays it most at once." : ""}`.trim(),
    `A round is four legs, each with its own berth values and its own **quota**. When either side reaches the quota, the other drops once more and the leg ends. Pods at rest stay for the next leg.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "tip",
    alt: "A pod drops down a lane, passes the arm of a rocker and flips it. The pod that was resting in the rocker's cup is tipped out, and both pods fall to the berths below and score.",
    caption: "A pod past an arm flips its rocker and tips out the pod resting in the cup.",
  },
  controls: [
    { action: "Drop a pod", touch: "Tap anywhere down one of the top lanes", desktop: "Click one of the top lanes" },
    { action: "See what a drop is worth", touch: "", desktop: "Hover a top lane, or pick one with the arrow keys or A and D. The strip over the shaft shows its points" },
    { action: "Drop down the lane in hand", touch: "", desktop: "Space or Enter" },
  ],
  scoring: [
    `**A pod pays the berth it lands in.** The first leg pays ${top(0)} in every berth. Later legs pay most at the edges: up to ${top(1)}, ${top(2)} and ${top(3)}, down to ${low(3)} in the middle.`,
    c.squareClusters
      ? `**A cluster of n pays its berth n × n times.** Two pods fused in a berth worth ${top(3)} pay ${cluster(top(3), 2)}, where two apart pay ${2 * top(3)}.`
      : `**A cluster of n pays its berth n times.**`,
    c.rival
      ? "**Your score is your lead.** Your points less the rival's at the end, and never below zero. Points the rival takes count against you."
      : "**Your score is your points.**",
  ],
  stages: [
    {
      level: "beginner",
      goal: "Learn which drops rest and which drops score.",
      tips: [
        {
          title: "Use the strip",
          body: "Hover a lane, or pick one with the keys, and the strip shows what a drop down it is worth right now. It says Rests when the pod would only settle in a cradle.",
        },
        {
          title: "A full cradle is a loaded spring",
          body: "Find a rocker with a pod in its cup. Drop down its arm side, or onto the full cup, and the rocker flips and both pods fall. Follow the lane below to see which berth they reach.",
        },
        {
          title: "Edges pay",
          body: `From the second leg the outside berths pay up to ${top(1)} and the middle ones as little as ${low(1)}. A pod that ends at the edge is worth many in the middle.`,
        },
      ],
      drill: `Play a round looking at the strip before every drop. You are there when a round finishes above ${p.thresholds[1]!.score}.`,
    },
    {
      level: "intermediate",
      goal: "Stop handing the rival easy points.",
      tips: [
        {
          title: "Every resting pod is a gift",
          body: "A pod you leave in a cradle can be tipped by whoever drops next, and the rival drops right after you. Before you drop, look at what your pod will leave resting, and where a rival drop would send it.",
          media: {
            kind: "clip",
            name: "answer",
            alt: "The player drops a pod that comes to rest in a cradle. The rival's pod appears over another lane with a rose ring, falls, flips the rocker and tips the resting pod out, and both land in berths for the rival's points, shown in rose.",
            caption: "A pod left resting, and the rival's answer: it tips the pod out and takes the points.",
          },
        },
        {
          title: "Take the pod before it does",
          body: "When a full cradle sits over a rich berth, take it now even if the drop pays a little less than another. The other drop will still be there; the full cradle will not.",
        },
        {
          title: "Watch the quota",
          body: "When you reach a quota, the rival drops once more and the leg ends. When the rival reaches it, you get one last drop: make it the best one on the shaft.",
        },
      ],
      drill: `Count the rival's points in the HUD each leg. Aim to hold it under your own in every leg. You are there when a round finishes above ${p.thresholds[2]!.score}.`,
    },
    {
      level: "advanced",
      goal: "Set up clusters, and cash them in on the rich legs.",
      tips: [
        {
          title: "Two falls that meet",
          body: "A tipped pod falls down the cradle's lane while the pod that tipped it goes on down the arm's lane. When two such falls arrive in one lane at one row, they fuse. Look for two full cradles whose lanes meet lower down.",
          media: {
            kind: "clip",
            name: "cluster",
            alt: "One drop flips a rocker, the tipped pod and the dropped pod fall down neighbouring lanes, meet in one lane lower down and fall on together as a cluster with a 2 on it, and land in one berth.",
            caption: "Two pods meet in a lane and land as one cluster, for twice twice the berth.",
          },
        },
        {
          title: "Save the big setups",
          body: `Pods at rest stay from one leg to the next. A cluster in the first leg pays ${cluster(top(0), 2)}; the same cluster at the edge of the fourth pays ${cluster(top(3), 2)}. Fill cradles late in a leg the rival is winning anyway.`,
        },
      ],
      drill: `Check the summary for your largest cluster. Aim for a cluster of two in every round. You are there when a round finishes above ${p.thresholds[3]!.score}.`,
    },
    {
      level: "expert",
      goal: "Read two drops ahead: yours, and the rival's answer.",
      tips: [
        {
          title: "Score less, leave nothing",
          body: "The best drop is often not the one worth most. It is the one that pays well and leaves the shaft with no rich tip for the rival. Weigh each drop by its points less the best drop it leaves.",
        },
        {
          title: "Even flips hold a pod",
          body: "A cluster of two past an arm flips the rocker twice, so the pod in its cradle lands back. Use it to pass a full cradle without spilling it, and keep it loaded for yourself.",
        },
        {
          title: "Race the legs you can win",
          body: `The legs pay differently. The ${legs[1]} and ${legs[3]} reward the edges far more than the ${legs[0]} and ${legs[2]}. Win the rich legs by a lot, and close the poor ones fast.`,
        },
      ],
      drill: `Play rounds where the rival never scores more than you in one drop. You are there when a round passes ${p.thresholds[4]!.score}.`,
    },
  ],
  mistakes: [
    "**Chasing the richest berth.** No lane drops straight onto the edge berths: a pod only gets there by flips on the way, and one that rests short of it is the rival's to tip.",
    "**Filling cradles for the rival.** Every pod you leave at rest is one the next drop can take, and the next drop is the rival's.",
    "**Ignoring the last drop.** When the rival reaches a quota you get one more drop. Use it on the best tip on the shaft.",
  ],
};
