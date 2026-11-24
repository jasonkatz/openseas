import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.showdown;
const c = p.config;
const style = (k: keyof typeof c.play): string => k[0]!.toUpperCase() + k.slice(1);

export const showdown: Guide = {
  id: "showdown",
  tagline: "Fixed-limit hold'em against rivals who each play one way. Learn them, outlast them.",
  hero: {
    kind: "still",
    name: "table",
    alt: `The Showdown table: ${c.rivals} rivals round the top, each with two cards face down, its chips, an emblem and a name for the way it plays, the five cards of the middle with the pot under them, and your two cards face up at the foot over three buttons: fold, call and raise.`,
    caption: "A hand just dealt: the blinds are in, a rival has raised, and it is your turn.",
  },
  theme: {
    setting:
      "Between jobs the crew plays cards in the mess, for chips nobody admits to keeping count of. Three regulars sit in, and each of them has played the same way for years. Everyone buys in for the same small stack, and the game runs until one player holds them all.",
    purpose:
      "Showdown is a prototype. It is on no ship yet. It tries out a parlor game played against rivals in the engine, where reading the other players matters as much as the cards.",
  },
  facts: [
    { label: "Table", value: `You and ${c.rivals} rivals` },
    { label: "Chips", value: `${c.stack} each to start; out when they are gone` },
    { label: "Bets", value: `${c.smallBet} early, ${c.bigBet} late, ${c.raiseCap} a street at most` },
    { label: "Rated against", value: "The rivals you outlast, and how fast you win" },
  ],
  rules: [
    "You are dealt two cards face down. Five more turn face up in the middle: three at once, then one, then one. Your **hand** is the best five of your two and the five.",
    `Before the first three turn, the two seats after the **button** put in the **blinds**, ${c.smallBlind} and ${c.bigBlind}. Then each seat in turn **folds**, **calls** what has been bet, or **raises** by one more bet. With nothing to call, a call is a **check** and a raise is a **bet**.`,
    `Bets are fixed: ${c.smallBet} before and on the first three cards, ${c.bigBet} on the fourth and fifth. A street takes ${c.raiseCap} bets at most, the big blind counted.`,
    "A street ends when everyone still in has put in the same. The last seat in takes the **pot**. If more than one is left after the fifth card, they show their cards and the best hand takes it. Equal hands share.",
    "Hands from best: a straight flush, four of a kind, a full house, a flush, a straight, three of a kind, two pairs, a pair, high card.",
    "If you cannot cover a bet, you put in all you have: you are **all in**. You bet no more that hand, and you can win from each player only as much as you put in. The rest is a side pot for the others.",
    `Everyone starts with ${c.stack} chips. A player with none left after a hand is **out**. You lose when you are out, and win when every rival is. Each rival plays one way all game, and its seat says which.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "flop",
    alt: "You call the bet. The rivals act in turn, each seat saying what it did, and three cards turn face up in the middle of the table.",
    caption: "You call, the table acts in turn, and the first three cards turn.",
  },
  controls: [
    { action: "Fold", touch: "Tap Fold", desktop: "Click Fold, or press F or 1" },
    { action: "Call or check", touch: "Tap the middle button", desktop: "Click it, or press C or 2" },
    { action: "Raise or bet", touch: "Tap the right button", desktop: "Click it, or press R or 3" },
    { action: "Deal the next hand", touch: "Tap Next hand", desktop: "Click it, or press Space or Enter" },
  ],
  scoring: [
    `**${c.knockout} points for every rival out** while you are still in, and when you are out the round is over.`,
    `**Win the table and score ${c.speed} more for every hand under ${c.hands} it took.** A quick win is worth more than a slow one.`,
    `**After ${c.hands} hands with others still in,** every rival holding fewer chips than you counts as beaten.`,
    "**Leave early and you keep only the rivals already out.**",
  ],
  stages: [
    {
      level: "beginner",
      goal: "Fold the hands that lose, and keep the chips you would have thrown after them. With only a few chips, every one you keep is time at the table.",
      tips: [
        {
          title: "Most hands are folds",
          body: "Two small cards that do not match or run together lose more often than not. Fold them before the first three cards, and you lose at most a blind.",
          media: {
            kind: "clip",
            name: "fold",
            alt: "You fold two small cards. Your cards dim, and the rest of the hand plays out quickly among the rivals until one of them takes the pot.",
            caption: "Fold, and the rest of the hand plays out without you.",
          },
        },
        {
          title: "Pairs and big cards play",
          body: "A pair, two high cards, or an ace with anything of its suit are worth a call. Everything else waits for a better deal.",
        },
        {
          title: "Check when it is free",
          body: "With nothing to call, checking costs nothing. Fold never helps there, and the board does not offer it.",
        },
      ],
      drill: "Fold everything but pairs and two high cards for a whole game. You are there when you regularly outlast a rival.",
    },
    {
      level: "intermediate",
      goal: "Bet your good hands, and weigh a call against the pot.",
      tips: [
        {
          title: "Bet what is good",
          body: "When you hold the best hand, make the others pay to stay. A check lets them see the next card for nothing.",
        },
        {
          title: "The price of a call",
          body: "The pot is shown under the middle. A call that costs one chip into a pot of nine needs to win one time in ten; one that costs two into three needs four times in ten. A hand one card from a flush wins about one time in five on the next card.",
        },
        {
          title: "Late bets are double",
          body: `From the fourth card on a bet is ${c.bigBet}, not ${c.smallBet}. Decide on the first three whether the hand is worth going on with.`,
        },
      ],
      drill: "Before each call, say the pot and the price out loud. You are there when you regularly outlast two rivals.",
    },
    {
      level: "advanced",
      goal: "Play each rival the way it plays.",
      tips: [
        {
          title: `The ${style("sponge")} calls`,
          body: `A ${style("sponge")} calls nearly anything, so never bluff it. Bet every good hand into it, even the middling ones: it pays them off.`,
          media: {
            kind: "clip",
            name: "showdown",
            alt: "On the last card you call, the seats still in show their cards, the cards that made the winning hand stay bright while the rest dim, and the pot goes to the winner.",
            caption: "The cards are shown, and the five that won stay lit.",
          },
        },
        {
          title: `The ${style("brick")} folds`,
          body: `A ${style("brick")} plays only good cards and folds to a bet without them. When it alone is left and checks, bet: it usually folds. When it raises, believe it.`,
        },
        {
          title: `The ${style("hothead")} bets anything`,
          body: `A ${style("hothead")} bets and raises with far less than it should. Call it down with a fair hand, and let it bet into your good ones.`,
        },
      ],
      drill: "For a game, write down each rival's style before the first hand and change one thing you do against each. You are there when you win the table more often than not.",
    },
    {
      level: "expert",
      goal: "Set the trap: check, let them bet, then raise.",
      tips: [
        {
          title: "Check-raise",
          body: `With a strong hand and a ${style("hothead")} to act after you, check. It bets, the others call, and you raise. The pot holds a bet more from each of them than if you had bet yourself. A check-raise that takes the pot is the move this table pays most for.`,
        },
        {
          title: "Pick the street",
          body: `Spring it on the fourth card, where a bet is ${c.bigBet}: every chip it adds counts double.`,
        },
        {
          title: `The ${style("shark")}`,
          body: `A ${style("shark")} plays its cards against the price, like you. Leave it the pots it wants and take yours from the others.`,
        },
      ],
      drill: `Win a pot with a check-raise in every game. You are there when you win the table in under ${Math.round(c.hands - (p.thresholds[4]!.score - c.rivals * c.knockout) / Math.max(1, c.speed))} hands.`,
    },
  ],
  mistakes: [
    "**Calling every hand to the end.** Most of them lose, and each costs a bet a street. The others are happy to take it.",
    "**Raising every hand.** It wins the small pots and loses the big ones: the rivals with good cards raise back.",
    `**Bluffing the ${style("sponge")}.** It calls. Bluff the ${style("brick")} instead.`,
    "**Going all in on hope.** A short stack still has time: a blind costs little, and folding keeps you in the game for a better hand.",
  ],
};
