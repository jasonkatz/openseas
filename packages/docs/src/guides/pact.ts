import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.pact;
const c = p.config;

export const pact: Guide = {
  id: "pact",
  tagline: "Spades with a partner. Bid the tricks your side will take, then take them, and no more.",
  hero: {
    kind: "still",
    name: "table",
    alt: "The Pact table: your partner across the top, a rival on each side with its bid and its tricks, three cards of a trick in the middle, and your hand of thirteen cards in two rows at the foot, the cards you may play standing proud.",
    caption: "The first trick, and your card to play: follow the suit led if you can.",
  },
  theme: {
    setting:
      "Between jobs the crew plays cards in the mess, two against two, for bragging rights. You and your partner sit across from each other and promise the table a number of tricks. Then you have to take them.",
    purpose:
      "Pact is a prototype. It is on no ship yet. It tries out a parlor game for four, played with a partner and against rivals in the engine, where what you promise matters as much as the cards.",
  },
  facts: [
    { label: "Table", value: "You and a partner against two rivals" },
    { label: "Sitting", value: `${c.hands} hands of thirteen tricks` },
    { label: "Pact", value: `${c.trickValue} a trick bid, ${c.bagValue} a trick over` },
    { label: "Rated against", value: "Your side's points" },
  ],
  rules: [
    "Each of the four seats is dealt thirteen cards. Your **partner** sits across from you; the seats on either side are your rivals.",
    "First everyone **bids** the tricks they mean to take, or **nil** for none. Your bid and your partner's added up are your side's **pact**.",
    "Then each seat plays one card in turn. You must **follow** the suit led if you can. The highest card of that suit takes the **trick**, and whoever takes it leads the next.",
    "**Spades are trumps:** any spade beats every other suit, and the highest spade takes the trick. Nobody may lead a spade until one has been played on another suit, unless they hold nothing else.",
    `Take at least your pact and your side scores ${c.trickValue} for each trick of it. Fall short and the hand scores nothing for you.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "trick",
    alt: "You play the last card of a trick. The four cards stay on the table a moment with the winning one ringed, then slide to the seat that took it, and its count of tricks goes up by one.",
    caption: "The last card down: the trick waits a moment, then goes to its taker.",
  },
  controls: [
    { action: "Pick a bid", touch: "Tap a number, or Nil", desktop: "Click it, or press a number key (0 is nil); left and right step it" },
    { action: "Make the bid", touch: "Tap the Bid button", desktop: "Click it, or press Space or Enter" },
    { action: "Play a card", touch: "Tap it in your hand", desktop: "Click it, or pick it with left and right and press Space or Enter" },
    { action: "Deal the next hand", touch: "Tap Next hand", desktop: "Click it, or press Space or Enter" },
  ],
  scoring: [
    `**Make the pact:** ${c.trickValue} for each trick of it, and ${c.bagValue} for each trick over. A trick over is a **bag**, and every ${c.bagLimit} bags your side gathers cost ${c.bagPenalty}.`,
    `**Nil:** a seat that bids nil and takes no trick scores ${c.nilBonus}. One that takes a trick loses ${c.nilBonus}.`,
    `**Set the rivals:** when they fall short of their pact, your side scores ${c.setBonus} for each trick they bid.`,
    "**A hand never scores below zero.** Whatever your side's count comes to, it adds that or nothing: your total only climbs.",
  ],
  stages: [
    {
      level: "beginner",
      goal: "Follow suit, and spend your high cards only where they take a trick.",
      tips: [
        {
          title: "Low behind your partner",
          body: "When your partner is already taking the trick, play your lowest card of the suit. A high card there wins nothing your side has not already won.",
        },
        {
          title: "Low on a lost trick",
          body: "When a rival has played a card you cannot beat, play your lowest. Keep the good cards for tricks they can take.",
        },
        {
          title: "Spades are for trumping",
          body: "With none of the suit led, a low spade takes the trick from any card of it. That is what short suits are for.",
        },
      ],
      drill: `Play a sitting bidding just your aces and your spades over three. You are there when your side scores more than ${p.thresholds[1]!.score}.`,
    },
    {
      level: "intermediate",
      goal: "Bid what your hand will take.",
      tips: [
        {
          title: "Count your tricks",
          body: "An ace takes a trick. A king with one more card of its suit usually does. Every spade past your third is a trick, and a suit you hold none of lets you trump it.",
          media: {
            kind: "still",
            name: "bid",
            alt: "The bid panel over the table: a row of numbers from nil to thirteen, one picked in amber, with the bids already made beside each seat and the Bid button at the foot.",
            caption: "Your bid: pick a number, then make it. The other seats' bids are already in.",
          },
        },
        {
          title: "Too low costs too",
          body: `A bid you cannot miss is safe, and it pays little: a trick over scores ${c.bagValue}, a trick bid ${c.trickValue}. Bid what you expect to take, not what you are sure of.`,
        },
        {
          title: "Read your partner's bid",
          body: "Your side's pact is both bids together. A partner who bids high holds the cards; play to help them, and do not race them for the same tricks.",
        },
      ],
      drill: `Say your count before you see the other bids, and bid it. You are there when your side scores more than ${p.thresholds[2]!.score}.`,
    },
    {
      level: "advanced",
      goal: "Count the cards, and know when your card is the best left.",
      tips: [
        {
          title: "Remember what has gone",
          body: "Once the ace and king of a suit are played, your queen is the best left and takes the trick. Watch the high cards fall.",
        },
        {
          title: "Watch for voids",
          body: "A seat that did not follow a suit holds none of it, and will trump it if it has spades. Do not lead your king into a void.",
        },
        {
          title: "Pact made, now duck or set",
          body: "Once your pact is made, take a trick only if it stops the rivals making theirs. Otherwise play under: every trick over is a bag.",
          media: {
            kind: "clip",
            name: "count",
            alt: "You play your last card, the trick goes to its taker, and the count of the hand appears: each side's points, its pact taken or short, and its bags.",
            caption: "The last trick, and the hand's count.",
          },
        },
      ],
      drill: "For a sitting, name the best card left in each suit before you lead. You are there when you beat the sharp tier.",
    },
    {
      level: "expert",
      goal: "Make a nil.",
      tips: [
        {
          title: "Know a nil hand",
          body: `No aces, no guarded kings, few spades and all of them low: a hand like that can take nothing. Bid nil, and it is worth ${c.nilBonus}, more than most pacts.`,
        },
        {
          title: "Throw the danger early",
          body: "When you cannot follow, throw your highest card of another suit. When you must follow, play the highest card that still loses. Keep the low ones for the end.",
        },
        {
          title: "Cover a partner's nil",
          body: "When your partner bids nil, play high on any trick they might take, so they never have to. Your bid is the whole of the pact.",
        },
      ],
      drill: `Make a nil in a sitting. You are there when your side scores more than ${p.thresholds[4]!.score}.`,
    },
  ],
  mistakes: [
    "**Bidding only sure tricks.** The pact is made, and the tricks over it pay almost nothing.",
    "**Bidding hopes.** A pact one trick short scores nothing for the whole hand, and pays the rivals.",
    "**Taking your partner's trick.** A high card on a trick your side already has is a trick thrown away later.",
    "**Gathering bags.** Once the pact is made, a trick that does not set the rivals is a step toward a penalty.",
  ],
};
