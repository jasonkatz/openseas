import { scannerContactsFor, scannerParFor } from "@openseas/engine";
import { content } from "../content.js";
import type { Guide } from "./types.js";

const p = content.puzzles.scanner;
const c = p.config;
const streak = c.streakPercent;
const streakStep = streak[1]! - streak[0]!;
const streakMax = streak[streak.length - 1]! / 100;
/** Clean sectors in a row before the streak stops growing. */
const streakFull = streak.length - 1;
const firstPar = scannerParFor(c, c.startContacts);
const lastPar = scannerParFor(c, c.maxContacts);
/** Sectors cleared before a sector holds the most contacts it can. */
const sectorsToMax = (c.maxContacts - c.startContacts) * c.growEvery;
/** What a clean sector of the most contacts pays with `saved` pings left, at a streak multiplier. */
const bigSector = (saved: number, times: number): number => (c.maxContacts * c.contactPoints + saved * c.savePoints) * times;
/** A lock at even odds, with no streak: half a bounty against half a miss. */
const coinFlip = (c.contactPoints - c.wrongPenalty) / 2;
/** The mark, locked first: this many bounties. */
const markTimes = c.markPercent / 100;
/** What the mark adds to a bounty, with no streak. */
const markExtra = (c.contactPoints * (c.markPercent - 100)) / 100;
/** A lock on the mark at even odds, with no streak: half the mark's pay against half a miss. */
const markFlip = (c.contactPoints * markTimes - c.wrongPenalty) / 2;

export const scanner: Guide = {
  id: "scanner",
  tagline: "Ping the fog, read the numbers, and lock each contact where it must be.",
  hero: {
    kind: "still",
    name: "board",
    alt: `The Scanner board: a sector ${c.width} cells wide and ${c.height} tall, most of it flat fog plates. One cell holds a ping showing the number 3 with a small solid tab in its top corner, and the cells around it are bare ground, each with a small dot. A strip above counts pings, the sector and hidden contacts, and a switch below reads Ping and Lock.`,
    caption: "A new sector. One ping is made for you: its number is the steps to the nearest contact, and the cells where the fog has lifted are proven empty. Its tab says it hears the mark.",
  },
  theme: {
    setting:
      "You are the pirate on the ship's scanner, hunting contacts that hide in a fogged sector. Each ping you send comes back as one number: how far the nearest one is. You work out where they sit and lock them one by one, without flushing any.",
    purpose:
      "Scanner is a **prototype**: it is played on the test bench and is in no ship yet. It is trying out a puzzle of pure deduction against a clock, where no sector needs a guess and every mistake is your own. The skill it asks for is choosing the question, not only reading the answer.",
  },
  facts: [
    { label: "Sector", value: `${c.width} wide, ${c.height} tall` },
    { label: "Round", value: `${p.roundSeconds} seconds` },
    { label: "Contacts", value: `${c.startContacts} a sector, growing to ${c.maxContacts}` },
    { label: "Mark", value: `×${markTimes} a bounty, locked first` },
  ],
  rules: [
    `A sector of fog hides ${c.startContacts} contacts. It opens with one ping already made for you, at least ${c.openingMin} steps from every contact, and can be cleared from there with no guess.`,
    "A **ping** on a cell answers with one number: how many steps up, down, left or right, never diagonal, the nearest hidden contact is.",
    "Nothing hides nearer than the number, so the fog **lifts** from every cell closer than that: a clear cell is bare ground with a dot. One contact sits exactly that far away, somewhere on the diamond of cells at that distance: the ping's **ring**.",
    `A **lock** says a contact is here. A right lock finds it and pays. A lock on empty space is a miss, and a ping that lands on a contact **spooks** it for no pay. Either costs ${c.wrongPenalty} and your streak.`,
    "The numbers are live. When a contact is found, every ping that was hearing it sounds again and shows the nearest one still hidden.",
    `Find them all and the next sector is dealt. Every ${c.growEvery} sectors cleared add a contact, up to ${c.maxContacts}.`,
    "One contact a sector is the **mark**. You never see which, but a ping that hears it, with the mark among the contacts nearest it, carries a small **tab** in its top corner. Every tab is set afresh when the numbers sound again.",
  ],
  rulesMedia: {
    kind: "clip",
    name: "first-lock",
    alt: "A clear cell is pinged and answers 2 with a tab in its corner, and the fog lifts from more cells around it. The number is tapped and its ring lights with a pip on the one fog plate it crosses. That plate is held, brackets close on it, and a contact is found there: the mark, called out as Mark found.",
    caption: "Ping a clear cell, tap its number to light the ring, and lock the one cell left on it.",
  },
  controls: [
    { action: "Ping a cell", touch: "Tap it, with the switch on Ping", desktop: "Click it, or Space at the cursor" },
    { action: "Lock a cell", touch: "Long press it, or tap it with the switch on Lock", desktop: "Hold the click on it, or Enter or L at the cursor" },
    { action: "Flip the switch", touch: "Tap its other half", desktop: "Click its other half, or X" },
    { action: "Light a ping's ring", touch: "Tap the number. Tap it again to put it out", desktop: "Click the number. Escape puts it out" },
    { action: "Move the cursor", touch: "", desktop: "Arrow keys or WASD" },
  ],
  scoring: [
    `A lock on a contact pays **${c.contactPoints}**. The mark locked as the sector's first find, before any other contact is found or spooked, pays ${markTimes} bounties. Found later it pays one.`,
    `A sector allows ${c.parPerContact} pings a contact: its **par**. The opening ping is free. Each ping past par costs ${c.overPenalty}.`,
    `A sector cleared within par with no mistake is **clean**. Every ping left over pays ${c.savePoints}, and clean sectors in a row build a streak that multiplies bounties and savings: +${streakStep}% each, up to ×${streakMax} after ${streakFull} in a row. A sector that is not clean ends it.`,
    `A spooked contact or a missed lock costs ${c.wrongPenalty} and ends the streak at once. The score never goes below zero.`,
  ],
  stages: [
    {
      level: "beginner",
      goal: "Clear sectors without one spooked contact or missed lock.",
      tips: [
        {
          title: "Ping clear ground, never the fog",
          body: `A clear cell is proven empty, so a ping there can spook nothing. A ping on fog can land on a contact, and that costs ${c.spookPenalty} and the streak. There is always a clear cell to ping: you never need the risk.`,
        },
        {
          title: "Light the ring",
          body: "Tap any number and its ring lights up. It is a diamond, with a pip on every fog plate it crosses. Those marked cells are the only places the contact it hears can be. When a ring has one marked cell, the contact is there. Lighting a ring is never a move and costs nothing.",
          media: {
            kind: "still",
            name: "ring",
            alt: "The opening ping showing 3 has been tapped. A diamond is drawn three steps out from it, and each fog plate that lies on the diamond carries a pip.",
            caption: "The ring of the opening ping. One of the marked cells holds a contact.",
          },
        },
        {
          title: "Lock with a long press",
          body: `Hold a cell and amber brackets close on it: that is a lock, whatever the switch says. You never have to flip the switch and then forget it. A clear cell refuses a lock for free, but a lock on empty fog costs ${c.wrongPenalty}, so lock only the last marked cell of a ring.`,
        },
      ],
      drill: `Play rounds where you only ever ping clear cells and only lock a ring's last marked cell. In practice rounds a pause brings up a safe move: check yours against it. You are there when a whole round shows no Spooked and no Nothing there, and the score passes ${p.thresholds[0]!.score}.`,
    },
    {
      level: "intermediate",
      goal: "Finish every sector within par, by aiming each ping at a ring.",
      tips: [
        {
          title: "Par is where the points are",
          body: `A sector of ${c.startContacts} allows ${firstPar} pings, and the strip counts them down. Inside par the sector is clean and the streak grows. Pinging whatever clear cell is handy clears every sector, but only about half of them within par.`,
        },
        {
          title: "Aim at the shortest ring",
          body: "Light the ring with the fewest marked cells. Now find a clear cell that is a different number of steps from each of them, and ping it: the answer says which one it is. A ping the same distance from both tells you nothing. Close is best, since a small number has a short ring. This one habit takes clean sectors from about half to more than eight in ten.",
          media: {
            kind: "clip",
            name: "aim",
            alt: "A ping showing 3 is tapped and its ring marks two fog plates. A clear cell right beside one of them is pinged and answers 1. That plate is held and a contact is found there.",
            caption: "Two cells left on the ring. A ping one step from one and three from the other settles it.",
          },
        },
        {
          title: "Count the fog",
          body: "The strip says how many contacts are hidden. When the fog is down to that many cells, every one of them holds a contact. Lock them all without another ping.",
        },
        {
          title: "Read again after every lock",
          body: "A found contact stops answering. Every ping that heard it jumps to a bigger number, and a bigger number lifts more fog. The new clear ground often leaves another ring with one cell, for no ping at all. A number that did not move is still hearing a contact at that distance.",
          media: {
            kind: "clip",
            name: "live",
            alt: "A cell in the fog is held and a contact is found. Four pings around it change to bigger numbers and the fog lifts across the sector.",
            caption: "One lock. The pings that heard it sound again, and more fog lifts.",
          },
        },
      ],
      drill: `Before each ping, light a ring and say which marked cells your ping will tell apart. If the answer is none, pick another cell. You are there when the strip rarely reads over par and a round passes ${p.thresholds[2]!.score}.`,
    },
    {
      level: "advanced",
      goal: "Make one ping answer for every ring, lock what no single ring proves, and find the mark first.",
      tips: [
        {
          title: "Find the mark first",
          body: `The mark pays ${markTimes} bounties, but only as the sector's first find. So when a ring proves a contact, do not lock it yet: it will wait. Aim your pings at the tabbed rings instead. The mark lies on every tabbed ring and on no untabbed one, at that ring's distance. When those cells leave it one place, lock it, then the contacts you held back, one after another.`,
          media: {
            kind: "clip",
            name: "mark",
            alt: `Two pings already carry a tab. One more clear cell is pinged and answers 5, and it carries a tab too. A fog cell the rings now prove is held, a contact is found there, and the board calls Mark found and pays ${c.contactPoints * markTimes}. The tabs are gone.`,
            caption: `Every tabbed ring hears the mark. Pinned down and locked first, it pays ${markTimes} bounties.`,
          },
        },
        {
          title: "One ping, every ring",
          body: `There is usually more than one open ring. Before you ping, check the cell against all of them, and take the one that splits the marked cells of two rings at once. Played this way almost every sector comes in clean, in four to six pings where par allows ${firstPar} to ${lastPar}.`,
          media: {
            kind: "clip",
            name: "two-rings",
            alt: "With three pings on the board, one more clear cell is pinged and answers 1. A fog cell beside it is held and a contact is found. The numbers change, and a second fog cell is held and found with no ping between.",
            caption: "One ping aimed at two rings. Two locks follow it.",
          },
        },
        {
          title: "The last contact is on every ring",
          body: "When one contact is left, every number on the board is hearing it. So it sits where the rings cross. Light two rings, and if they share one fog cell, lock it. This is only true of the last one: with two hidden, two rings may be hearing two contacts.",
          media: {
            kind: "clip",
            name: "cross",
            alt: "Two contacts are found and one is hidden. One ping is tapped and its ring marks two cells. Another is tapped and its ring marks three. One cell is on both. It is held, the contact is found, and the board calls a clean sweep.",
            caption: "One contact left. Two rings share a single cell, so no ping is needed.",
          },
        },
        {
          title: "Spare pings are bounties",
          body: `In a clean sector each ping left pays ${c.savePoints}, times the streak. Two saved are worth ${2 * c.savePoints}, the same as a contact. The better your reading, the more of par you bank. With well aimed pings, reading everything the numbers prove lifts a round by about a quarter.`,
        },
      ],
      drill: `With one contact left, stop. Light each ring in turn before you spend a ping, and see if they already cross. You are there when most sectors end with two or more pings saved and a round passes ${p.thresholds[3]!.score}.`,
    },
    {
      level: "expert",
      goal: "Hold the streak for the whole round, and play it fast.",
      tips: [
        {
          title: "What the streak is worth",
          body: `After ${streakFull} clean sectors everything pays double. By then a sector holds ${c.maxContacts} contacts: cleared clean with four pings saved it pays ${bigSector(4, streakMax)}, against ${bigSector(4, 1)} with no streak. One spook or one ping past par sends you back to the start of that climb. No single lock is worth that risk.`,
          media: {
            kind: "clip",
            name: "streak",
            alt: "The last hidden contact of a sector is held and found. The board pulses once in amber, calls Streak x3 and shows the pings saved and what they paid.",
            caption: "A third clean sector in a row. The saved pings are paid at the streak's rate.",
          },
        },
        {
          title: "Pace is the other half",
          body: `Sectors reach ${c.maxContacts} contacts after ${sectorsToMax} cleared, about when the streak fills. So every second you save early is spent later on the richest sectors at double pay. The same play made one second a ping faster scores about half as much again.`,
        },
        {
          title: "Know when to let the mark go",
          body: `The mark adds ${markExtra} to a bounty, times the streak. A ping past par costs the streak itself, which is worth more. So chase the mark while you have pings in hand, and once a ping would leave you fewer than two of par, give it up: lock what is proven and clear the sector clean. A bot that never gave up scored less than one that did.`,
        },
        {
          title: "A broken sector is a cheap one",
          body: `Once a sector is past par or has a mistake in it, it cannot be clean, and each further ping costs only ${c.overPenalty}. Do not spend time saving them. Still never guess: clear it quickly and start the next streak. The board holds taps for a moment as each sector is dealt, so use it to read the new opening ping.`,
        },
      ],
      drill: `Play for an unbroken streak: count clean sectors in a row and try to end the round on ×${streakMax}. Then push the pace without losing it. You are there when a round passes ${p.thresholds[4]!.score}. The top mark is ${p.thresholds[5]!.score}.`,
    },
  ],
  mistakes: [
    `**Pinging fog to check a cell.** A ping on clear ground asks the same question with no risk. The fog ping can cost ${c.spookPenalty}, the contact's bounty and the streak.`,
    `**Locking on a hunch, even for the mark.** At even odds a lock is ${c.contactPoints} against ${c.wrongPenalty}, so it loses ${-coinFlip} a try before the streak is counted. On the mark it wins ${markFlip}, but a miss ends the streak and the clean sector with it: bots that gambled on the mark lost about a fifth of their score. No sector needs a guess.`,
    "**Crossing rings too early.** Two rings that share a cell prove it only when one contact is left. With more hidden, each ring may hear its own.",
    "**Trusting an old read.** After a lock the numbers change. A ring you lit a moment ago may have moved, so look again before the next move.",
    "**Following the practice hint as a plan.** The move it shows is safe, not good. Its pings are not aimed, and about half its sectors end over par.",
  ],
};

// Sectors hold `scannerContactsFor(c, n)` contacts after n are cleared: the guide's "after ${sectorsToMax} cleared" is that sum.
if (scannerContactsFor(c, sectorsToMax) !== c.maxContacts) throw new Error("scanner guide: sectors grow differently now");
