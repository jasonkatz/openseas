import { OVERLOAD_FULL, overloadChainValue, overloadRefundFor } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.overload;
const c = p.config;
/** The charge one tap bursts. */
const hot = OVERLOAD_FULL - 1;
/** What a chain of n bursts scores before the streak. */
const v = (n: number): number => overloadChainValue(c, n);
const regenSeconds = (c.tapRegenTicks * c.tickMs) / 1000;
const streakStep = c.streakPercent[1]! - c.streakPercent[0]!;
const streakMax = c.streakPercent[c.streakPercent.length - 1]! / 100;
/** Long chains in a row before the streak stops growing. */
const streakFull = c.streakPercent.length;
const boosterOneIn = Math.round(1000 / c.boosterPermille);
/** The shortest chain that gives back two taps: its own and the charge that set it up. */
const paysForTwo = c.refundEvery * 2;

export const overload: Guide = {
  id: "overload",
  tagline: "Charge a capacitor until it bursts into its neighbours. Make it one long chain.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Overload board: a bank of capacitors ${c.width} wide and ${c.height} tall, each a ring lit in one, two or three parts, with ${c.tapCap} lamps in a strip above for the taps held. Two capacitors have a second ring with four lugs.`,
    caption: `The bank. A lit part of the ring is one charge, a bolt means ${hot}, and the lamps on top are your taps.`,
  },
  theme: {
    setting:
      "The ship's capacitor bank is charged past what it can hold. You are the pirate at the panel with a few spare charges in hand, picking the one capacitor that tips a whole cluster over. Each one that bursts dumps its charge into the ones beside it.",
    purpose:
      "Overload is a **prototype**: it is played on the test bench and is in no ship yet. It is trying out a chain reaction you can read in full before you touch it, with taps too scarce to spend on guesses. The skill it asks for is reading, then holding back until the chain is worth it.",
  },
  facts: [
    { label: "Bank", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Taps", value: `Hold ${c.tapCap}, one back every ${regenSeconds} seconds` },
    { label: "Status", value: "Prototype, on the test bench" },
  ],
  rules: [
    `Every capacitor holds 0 to ${hot} charges. A tap adds one, and costs one of the taps you hold.`,
    `A capacitor that reaches ${OVERLOAD_FULL} **bursts**: it empties and passes one charge to each neighbour above, below, left and right. Charge passed off the edge of the bank is lost.`,
    `A neighbour that reaches ${OVERLOAD_FULL} bursts in the next wave, and so on. Everything one tap sets off is one **chain**.`,
    "A capacitor bursts once in a chain. After that it is spent, and charge passed to it is lost.",
    "When the chain ends, every spent capacitor is swapped for a fresh one with a random charge. The ones that were passed charge and did not burst keep it.",
    `You hold up to ${c.tapCap} taps and one comes back every ${regenSeconds} seconds. A full hand banks nothing.`,
    `A **booster** has a second ring with four lugs. It passes two charges to each neighbour when it bursts. About one fresh capacitor in ${boosterOneIn} is a booster.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-burst",
    alt: "A capacitor showing a bolt is tapped and bursts, sparks fly to its four neighbours, and two of them burst in the waves that follow. The strip above counts the chain to three.",
    caption: `Tap a capacitor at ${hot}. It bursts into its neighbours, and the ones that fill burst next.`,
  },
  controls: [
    { action: "Charge a capacitor", touch: "Tap it", desktop: "Click it" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
    { action: "Charge at the cursor", touch: "", desktop: "Space or Enter" },
    { action: "Finish a chain that is still playing", touch: "Tap the next capacitor", desktop: "Click the next capacitor, or press Space" },
  ],
  scoring: [
    `**A chain scores its length times itself.** ${[2, 4, 6, 10].map((n) => `${n} bursts is ${v(n)}`).join(", ")}. One chain of ten beats two of five by ${v(10)} to ${2 * v(5)}.`,
    `A chain of ${c.streakMin} or more builds a **streak** that multiplies the chain: +${streakStep}% each, up to ×${streakMax} from the ${ordinal(streakFull)} in a row. A shorter chain breaks it. A tap that bursts nothing does not.`,
    `Every ${c.refundEvery} bursts in a chain give a tap back, up to a full hand. A chain of ${c.refundEvery} pays for its own tap.`,
    `Past ${c.chainCap} bursts a chain stops growing so fast: each further burst adds ${c.chainCap}.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Know what a tap will set off before you make it, and stop spending taps on guesses.",
      tips: [
        {
          title: "Read the ring",
          body: `A capacitor's charge is the number of lit parts of its ring, and at ${hot} its core shows a bolt. Only a bolt bursts from one tap. The **marks** setting draws the charge as a digit if you would sooner read numbers.`,
        },
        {
          title: "Touching bolts all go",
          body: `A burst passes one charge to each neighbour, so a ${hot} beside it goes too, and the ${hot} beside that. Before you tap, trace the bolts that touch. Tap the group with the most in it: any bolt in the group sets off all of it.`,
          media: {
            kind: "still",
            name: "read-before",
            alt: "A bank before a tap, with several capacitors showing bolts side by side in one cluster and others scattered alone.",
            caption: "Before the tap. Find the bolts that touch, then count what they reach.",
          },
        },
        {
          title: "Count the neighbours too",
          body: `A capacitor goes when its charge plus its bursting neighbours reach ${OVERLOAD_FULL}. So a ${hot - 1} between two bursts goes, and a ${hot - 2} among three. This is how a chain turns a corner, and it is all there to read before the tap.`,
          media: {
            kind: "clip",
            name: "read",
            alt: "The same bank. One bolt is tapped and the chain runs through the cluster wave by wave, taking capacitors with two charges that sat between two bursts. The strip counts the chain up.",
            caption: "The same bank, one tap. The strip counts the bursts and what that many are worth.",
          },
        },
        {
          title: "Taps are scarce",
          body: `Taps come back one every ${regenSeconds} seconds, and not at all while you hold ${c.tapCap}. Wild tapping empties the hand, and then every tap is a ${regenSeconds} second wait. A tap you have read rarely costs you: a chain of ${c.refundEvery} gives it back.`,
        },
      ],
      drill: `Before every tap, say the number of bursts it will make, then watch the strip count. In practice rounds a pause brings up a ring on a tap worth making: check your pick against it. You are there when your count is right most of the time and a round passes ${p.thresholds[1]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: `Never set off a chain shorter than ${c.streakMin}. This one habit nearly doubles a round.`,
      tips: [
        {
          title: `Short of ${c.streakMin}, do not fire`,
          body: `About half the time no single tap on the bank reaches ${c.streakMin}. Taking the best one anyway scores ${v(3)} or less and breaks the streak, which was about to multiply everything after it. A streak of ${streakFull} makes a plain chain of ${c.streakMin} worth ${Math.floor(v(c.streakMin) * streakMax)} instead of ${v(c.streakMin)}.`,
        },
        {
          title: "Charge first",
          body: `A tap that bursts nothing still adds a charge, and it does not touch the streak. Look for the capacitor at ${hot - 1} that sits against a cluster and tap it up to ${hot}. Or lift the one between two bolts so the first burst carries to the second. Then fire.`,
          media: {
            kind: "clip",
            name: "charge-first",
            alt: "No tap on the bank reaches four. One capacitor is tapped and only gains a charge. The next tap, on a bolt beside it, sets off a chain that the strip counts past four.",
            caption: `One tap to charge, one to fire. The first bursts nothing, so the streak is safe.`,
          },
        },
        {
          title: "Long chains pay for their taps",
          body: `A chain of ${c.refundEvery} gives its tap back. A chain of ${paysForTwo} gives back ${overloadRefundFor(c, paysForTwo)}: its own and the charge that set it up. Play this way and the hand stays near full all round, so charging first costs you a moment and never a tap.`,
        },
      ],
      drill: `Play a round where the only rule is that no chain is shorter than ${c.streakMin}. Charge whenever you must. You are there when the strip reads full streak before the round is half gone and the score passes ${p.thresholds[3]!.score}.`,
    },
    {
      level: "advanced",
      goal: "Join clusters with one charge, and know when the join is worth the tap.",
      tips: [
        {
          title: "The join",
          body: `Two clusters often sit one capacitor apart. Set them off one at a time and two sixes pay ${2 * v(6)}. Put one charge on the capacitor between them and the same two taps make one chain of twelve for ${v(12)}. The bridge is often a ${hot - 1}: one cluster alone only lifts it to ${hot}, so charge it first.`,
          media: {
            kind: "clip",
            name: "join",
            alt: "Two clusters of charged capacitors sit apart with one capacitor between them. That capacitor is tapped and only gains a charge. The next tap sets off one cluster, the chain crosses the charged capacitor into the other, and the board calls out Overload.",
            caption: "One charge on the capacitor between, then one tap takes both clusters.",
          },
        },
        {
          title: "Join big or not at all",
          body: `A charge is a turn that scores nothing, and a very long chain leaves a cold patch of fresh capacitors behind it. In bot rounds, charging for every small gain scored at least a fifth less than never joining. Charging only when it about doubles a chain of six or more scored a little more. If a chain of ${c.streakMin} or more is ready and the join is small, fire.`,
        },
        {
          title: "Boosters carry a chain through twos",
          body: `A booster passes two charges, so the ${hot - 1}s beside it go from that burst alone, and a ${hot - 2} beside it needs only one more bursting neighbour. Find the boosters first on every new bank. A booster at ${hot - 1} against a cluster is a charge worth making: lift it to ${hot} and the cluster sets it off.`,
          media: {
            kind: "clip",
            name: "booster",
            alt: "A chain reaches a booster, a capacitor with a second ring and four lugs. It bursts with heavier sparks and the capacitors with two charges around it burst in the next wave, carrying the chain on.",
            caption: "The chain reaches the booster and the twos around it go at once.",
          },
        },
      ],
      drill: `Each time a chain ends, find the two biggest clusters and the capacitor between them before you look at anything else. You are there when a round has two or three chains of ten or more without the streak breaking, and passes ${p.thresholds[4]!.score}.`,
    },
    {
      level: "expert",
      goal: `Play every chain at ×${streakMax}, and make more of them: time is now the only limit.`,
      tips: [
        {
          title: "Pace is score",
          body: `Once every chain is ${c.streakMin} or more, taps stop running out and the clock is all that holds you back. A bot that taps once a second scores half as much again as the same bot tapping every second and a half. A sure chain of ${c.streakMin} now beats a perfect one found late.`,
          media: {
            kind: "clip",
            name: "tempo",
            alt: "Four taps in a row, each on a different cluster, each a chain of four or more. The strip shows the streak climb one step with every chain and a tap come back each time, so the hand stays full.",
            caption: `Four taps, four chains of ${c.streakMin} or more. The streak climbs each time and every chain gives its tap back.`,
          },
        },
        {
          title: "Read while the chain plays",
          body: "The bank after a chain is already decided, except for the fresh capacitors. Watch the rim of the chain as it runs: those capacitors were passed charge and kept it, so the next cluster is usually there. A tap during a chain finishes it at once, so you never have to wait for the show.",
        },
        {
          title: "Climb fast, then go big",
          body: `The streak counts chains, not their length. Take quick chains of ${c.streakMin} to ${c.streakMin + 2} until the strip reads ×${streakMax}, which takes ${streakFull} of them. Save the joins for after: a chain of twelve is ${v(12)} on the first step of the streak and ${Math.floor(v(12) * streakMax)} at the top.`,
        },
        {
          title: `Past ${c.chainCap} it flattens`,
          body: `Up to ${c.chainCap} bursts each one is worth more than the last. Past that each adds a flat ${c.chainCap}, and a chain that takes most of the bank leaves nothing hot to follow it. Do not spend charges stretching a chain beyond ${c.chainCap}. Start the next one.`,
        },
      ],
      drill: `Play rounds where you tap the next chain before the last one has finished playing, and never break the streak to do it. You are there when a round passes ${p.thresholds[5]!.score} points.`,
    },
  ],
  mistakes: [
    `**Firing a chain of two or three.** It scores almost nothing and resets the streak to the start. Charge one capacitor and make it ${c.streakMin} or more.`,
    `**Tapping to see what happens.** Every chain can be read before the tap. Guessing empties the hand and then you wait ${regenSeconds} seconds a tap.`,
    "**Firing the first bolt you see.** The biggest group of touching bolts costs the same one tap. Look once round the bank before you spend it.",
    "**Charging for a small gain.** A charge is a turn without a chain. Spend it to reach the streak or to join two real clusters, not to add one burst.",
    "**Waiting for the chain to finish.** The next tap is allowed at once. Have it picked before the sparks stop.",
  ],
};

function ordinal(n: number): string {
  return ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;
}
