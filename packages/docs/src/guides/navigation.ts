import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.navigation;
const c = p.config;
/** What a constellation of n markers is worth before the chain and the swift charting bonus. */
const base = (n: number): number => n * n * c.starPoints;
/** What each landing saved under 2n adds to a constellation of n. */
const perSaved = (n: number): number => n * c.starPoints;
const seconds = (ticks: number): string => String((ticks * c.tickMs) / 1000);
const chain = c.chainPercent.map((x) => `×${x / 100}`);
const chainMax = c.chainPercent[c.chainPercent.length - 1]! / 100;
const ordinal = (n: number): string => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n] ?? `${n}th`;
/** Stars in a round when every one is left to fall by itself, to the nearest five. */
const idleStars = Math.round((p.roundSeconds * 1000) / (((c.fallTicks + c.fallTicksMin) / 2) * c.tickMs) / 5) * 5;
const n0 = c.startStars;

export const navigation: Guide = {
  id: "navigation",
  tagline: "Turn the rings so each falling star comes to rest on its own marker.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Navigation star chart: three rings around a compass, five stars resting on the inner ring, three hollow markers, and a gold spark falling toward the top column.",
    caption: "The star chart. Stars fall into the top column. The hollow shapes are the constellation.",
  },
  theme: {
    setting:
      "You are the navigator at the nav console, fixing the ship's position from the stars. Stars drift into the top of a round chart, and you turn its rings so each one settles where the **constellation** wants it. Chart one and the next is already waiting.",
    purpose:
      "A ship with a good navigator finds a faster passage: your points add speed on a voyage, and in a space battle they add movement tokens to the helm's hand every turn. Bots never take the nav console, so this is always a pirate's work.",
  },
  facts: [
    { label: "Chart", value: `${c.rings} rings of ${c.octants} slots` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Rated against", value: "The puzzle" },
    { label: "A solid round", value: `${p.parScore} points` },
  ],
  rules: [
    `The hollow **markers** are the constellation. Each wants one star of its own shape and color. There are ${c.shapes} shapes in ${c.colors} colors.`,
    "Stars fall one at a time into the **top column**. A star comes to rest on the first star it meets, or at the center when the column is empty.",
    "You can turn any ring a step either way, as often as you like. Stars ride their ring. Markers stay where they are.",
    "Stars always pack toward the center. Turn a star over an empty slot and it slides in.",
    "When every marker holds its star at the same moment, the constellation is **charted**. Those stars leave and a new constellation is dealt.",
    "If the outer slot of the top column is taken when a star arrives, you have **lost the heading**: the whole top column is swept away and it costs points.",
    "Three or more loose stars of one kind in a row, around a ring or down a column, clear. A star on its marker is never loose.",
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-turn",
    alt: "A gold comet is brought down into the empty top column, lands at the center, and the inner ring is turned three steps to carry it onto its hollow gold comet marker.",
    caption: "Bring the star down, then turn its ring to carry it onto its marker.",
  },
  controls: [
    { action: "Turn a ring one step", touch: "Tap the ring: on the right half of the chart it turns clockwise, on the left half it turns back", desktop: "Click the ring the same way, or Left and Right turn the picked ring" },
    { action: "Turn a ring several steps", touch: "Drag around the ring", desktop: "Drag around the ring" },
    { action: "Bring the star down now", touch: "Tap the center of the chart or the sky above it", desktop: "Click the center or the sky, or press Space or Enter" },
    { action: "Pick a ring", touch: "", desktop: "Up picks the next ring out, Down the next ring in" },
    { action: "Turn and drop with buttons", touch: "On a tall screen, a row of arrows for each ring and a Bring it down button sit under the chart", desktop: "The same buttons, when the window is tall" },
  ],
  scoring: [
    `**Bigger constellations pay by the square.** One of ${n0} markers is ${base(n0)} points, ${n0 + 1} is ${base(n0 + 1)}, and the largest, ${c.maxStars}, is ${base(c.maxStars)}. They grow by one marker with every second one you chart.`,
    `**Swift charting.** A constellation of n markers allows 2n landings. Each landing you did not need adds n × ${c.starPoints}. Chart ${n0} markers with ${n0} stars and the ${base(n0)} becomes ${base(n0) + n0 * perSaved(n0)}.`,
    `**The chain.** Constellations charted in a row without losing the heading multiply the first number: ${chain.join(", ")}. Losing the heading costs ${c.lostHeadingPenalty} points and starts the chain again.`,
    `A cleared row of loose stars is small change: ${c.runPoints} points for three, ${c.runPoints} more for each star beyond.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Fill the markers on the inner ring, one star at a time, and never lose the heading.",
      tips: [
        {
          title: "Bring the slot to the top",
          body: "Stars only ever arrive at the top, so the slot has to go there to meet them. Count how many steps the marker sits from the top. Turn its ring that many steps the **other** way, bring the star down, then turn the ring back. Every star you placed earlier on that ring goes away with it and comes home with it.",
          media: {
            kind: "clip",
            name: "slot",
            alt: "One inner marker already holds its star. The inner ring is turned three steps back, a teal comet is brought down at the top, and the ring is turned three steps forward so both markers hold their stars.",
            caption: "Turn the ring back, drop, turn it home. The first star returns to its marker and the new one arrives on its own.",
          },
        },
        {
          title: "Read the landing ring",
          body: "A dotted path runs from the falling star to a ring where it will rest. The ring turns **gold** when that spot is the star's own marker. A red cross means the top column is shut. Check it before every drop until you no longer need to.",
        },
        {
          title: "Keep the top open",
          body: `A star in the outer slot of the top column shuts it, and the next star to arrive there is a lost heading: ${c.lostHeadingPenalty} points gone, the column swept and the chain broken. One step of the outer ring moves that star aside. Do it the moment you see the red band.`,
        },
      ],
      drill: `Play rounds where you only chase inner markers and park every other star on the inner ring. You are there when a round passes ${p.thresholds[1]!.score} points with no heading lost.`,
    },
    {
      level: "intermediate",
      goal: "Fill markers on the outer rings, and stop waiting for stars to fall.",
      tips: [
        {
          title: "An outer star stands on the star under it",
          body: "A star on the middle ring stays there only while the inner slot under it is taken. So a middle marker needs **any** star under it first, and an outer marker needs two. Put a spare star to work as that support. The moment a ring turns a star over a hole, it slides in.",
          media: {
            kind: "clip",
            name: "slide",
            alt: "Two stars are stacked in the top column. The middle ring is turned one step, and the star on it, now over an empty inner slot, slides down to the inner ring.",
            caption: "One step off its support, the middle star slides to the inner ring.",
          },
        },
        {
          title: "Start with the top column and its neighbours",
          body: "Markers in the top column are the easy ones: bring the stars down in order, inner first. A middle marker one step from the top needs stars on the inner ring under both slots, so the star can be turned across. The further round a marker is, the more stars its road needs.",
        },
        {
          title: "Bring it down",
          body: `A star left alone takes ${seconds(c.fallTicks)} seconds to fall at the start of a round. Wait for every one and you see about ${idleStars} stars. Turn the rings first, then tap to bring the star down at once: stars are the only thing a round is short of, and the same play with quick drops brings several times as many.`,
        },
        {
          title: "Look at the next star",
          body: "The badge at the top right shows the star after this one. If the falling star has no marker, use it as the support the next one will need. If the next one has no marker either, park both on the inner ring away from the top.",
        },
      ],
      drill: `Play a round where no star is allowed to land by itself. You are there when you chart a constellation with a middle marker in it and the round passes ${p.parScore} points.`,
    },
    {
      level: "advanced",
      goal: "Build a chart where outer stars can travel anywhere.",
      tips: [
        {
          title: "Lay a floor",
          body: `Fill the inner ring and everything changes. Each new star lands on the middle ring, and the middle ring turns freely, because there is a star under every slot. The ${c.octants} floor stars cost you the swift bonus once. After that most of it is still there for every constellation that follows. To fill an inner marker under a floor, turn the inner ring until a floor star of that kind sits on it.`,
          media: {
            kind: "clip",
            name: "floor",
            alt: "The inner ring is full of stars. A teal star is brought down onto the middle ring at the top and the middle ring is turned four steps, carrying it over the floor to its marker at the bottom of the chart.",
            caption: "Over a full inner ring, a middle star rides straight to its marker.",
          },
        },
        {
          title: "Walk a star on two feet",
          body: "Without a floor, two inner stars side by side will carry a middle star anywhere. Land the star on the trailing one. Turn the **middle** ring a step, so it stands on the leading one. Turn the **inner** ring a step, so the pair moves on under it. Repeat. The star is never over a hole. Plan it so the two feet finish on inner markers of their own.",
          media: {
            kind: "clip",
            name: "walk",
            alt: "Two stars sit side by side on the inner ring. A third lands on the middle ring above one of them and is walked round the chart, middle ring then inner ring by turns, until all three stars sit on their markers and the constellation is charted.",
            caption: `Middle a step, inner a step. Three stars, three landings: ${base(n0) + n0 * perSaved(n0)} points and Swift charting.`,
          },
        },
        {
          title: "Mind the threes",
          body: `Three loose stars of a kind in a row clear, for ${c.runPoints} points. In a floor that is a hole, and the star above the hole slides into it. Keep like stars apart when you lay supports. Use the rule on purpose only for clutter: a third star of a kind landed in line with two strays takes all three away.`,
        },
      ],
      drill: `Open each round by laying the floor, filling inner markers as you go. You are there when the floor is down by the tenth star and a round passes ${p.thresholds[3]!.score} points.`,
    },
    {
      level: "expert",
      goal: "Chart every constellation with stars to spare, and carry the chain to the end of the round.",
      tips: [
        {
          title: "Count the landings",
          body: `Every landing under 2n pays n × ${c.starPoints}, and a support star you had to bring down is a landing. Supports that were **already there** are free. This is what the floor is for: a constellation of ${n0 + 2} charted with ${n0 + 2} stars pays ${base(n0 + 2)} + ${(n0 + 2) * perSaved(n0 + 2)}. A turn can chart with no landing at all, and that saves the most.`,
          media: {
            kind: "clip",
            name: "swift",
            alt: "Three markers sit on the inner ring. Three stars are brought down one after another, each onto its own marker, and the constellation is charted with the Swift charting callout.",
            caption: `No star wasted: ${n0} markers in ${n0} landings pay ${base(n0) + n0 * perSaved(n0)} instead of ${base(n0)}.`,
          },
        },
        {
          title: "Read the new constellation before the next star",
          body: `About ${c.reuseChancePercent === 50 ? "half" : `${c.reuseChancePercent}%`} of new markers copy the kind of a star that is already on the chart. When a constellation is dealt, look for the markers your strays can fill by a turn alone, and make those turns first. Keep strays on rings that still turn freely, not buried under other stars.`,
        },
        {
          title: "Guard the chain",
          body: `The ${ordinal(c.chainPercent.length)} constellation in a row, and every one after it, is worth ×${chainMax}. By then they are large: ${c.maxStars} markers are ${base(c.maxStars)} points before the chain doubles them. A lost heading late in a round costs far more than its ${c.lostHeadingPenalty} points. Never bring a star down on a full top column to save time.`,
        },
        {
          title: "Decide before the star appears",
          body: `By the end of the round a star falls in ${seconds(c.fallTicksMin)} seconds. Know where the next star goes while you are still turning for this one, so each drop is a tap and not a thought. If a star has no use, drop it at once on the inner ring and move on.`,
        },
      ],
      drill: `Play for Swift charting on every constellation and a chain that never breaks. You are there when a round passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    "**Watching the star fall.** Set the rings, then bring it down. Waiting is the most expensive habit in the puzzle.",
    "**Leaving a ring turned away.** A constellation is charted only when every marker holds at once. After a drop, turn the ring home.",
    "**Carrying an outer star over a hole.** It slides in and now sits on the wrong ring. Check there is a star under every step of the way.",
    "**A star left in the top outer slot.** Turn the outer ring a step before the next star comes.",
    "**Three of a kind side by side in the floor.** They clear, and whatever stood on them slides down.",
  ],
};
