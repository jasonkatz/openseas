import { racksShipmentPoints } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.racks;
const c = p.config;
/** What the nth shipment of a chain scores. */
const ship = (n: number): number => racksShipmentPoints(c, n);
/** A chain of n shipments, added up. */
const chain = (n: number): number => Array.from({ length: n }, (_, i) => ship(i + 1)).reduce((a, b) => a + b, 0);
/** The longest chain that still grows. */
const chainTop = c.chainPercent.length;
/** A rack this full has no room for any crate. */
const noRoomAt = c.height - c.crateMin + 1;

export const racks: Guide = {
  id: "racks",
  tagline: "Move the top of one stack onto another. Ship a rack full of one kind.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Racks board: ${c.racks} racks in a row, each a stack of up to ${c.height} fuel cells in four shapes. A crate of two cells hangs from a trolley over the first rack, with the number 3 on the trolley and outlines in the rack where its cells will sit.`,
    caption: "The row. The crate hangs over the marked rack, and the number on its trolley is the moves until it lands.",
  },
  theme: {
    setting:
      "The fuel bay is a row of racks and a gantry that never stops delivering. You are the pirate on the bay floor, lifting cells off one rack and onto another until a rack holds one kind and can go to the engines. The next crate is already over your head.",
    purpose:
      "Racks is a **prototype**: it is played on the test bench and is in no ship yet. It is trying out sorting under a deadline you can see coming, where you choose when the next load arrives. The skill it asks for is keeping the row in order, then timing shipments so they land back to back.",
  },
  facts: [
    { label: "Row", value: `${c.racks} racks, ${c.height} cells tall, ${c.kinds} kinds` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Crate", value: `${c.crateMin} or ${c.crateMax} cells, lands after ${c.landEvery} moves` },
    { label: "Status", value: "Prototype, on the test bench" },
  ],
  rules: [
    `A move lifts the top of one rack and sets it on another that has room. Cells of one kind sitting together at the top are a **group** and move as one. Any cell may sit on any other.`,
    "If the whole group does not fit, as many cells as fit go across and the rest stay.",
    `A rack filled to the top with one kind **ships**: it scores ${c.shipPoints} and comes back empty.`,
    `A **crate** of ${c.crateMin} or ${c.crateMax} new cells always hangs over one rack, the **marked** one. Every move takes one off the count on its trolley, and the move that takes it to zero lands the crate on top of whatever is there. A new crate is hung at once, over any rack.`,
    `A crate with too little room **smashes** its rack: every cell in it is lost, and ${c.spillPenalty} points with them. The trolley and the rack turn red while that is coming.`,
    "You can **call** the crate down at once. A call is an action, like a move.",
    "A crate that lands to fill its rack with one kind ships it. The trolley turns gold when it will.",
  ],
  rulesMedia: {
    kind: "clip",
    name: "ship",
    alt: "A group of cells of one kind is lifted off the top of a rack and set on a rack that holds the same kind. The rack is now full of one kind, flashes gold and empties, and plus 100 rises from it.",
    caption: `Lift a group, set it on its own kind. The rack fills, ships for ${c.shipPoints} and comes back empty.`,
  },
  controls: [
    { action: "Lift a rack's top group", touch: "Tap the rack", desktop: `Click the rack, or press its number, 1 to ${c.racks}` },
    { action: "Set the group down", touch: "Tap another rack", desktop: "Click another rack, or press its number" },
    { action: "Put the group back", touch: "Tap the same rack again", desktop: "Click the same rack again, or press Escape" },
    { action: "Move in one stroke", touch: "Drag from rack to rack", desktop: "Drag from rack to rack" },
    { action: "Move with the cursor", touch: "", desktop: "Left and right, or A and D. Space or Enter lifts and sets down" },
    { action: "Call the crate", touch: "Tap the crate", desktop: "Click the crate, or press C" },
  ],
  scoring: [
    `A shipment scores ${c.shipPoints}.`,
    `A shipment on the action straight after another is a **chain**: the second scores ${ship(2)}, the third ${ship(3)}, up to ${ship(chainTop)} from the ${ordinal(chainTop)}. Any action that ships nothing ends the chain, a call too.`,
    "A crate that ships its rack counts in the chain like any other shipment.",
    `A smashed rack costs ${c.spillPenalty} points and every cell in it, and ends the chain. The score never goes below zero.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Sort without making a mess, and never let a crate smash a rack.",
      tips: [
        {
          title: "Like onto like, whole groups",
          body: `Put each group on a rack whose top is the same kind, so the two become one group that moves together from then on. When two racks hold the same kind, move the shorter onto the taller. A group set down on a different kind buries that rack, and it costs a move to dig out again.`,
        },
        {
          title: "One rack a kind, one spare",
          body: `There are ${c.kinds} kinds and ${c.racks} racks. Give each kind a rack and keep the last one empty, or nearly. The spare is where a group goes while you reach the cell under it. Fill it with odd cells and every later move has nowhere to go.`,
        },
        {
          title: "Red means clear it now",
          body: `A red trolley says the crate has no room, and the strip on top says how many moves you have. Lift the marked rack's top group onto its own kind, or finish the rack and ship it. A smash loses the whole rack, ${c.spillPenalty} points and the chain.`,
          media: {
            kind: "still",
            name: "no-room",
            alt: "A crate hangs over a rack that has too little room left for it. The trolley is red with a 2 on it, the rack is tinted red, and the strip reads: No room under the crate, 2 moves to clear it.",
            caption: "More cells in the rack and the crate than the rack holds, and two moves left. Something has to come off.",
          },
        },
        {
          title: "Make room with a move you wanted anyway",
          body: "The best way out is a move that also sorts. Look at the top group of the marked rack: if its kind tops another rack, send it there. The trolley turns back to brass as soon as the crate fits.",
          media: {
            kind: "clip",
            name: "make-room",
            alt: "The same board. The group on top of the marked rack is lifted onto a rack of their own kind, and the trolley turns from red to brass. One more move is made elsewhere and the crate lands in the room that was made.",
            caption: "The top group goes to its own kind, the red goes out, and the crate lands safely on the next move.",
          },
        },
      ],
      drill: `Before every move, look at the trolley's colour first. Play rounds where the only aim is that Racks smashed reads zero at the end. You are there when it does and the score passes ${p.thresholds[1]!.score}.`,
    },
    {
      level: "intermediate",
      goal: "Read the crate before it lands, and call it down when the row is ready for it.",
      tips: [
        {
          title: "Read what the crate will bury",
          body: "The outlines in the marked rack show where the crate's cells will sit, lowest first. A crate of one kind costs one move to lift off again, because it is one group. A mixed crate costs a move for each kind in it. So while the count runs, ask what you want under it: its own kind is best, and an empty rack is next.",
        },
        {
          title: "Keep off the marked rack",
          body: `A group set on the marked rack can be what leaves the crate without room. Count before you set down: the cells in the rack plus the cells in the crate must not pass ${c.height}. A rack holding ${noRoomAt} has no room for any crate.`,
        },
        {
          title: "Ship the marked rack to empty it",
          body: "A move's own shipment happens before the crate lands. So a crowded marked rack that you fill and ship, even on the last move of the count, is empty when the crate arrives. The deadline becomes a shipment.",
        },
        {
          title: "Call when nothing is left to tidy",
          body: `Waiting out a count of ${c.landEvery} when every group is already home is wasted time: cells are what you ship. Call the crate when it fits and no sorting move is left. Do not call just because it fits. A bot that did scored about half as much as one that tidied first, and had a rack smashed about five times a round.`,
          media: {
            kind: "clip",
            name: "call",
            alt: "Every rack holds one kind and the crate over one of them holds that rack's kind. The crate is tapped, drops onto its rack at once, and a new crate is hung over another rack with a full count.",
            caption: "Nothing left to sort and the crate matches the rack under it. Tap it down and get the next one.",
          },
        },
      ],
      drill: `Each time a new crate is hung, say where its cells will end up before you move. Call every crate you are ready for. You are there when you call ten or more crates a round with nothing smashed, and the score passes ${p.thresholds[2]!.score}.`,
    },
    {
      level: "advanced",
      goal: "Ship racks back to back, so the same cells score more.",
      tips: [
        {
          title: "Two together beat two apart",
          body: `Two racks shipped on actions in a row score ${chain(2)}. The same two racks with one other action between them score ${2 * ship(1)}. In bot rounds, shipping the same number of racks in a better order was worth about one more rack a round. Before you ship, look for the second rack.`,
        },
        {
          title: "One more move before the shipment",
          body: `When one rack can ship now and another needs a move first, make that move first. Free the buried cell, then ship both. A group that would split is the usual sign: finishing a rack with part of a group leaves the rest stranded, where one move elsewhere first lets the whole group go and uncovers the next shipment.`,
          media: {
            kind: "clip",
            name: "hold",
            alt: "One rack could ship at once with part of a group. Instead a single cell is moved off the top of the middle rack onto its own kind. The group under it then fills one rack, which ships for 100, and the cell under that fills another, which ships for 200 as the board calls out Chain x2.",
            caption: `One tidy move first, then two shipments in a row: ${ship(1)} and ${ship(2)}.`,
          },
        },
        {
          title: "A gold trolley is a link",
          body: `When the crate would fill its rack with one kind, the trolley turns gold and a call is a shipment. Use it in a chain: ship a rack by hand, then call, and the crate's rack scores ${ship(2)}. A rack that is one crate short is worth building under a crate of its kind.`,
        },
        {
          title: "Hold for a move, not for a count",
          body: `A rack kept at ${c.height - 1} while you set up a second has no room for a crate, so a mark on it is a deadline of ${c.landEvery} moves. Hold a finished rack only when the second shipment is one or two moves away. Otherwise ship it and start the next.`,
        },
      ],
      drill: `Play rounds where you never ship a rack until you have looked for a second. You are there when Longest chain reads two or more in most rounds and the score passes ${p.thresholds[3]!.score}.`,
    },
    {
      level: "expert",
      goal: "Make more actions in the round, and turn pairs into chains of three.",
      tips: [
        {
          title: "Actions are the score",
          body: `The crate counts moves, not seconds, so a faster hand simply plays a longer game. A tidy bot's score grows in step with its actions: a hundred actions score nearly half as much again as seventy. You do not have to wait for a move to finish before you start the next one.`,
        },
        {
          title: "Use the numbers",
          body: `On a keyboard a move is two keys: the rack to lift from and the rack to set down on. C calls the crate. Both hands stay still and your eyes stay on the trolley. On touch, a drag is one stroke where tap and tap is two.`,
        },
        {
          title: "The third link",
          body: `Three shipments in a row score ${chain(3)}, where three apart score ${3 * ship(1)}. Two by hand are rarely enough cells on a row this small. The third is usually the crate: a gold trolley over a rack that waits while you ship the others.`,
          media: {
            kind: "clip",
            name: "three",
            alt: "A gold trolley hangs over a rack that its crate will complete. A group is moved to fill one rack, which ships for 100. A second rack is filled and ships for 200. Then the crate is called down, fills its rack and ships for 300 as the board calls out Chain x3.",
            caption: `Three actions, three shipments, one of them the crate: ${ship(1)}, ${ship(2)} and ${ship(3)}.`,
          },
        },
        {
          title: "Watch the count inside a chain",
          body: "A gold crate waits for you only as long as its count. If the count runs out during your set-up, the crate ships its rack on that move, before the others are ready, and the chain ends with the next move. Count the moves your set-up needs against the number on the trolley before you start.",
        },
      ],
      drill: `Play a round on the number keys alone and count your actions: the board's panel shows them. You are there when a round has ninety or more, Longest chain reads three now and then, and the score passes ${p.thresholds[4]!.score}.`,
    },
  ],
  mistakes: [
    "**Setting cells on the marked rack.** It is the one rack that is about to get fuller. Count the crate in before you add to it.",
    `**Calling into a crowded row.** The next crate can be hung over any rack, a full one too. Call when the row is sorted and no rack is stuck near the top with mixed cells.`,
    "**Splitting a group.** A group that only partly fits leaves cells of one kind on two racks. Unless the part that fits ships the rack, find it a rack with room for all of it.",
    `**Shipping the moment a rack is ready.** If a second rack is one move from full, that move comes first. The pair is worth ${chain(2)} together and ${2 * ship(1)} apart.`,
    `**Filling the spare rack.** With no empty rack you cannot reach a buried cell without burying another. Keep one rack free for digging.`,
  ],
};

function ordinal(n: number): string {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n] ?? `${n}th`;
}
