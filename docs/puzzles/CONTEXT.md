# The puzzle

The pure puzzle: a set of rules that turns a seed, settings and what is played into a round, judged on
one scale every puzzle shares. It holds nothing from the game's world; a skin dresses it and the game
puts it to work.

## The puzzle and its round

**Puzzle**:
A set of rules, played in rounds, with everything it declares about itself: its layers, ladder,
settings, pieces, moves, events and signals.
_Avoid_: game, minigame, board (the board is what a player sees)

**Rules**:
The sealed part of a puzzle that decides what every move does. The same seed, settings and moves
always make the same round.
_Avoid_: engine, logic

**Round**:
One play of a puzzle, from its start until one of its endings is met.
_Avoid_: game, session, run

**Seed**:
What fixes a round's luck, so the round can be played again exactly.

**Ending**:
A condition that ends a round. A puzzle has one or more, and the first one met ends the round.

## What goes in

**Move**:
One act a player makes in a round.
_Avoid_: action, input, command

**Setting**:
A named number a puzzle is tuned by, with its bounds and a line saying what it does.
_Avoid_: config, knob, parameter, number

**Signal in**:
A value from outside the puzzle that steers what it does, such as how hot a ship is running. It is
never a move.
_Avoid_: injected move, external input

## What comes out

**Event**:
Something the rules report happened during a round, carrying what a player needs to see it.
_Avoid_: report, effect

**Points**:
What one event adds to the score.

**Score**:
The sum of a round's points. It never goes below zero.

**Stat**:
A count the rules keep about a round, such as the longest path, shown when it ends.

**Outcome**:
Who won a round played between sides.
_Avoid_: result

**Signal out**:
A value the puzzle gives to whatever is outside it, such as an outcome.

## Depth

**Layer**:
A named group of rules that is either on or off.
_Avoid_: feature, mode, level

**Stage**:
One step of a ladder: the puzzle with some of its layers on, played until the player clears its bar.
_Avoid_: level, difficulty

**Ladder**:
A puzzle's stages in order. Each stage adds layers and none removes one, and the last stage is the
whole puzzle.

## Judgement

**Tier**:
One of five bands of play, the same for every puzzle: Green, Steady, Sharp, Masterful and Legendary.
_Avoid_: rank, grade

**Performance**:
One round's play placed on the scale every puzzle shares.

## On the board

**Piece**:
A thing on the board that the rules know by its id.
_Avoid_: tile, sprite, token

**Family**:
A numbered set of interchangeable pieces, of which a setting decides how many are dealt.

**Kind**:
One member of a family.

**State**:
A form a piece can be in: one of several named forms, or a count it shows.

## Sides

**Side**:
The players who win or lose a round together.
_Avoid_: team

**Seat**:
A place on a side for one player.

**Opponent**:
Whoever holds a seat on another side.

## Dressing

**Skin**:
The looks and sound that dress one puzzle. It never changes a number.
_Avoid_: theme (a set of skins), reskin

**Drawing**:
A piece's picture, made of shapes on a square, for each of its states.
_Avoid_: sprite, image, frame, atlas

**Cue**:
A short synthesized sound.
_Avoid_: sample, sound effect, sfx

**Callout**:
The text an event shows on the board when it happens.

**Beat**:
The one pulse of the whole board, kept for a puzzle's biggest moment.

## Teaching

**Preview**:
What a move would do, told before it is made.

**Hint**:
A move worth making, offered to a player who is stuck. Never in a round that counts.
