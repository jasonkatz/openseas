import { BATTLE_PERMILLE } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.battle;
const c = p.config;
const supply = c.supply ?? { left: 0, forward: 0, right: 0, turrets: 0 };
const board = c.boards[0]!;
/** Hull a knock costs, in percent of a whole hull. */
const hull = (permille: number): number => Math.round((permille * 100) / BATTLE_PERMILLE);
/** Hits that bring a sound hull to where it can be boarded, and the same with one ram already in it. */
const hitsToBoard = Math.ceil(c.grappleDamage / c.shotDamage);
const hitsAfterRam = Math.ceil((c.grappleDamage - c.ramDamage) / c.shotDamage);
/** Loads you open with, and the raider's: both start with `startLoaded` and take their first reload. */
const openingLoads = Math.min(c.turrets, c.startLoaded + supply.turrets);
const herOpeningLoads = Math.min(c.raider.turrets, Math.min(c.raider.turrets, c.startLoaded) + c.raider.reloadPerTurn);
/** What a win on a turn pays before hits. */
const winOn = (turn: number): number => c.winPoints + c.turnBonus * (c.maxTurns - turn);
const top = p.thresholds[p.thresholds.length - 1]!.score;
/** The last turn a clean boarding (the hits it needs, none taken) still clears the top threshold. */
const topTurn = Math.floor(c.maxTurns - (top - c.winPoints - hitsToBoard * c.hitPoints) / c.turnBonus);

export const battle: Guide = {
  id: "battle",
  tagline: "Plot your moves and broadsides, fly them as the raider flies hers, then board her.",
  hero: {
    kind: "still",
    name: "board",
    alt: "The Space Battle board: a chart of asteroids, solar currents and gravity wells with your pale ship at the bottom and the dark raider at the top, and below it four move slots, the token tray and the Fly the plot button.",
    caption: "The chart above, your plot below. The ghosts show where each move leaves you.",
  },
  theme: {
    setting:
      "You are the captain at the chart table. A raider has hailed and you chose to fight. Each turn you plot the ship's course and her broadsides, and the raider plots hers at the same moment. Nobody sees the other's plot until both fly.",
    purpose:
      "This is where the crew's work is spent. Engines make your move tokens, Gunnery loads your turrets, Plating mends your hull and Navigation adds tokens. Win, and the crew boards the raider for the melee that decides the plunder. Lose, and the fight pays nothing.",
  },
  facts: [
    { label: "Chart", value: `${board[0]!.length} by ${board.length} cells, one of ${c.boards.length}` },
    { label: "Fight", value: `${c.maxTurns} turns, ${c.turnSeconds} seconds to plot each` },
    { label: "Rated against", value: "The raider, head to head" },
    { label: "To board her", value: `${hitsToBoard} hits, then a move alongside` },
  ],
  rules: [
    `Every turn in practice you are dealt ${supply.left} left, ${supply.forward} forward and ${supply.right} right **token**. Tokens you do not fly stay with you, up to ${c.tokenCap} of a kind. A turn is up to ${c.segments} moves.`,
    "Forward flies one cell. A left or right flies one cell forward and **then** swings the ship a quarter turn, so she never turns on the spot. A **hold** stays put.",
    "Both ships fly at once, move by move. After each move a **solar current** carries a ship one cell the way it points, a **gravity well** spins her a quarter turn clockwise, and then the turrets fire.",
    `Turrets fire to **port** (her left) or **starboard** (her right), never ahead. A shot reaches ${c.turretRange} cells and stops at an asteroid. Each shot spends a loaded turret. You load ${supply.turrets} a turn and hold ${c.turrets}.`,
    `A hit costs ${hull(c.shotDamage)}% of a hull. Flying or drifting into an asteroid costs ${hull(c.asteroidDamage)}%. A ram costs both ships ${hull(c.ramDamage)}%.`,
    `A ship at ${hull(c.grappleDamage)}% hull or worse can be **boarded**: end a move in one of the four cells next to hers with the grapple set, and the fight is won. A hull at zero is crippled, which ends it too.`,
    `You have ${c.turnSeconds} seconds to plot. When they run out the plot flies as it stands. After ${c.maxTurns} turns the raider breaks off and nobody wins.`,
  ],
  rulesMedia: {
    kind: "clip",
    name: "plot",
    alt: "Three tokens fill the first three move slots, forward, forward and left, while numbered ghosts of the ship appear along the course. A starboard turret is armed on the third slot, the plot flies, and both ships move at once.",
    caption: "Forward, forward, left, a starboard broadside on the third move, then fly. Both ships move together.",
  },
  controls: [
    { action: "Plot a move", touch: "Tap a token: Left, Forward, Right or Hold. It fills the picked slot and the pick moves to the next empty one", desktop: "Click a token, or A, W, D for left, forward, right and S to hold. The arrow keys do the same" },
    { action: "Change a move", touch: "Tap its slot, then a token. Tap the picked slot again to take its move back", desktop: "Click the slot, or press 1 to 4 to pick it, then a token" },
    { action: "Fire a broadside", touch: "Tap the port or starboard turret under a slot. Tap again to stand it down", desktop: "Click the turret, or Q for port and E for starboard on the slot you last plotted or picked" },
    { action: "Take back", touch: "The backspace button takes the last move. Clear takes the whole plot", desktop: "Backspace, and Escape for the whole plot" },
    { action: "Set the grapple", touch: "Tap Grapple. It lasts one turn", desktop: "G" },
    { action: "Fly before the clock", touch: "Tap Fly the plot", desktop: "Enter or Space" },
  ],
  scoring: [
    `**Hits score as a margin.** Each hit you land is ${c.hitPoints} points and each hit you take costs ${c.hitTakenPoints}. The score never drops below zero.`,
    `**The win is the score.** Boarding or crippling her pays ${c.winPoints}, plus ${c.turnBonus} for every turn left of the ${c.maxTurns}. A win on turn 3 pays ${winOn(3)}. A win on turn 12 pays ${winOn(12)}.`,
    "No win, no bonus. If she boards you, cripples you or breaks off, you keep only your hit margin.",
    "Aboard a ship, a tougher raider scales every point up and an easy one scales it down.",
  ],
  stages: [
    {
      level: "beginner",
      goal: "Fly a clean course, get a broadside on her, and finish the fight by boarding.",
      tips: [
        {
          title: "Read the ghosts before you fly",
          body: "Every move you plot draws a numbered ghost where it leaves the ship, drift from currents and wells included. A **red ring** means that move costs hull: an asteroid, or a ram. Change the move until the ring goes. A token is spent even when the move is blocked.",
          media: {
            kind: "still",
            name: "ring",
            alt: "A plotted course of three moves. The third ghost sits beside an asteroid and carries a red numbered badge and a red ring.",
            caption: "The third move flies into the asteroid. The board rings it red before you fly it.",
          },
        },
        {
          title: "Put her beside you, not ahead",
          body: `Your guns point sideways. A raider dead ahead is safe from you. Fly so that she ends a move within ${c.turretRange} cells off your port or starboard side, in a straight line with no asteroid between. The shaded cells show where each armed turret reaches.`,
        },
        {
          title: "One side at a time",
          body: "There is one raider, so only one side can hit on any move. Arming both turrets on a slot spends two loads for one chance. Pick the side she will be on and keep the other load for a later move.",
        },
        {
          title: "Finish with the grapple",
          body: `${hitsToBoard} hits bring a sound raider to ${hull(c.grappleDamage)}% hull. Her hull bar gains a bright outline and the Grapple button pulses. Set the grapple and end any move in one of the four cells next to hers. Setting it costs nothing, and it clears every turn, so set it again.`,
        },
      ],
      drill: `Fly three fights where no move of yours ever shows a red ring. You are there when you board her and the round ends above ${p.thresholds[2]!.score} points.`,
    },
    {
      level: "intermediate",
      goal: "Win sooner. Every turn you save is worth nearly a hit.",
      tips: [
        {
          title: "Aim where she will be",
          body: "Guns fire after **both** ships have moved, so the cell she sits in now is the wrong target. The practice raider closes on you. Lay your shaded cells across the path between her and you, on the move she should arrive there.",
          media: {
            kind: "clip",
            name: "lead",
            alt: "The captain's plot shades empty cells beside the course. The plot flies, the raider flies into those cells, and both broadsides hit: her hull drops to 76 percent.",
            caption: "Both broadsides were plotted over empty space. She flew into them.",
          },
        },
        {
          title: "Never sit on a full rack",
          body: `You load ${supply.turrets} turrets a turn and hold ${c.turrets}. With all ${c.turrets} loaded, the next reload is wasted. You open the fight with ${openingLoads}, so fire at least ${supply.turrets} on the first turn, even on a likely path rather than a sure one.`,
        },
        {
          title: "A hold can fire",
          body: `A slot needs no move to fire. When she ends a move inside your reach and is likely to stay, plot holds and arm the same side on each. That is up to ${c.segments} shots in a turn without spending a token.`,
        },
        {
          title: "Bank tokens for the turn that matters",
          body: `A turn deals ${supply.left + supply.forward + supply.right} tokens but only ${supply.forward} forward. A quiet turn of holds leaves you ${supply.forward * 2} forward next turn, enough to cross the gap and still turn your side to her.`,
        },
      ],
      drill: `Before each turn, point at the cell you think she will end in, then check. You are there when you board her by turn 8, which pays ${winOn(8)} before hits.`,
    },
    {
      level: "advanced",
      goal: "Read the raider, and use the chart to move for free.",
      tips: [
        {
          title: "Never fly the same plot twice",
          body: "The raider plots against two guesses: that you repeat last turn's moves, and that you sit still. She lines her broadside up on both. In test fights a repeated plot was hit far more often than a fresh one, and a ship that held in place was hit more often too. Change the shape of your course every turn.",
        },
        {
          title: "Count her lamps",
          body: `The lamps beside each hull bar are loaded turrets. The practice raider opens with ${herOpeningLoads} and reloads ${c.raider.reloadPerTurn} a turn to your ${supply.turrets}. The red outline is her reach from where she stands, and it vanishes when her lamps are dark. That is the turn to close.`,
        },
        {
          title: "Currents and wells are free moves",
          body: "A ship that holds on a current still drifts a cell every move. A ship that holds on a well swings a quarter turn every move, which brings a broadside round with no token spent. The ghosts show the drift. Both also carry the raider, so read her drift too.",
        },
        {
          title: "Guard your own half hull",
          body: `She sets her grapple every turn. At ${hull(c.grappleDamage)}% hull or worse, any move that ends touching her loses the fight, unless she is boardable too and your hull is the sounder. Then you board her. Count both bars before you close.`,
        },
      ],
      drill: "Play fights where no two of your turns in a row use the same moves, and say her lamp count aloud before you plot. You are there when you win with two hits taken or fewer.",
    },
    {
      level: "expert",
      goal: "Take the hit and the boarding in one move, and count the fight in turns.",
      tips: [
        {
          title: "The last hit and the grapple in one move",
          body: `On each move the guns fire first and the grapple is checked after. When she is one hit short of ${hull(c.grappleDamage)}% hull, end a move directly beside her with a turret armed on that side and the grapple set. The hit lands and you board her on the same move. She never gets the turn to slip away.`,
          media: {
            kind: "clip",
            name: "board-her",
            alt: "The raider is at 52 percent hull. The captain's ship swings in beside her, fires one broadside that takes her to 40 percent, and the fight ends there with the two ships side by side.",
            caption: "She starts at 52% hull, too sound to board. One move ends beside her, the hit lands, and the grapple goes over.",
          },
        },
        {
          title: "A ram is a spare shot",
          body: `A ram costs both hulls ${hull(c.ramDamage)}%. ${hitsAfterRam} hits and a ram bring her to boarding, the same as ${hitsToBoard} hits. Fly into her own cell and you stop next to her, so with the grapple set the ram boards her at once. Do it only while your hull is the sounder.`,
        },
        {
          title: "Count the fight in turns",
          body: `You fire ${openingLoads} on turn 1 and ${supply.turrets} a turn after, so ${hitsToBoard} hits can be in by turn 2. A clean boarding by turn ${topTurn} clears the top mark of ${top}. Each turn later costs ${c.turnBonus} and each hit taken costs ${c.hitTakenPoints}. Do not trade broadsides to save one turn.`,
        },
        {
          title: "Plot while the last turn plays",
          body: `In practice the next ${c.turnSeconds} seconds start as soon as a turn flies, while the board is still playing it back. The ghosts already show the new position. Plot the moves first and the guns second: if the clock beats you, a course without guns is better than guns without a course.`,
        },
      ],
      drill: `Play for the turn count: board her by turn 4 without taking a hit. You are there when a round passes ${top} points.`,
    },
  ],
  mistakes: [
    "**Firing both sides on one move.** Only one side can hit. The other load is gone.",
    "**Aiming at where she is.** She moves before your guns fire. Shade the cells she is flying into.",
    "**Repeating last turn's course.** It is the first thing she plots against.",
    `**Closing at ${hull(c.grappleDamage)}% hull or worse.** If your hull is the weaker, a move that ends touching her is a boarding, and it is hers.`,
    "**Forgetting the grapple.** It clears every turn. A move alongside without it wins nothing.",
  ],
};
