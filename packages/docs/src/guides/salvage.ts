import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.salvage;
const c = p.config;
/** An open line of n pieces. */
const line = (n: number): number => c.linePoints * n * n;
/** The same line closed into a loop, before anything it nets. */
const closed = (n: number): number => Math.floor((line(n) * c.loopPercent) / 100);
/** What k crates are worth in one net, between them. */
const net = (k: number): number => c.crateLoopPoints * k * k;
const streakMax = c.streakPercent[c.streakPercent.length - 1]! / 100;
/** Long lines in a row before the streak stops growing. */
const streakFull = c.streakPercent.length;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number): string => words[n] ?? String(n);
const ordinals = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number): string => ordinals[n] ?? `${n}th`;
const times = (percent: number): string => `×${percent / 100}`;

export const salvage: Guide = {
  id: "salvage",
  tagline: "Drag a tether through matching debris. Close it into a loop to net every crate.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Salvage field: ${c.width} columns and ${c.height} rows of debris in ${word(c.kinds)} shapes, with two loot crates adrift among them and a brass line along the floor.`,
    caption: "The field at the start of a round. Two loot crates are adrift in the debris.",
  },
  theme: {
    setting:
      "The ship has stopped in a field of drifting wreckage. You are the pirate on the tractor emitter, drawing a **tether** through the debris and hauling it aboard. Somewhere in the junk float sealed loot crates, and the tether will not grip them.",
    purpose:
      "Salvage is a prototype. It is on no ship yet. It is trying out a puzzle with two speeds: fast eyes for the longest line on the field, and the patience to leave crates adrift until one loop can take them all.",
  },
  facts: [
    { label: "Field", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "Crates adrift", value: `${c.startCrates} to start, ${c.maxCrates} at most` },
  ],
  rules: [
    `Drag a line through **touching** pieces of one kind and let go to haul them. Diagonals touch. A line needs ${word(c.minLine)} pieces and may not use a piece twice.`,
    "Hauled pieces leave gaps. The pieces above fall into them and new debris drifts in at the top.",
    "A **loot crate** cannot be tethered. It sinks as the debris under it is hauled, and when it reaches the floor it is taken for a small price.",
    `Bring a line of ${word(c.loopMin)} or more back onto its first piece and it closes into a **net**. A net hauls every crate on the field at once, wherever they are.`,
    "A **coupler** joins any line, and the line may change kind across it.",
    `The round is ${p.roundSeconds} seconds on the clock. Hauls are not limited and there is no undo. A field with no line left is dealt again and the crates stay put.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-line",
    alt: "The pointer drags a tether through five touching pieces of one kind, one step of it diagonal. The five are reeled up to the emitter, the pieces above fall and new debris drifts in.",
    caption: `A line of five, one step of it diagonal: ${line(5)} points. The strip over the field counts it as you draw.`,
  },
  controls: [
    { action: "Draw a line", touch: "Drag from a piece through its neighbours", desktop: "Drag with the mouse, or Space on the cursor's piece and then move the cursor" },
    { action: "Take back a step", touch: "Drag back onto the piece before", desktop: "Drag back, or move the cursor back" },
    { action: "Haul the line", touch: "Let go", desktop: "Let go, or Space or Enter" },
    { action: "Close a net", touch: "Drag back onto the first piece when it pulses", desktop: "The same, by drag or by cursor" },
    { action: "Drop the line", touch: `Let go with fewer than ${word(c.minLine)} pieces`, desktop: "The same, or Escape" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD. Q, E, Z and C move diagonally" },
  ],
  scoring: [
    `**A line of n pieces scores n × n.** Three is ${line(3)}, five is ${line(5)}, eight is ${line(8)}, ten is ${line(10)}.`,
    `**Crates in a net multiply each other.** One is ${net(1)}, two together are ${net(2)}, three are ${net(3)}. A crate off the floor is ${c.crateFloorPoints}.`,
    `Closing a line doubles its own points, and debris caught inside the loop adds ${c.enclosedPoints} a piece.`,
    `A line of ${word(c.streakMin)} or more builds a **streak** that multiplies the whole haul, crates included: ${c.streakPercent.map(times).join(", ")}. One shorter line is forgiven. A second in a row breaks it.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: `Stop hauling threes. Find a line of ${word(c.streakMin)} every time, and learn what a net looks like.`,
      tips: [
        {
          title: "Follow one kind around corners",
          body: `A line can turn at every piece and step diagonally, so it rarely runs straight. Pick the kind you see most of, put a finger on one end of the clump and snake through it. The strip over the field shows the pieces and the points as you go, so read it before you let go.`,
        },
        {
          title: "One long line beats many short ones",
          body: `Three threes are ${3 * line(3)} points. The same nine pieces in one line are ${line(9)}. Every piece you add is worth more than the last, so before you let go, look round the end of the line for one more.`,
          media: {
            kind: "clip",
            name: "long-haul",
            alt: "The pointer winds a tether through ten pieces of one kind across the field, the strip counts up to ten pieces, and the whole line is hauled at once for one hundred points.",
            caption: `Ten pieces in one line: ${line(10)} points. As three threes and a spare they would be ${3 * line(3)}.`,
          },
        },
        {
          title: "The smallest net is a square",
          body: `Four of a kind in a two by two block is a net: drag round the four and back onto the first. The first piece pulses when the line can close. Even this small one hauls every crate adrift.`,
          media: {
            kind: "clip",
            name: "net",
            alt: "The pointer drags round a two by two block of one kind and back onto its first piece. The line turns gold, both crates on the field are ringed, and they fly in together.",
            caption: `Four pieces closed into a net. Both crates come in: ${net(2)} for the pair, and ${closed(4)} for the line.`,
          },
        },
      ],
      drill: `Play a round where you never let go of a line shorter than ${word(c.streakMin)}. Drag back to take steps off and try another way. You are there when a round finishes above ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Keep the streak at its top step for the whole round, and stop losing crates to the floor.",
      tips: [
        {
          title: "The streak is half your score",
          body: `From the ${ordinal(streakFull)} long line in a row, every haul is worth ×${streakMax}. A round of long lines scores about double the same lines with the streak broken. So the question on every haul is not what is biggest but where the next ${word(c.streakMin)} is.`,
        },
        {
          title: "Spend the one short line on purpose",
          body: `The streak forgives **one** line under ${word(c.streakMin)}, and the next long line earns the grace back. Use it when the field is scattered: haul a three or a four that drops two clumps of a kind together, then take the long line it made. Never follow a short line with another.`,
        },
        {
          title: "Do not dig under a crate",
          body: `A crate drops one row for every piece hauled below it in its column. On the floor it is worth ${c.crateFloorPoints}. In a net with two others its share is ${net(3) / 3}. A line running across under a crate costs it one row. A line running down its column can sink it in one haul.`,
          media: {
            kind: "clip",
            name: "floor",
            alt: "A short line is hauled that includes the two pieces directly under a crate. The crate drops two rows onto the brass floor line and is taken, with a small plus thirty popping up.",
            caption: `Both pieces under the crate hauled in one line. It hits the floor and goes for ${c.crateFloorPoints}.`,
          },
        },
      ],
      drill: `Watch the streak counter beside the board. Play until it reaches ${word(streakFull)} and stays there to the end of the round. You are there when a round finishes above ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "advanced",
      goal: "Net crates in pairs and threes, never singly, and use couplers to stretch a line.",
      tips: [
        {
          title: "Wait for the second crate, want the third",
          body: `A crate netted alone is worth ${net(1)}. In a pair each is worth ${net(2) / 2}, in a three ${net(3) / 3}. Netting every crate as it appears throws away most of what crates can pay. With one crate adrift, do not close a loop at all. With two, look for a third before you close.`,
          media: {
            kind: "still",
            name: "three-adrift",
            alt: "A field with three loot crates adrift at once in the middle rows, none of them on the floor, and a coupler in the top row.",
            caption: `Three adrift: ${net(3)} in one net, before the streak. Netted one at a time they would be ${3 * net(1)}.`,
          },
        },
        {
          title: "At three, net now",
          body: `About one new piece in ${Math.round(1000 / c.cratePermille)} is a crate, but only while fewer than ${word(c.maxCrates)} are adrift. With ${word(c.maxCrates)} on the field no more can come, and every haul risks sinking one. Close the first loop you can find, a square of four included.`,
        },
        {
          title: "See loops before you need them",
          body: `Any line whose last piece touches its first can close. Squares, diamonds round a single piece and rings round a crate all work. While you wait on crates, keep one loop in mind and keep your lines off it, so it is still there when the next crate drifts in.`,
        },
        {
          title: "Cross the coupler",
          body: `A coupler lets one line run through two kinds. Run the longest line of one kind up to it and the longest of another away from it. Two fives joined through it are one line of eleven: ${line(11)} points, where apart they were ${2 * line(5)}.`,
          media: {
            kind: "clip",
            name: "coupler",
            alt: "A tether runs through several pieces of one kind, onto the pale ring of a coupler, and on through several pieces of a different kind. The whole line is hauled as one.",
            caption: "One line, two kinds, joined at the coupler.",
          },
        },
      ],
      drill: `Play rounds where no crate is netted alone. Check the round's summary: crates netted should be well over twice the loops closed. You are there when a round finishes above ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Land every net on a full streak, and waste none of the clock.",
      tips: [
        {
          title: "Crates take the streak too",
          body: `Three crates are ${net(3)}. At ×${streakMax} they are ${net(3) * streakMax}. So the streak matters most on the haul that nets. Do not close a net in the first hauls of a round or just after the streak broke, unless three are adrift.`,
          media: {
            kind: "clip",
            name: "net-three",
            alt: "With the streak at its top step and three crates adrift, the pointer closes a loop of five or more pieces. The line turns gold, all three crates are ringed and fly in, and a large score pops up.",
            caption: `A loop of five or more at full streak with three adrift. The crates alone pay ${net(3) * streakMax}.`,
          },
        },
        {
          title: "A net of four is a short line",
          body: `The streak counts pieces on the line, closed or not. A net of ${word(c.streakMin)} or more builds the streak. A net of four spends the grace, and if the grace is already spent it breaks the streak first and pays the crates at ×1. Before a small net, make sure your last haul was long.`,
        },
        {
          title: "Close long lines when no crate is waiting",
          body: `Closing doubles the line. A closed six is ${closed(6)}, an open eight is ${line(8)}. With no crate adrift, a long line that ends beside its start should be closed. With crates adrift a closed line is a net, like it or not: close it only when you mean to net.`,
        },
        {
          title: "Never wait for the board",
          body: `You do not have to watch a haul land. Touch the field and the pieces snap into place, ready for the next line. Find your next line while you draw this one, and choose it in columns this haul does not touch, so it is still there.`,
        },
      ],
      drill: `Play rounds where every net is closed with the streak at ${word(streakFull)} or more and at least two crates in it. You are there when a round passes ${p.thresholds[4]!.score} points.`,
    },
  ],
  mistakes: [
    `**Hauling the first three you see.** It scores ${line(3)} and it costs the streak. Look for ${word(c.streakMin)}.`,
    `**Netting one crate.** ${net(1)} now, instead of a share of ${net(2)} or ${net(3)} a few hauls later.`,
    "**Two short lines in a row.** The first is forgiven. The second puts the streak back to nothing.",
    `**Clearing a crate's column.** It reaches the floor and goes for ${c.crateFloorPoints}.`,
    `**Sitting on three crates.** No more can drift in while ${word(c.maxCrates)} are adrift. Net them.`,
  ],
};
