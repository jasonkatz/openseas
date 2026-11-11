# Puzzle designs

One design file for each puzzle the game deals. The eight prototypes keep theirs in
[`../prototypes/`](../prototypes/README.md), in the same shape. `DESIGN.md` 3.3 keeps each puzzle's
faithful core in a paragraph and points here.

| Puzzle | Role | Design |
|---|---|---|
| Cooling | Duty: vents the ship's heat | [cooling.md](./cooling.md) |
| Engines | Duty: generates movement tokens | [engines.md](./engines.md) |
| Plating | Duty: repairs hull damage | [plating.md](./plating.md) |
| Gunnery | Duty: loads turrets | [gunnery.md](./gunnery.md) |
| Navigation | Duty: token bonuses and space battle advantages | [navigation.md](./navigation.md) |
| Space Battle | The captain's board against a raider | [battle.md](./battle.md) |
| Swordfighting | The boarding fight | [swordfight.md](./swordfight.md) |

## What a design file holds

The same sections in the same order, so any puzzle is read the same way:

1. **The puzzle.** What it is, in a paragraph a new player could follow.
2. **Role.** What the round does for the wider game.
3. **Luck and skill.** What the deal decides, then the skills in the order a player learns them.
4. **Rules and scoring.** What the engine does today, with the content key beside each number.
5. **Input and feedback.** Touch, mouse and keys, and what the board shows.
6. **Engine.** Where the code and the numbers are.
7. **Tuning notes.** What was tried, what it scored, what was kept.
8. **Open questions for play.**

Keep it true: when a rule, a number or a control changes, its design file changes in the same
commit. A deliberate difference from the original also gets its row in `DESIGN.md` section 6.
The rules every puzzle is held to are in the `puzzles` skill (`.claude/skills/puzzles/SKILL.md`).
