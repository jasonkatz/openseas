# The puzzle

The pure puzzle: a set of rules that turns a seed, settings and what is played into a round, judged on
one scale every puzzle shares. It holds nothing from the game's world: a skin dresses it, and a host
runs it.

## The puzzle and its round

**Puzzle**:
A set of rules, played in rounds, with everything it declares about itself: its layers, ladder,
settings, pieces, moves, events and signals.
_Avoid_: game, minigame, board (the board is what a player sees)

**Rules**:
The sealed part of a puzzle that decides what every move does. The same seed, settings and log
always make the same round.
_Avoid_: engine, logic

**Round**:
One play of a puzzle, from its start until one of its endings is met.
_Avoid_: game, session, run

**Seed**:
What fixes a round's luck, so the round can be played again exactly.

**Deal**:
What the seed puts in front of the player: the luck in a round.

**Stock**:
A fixed amount of deal a round works through, such as five slabs.

**Ending**:
A condition that ends a round, such as a clock, a move budget, a stock running out, a fail or an
outcome. A puzzle has one or more, and the first one met ends the round.

**Tempo**:
How a puzzle's time moves: still (nothing happens between moves), ticking (the rules move on by
themselves between moves) or turns (moves are planned, then resolved together).
_Avoid_: pace, clock, speed

**Tick**:
One step of time in a ticking puzzle.
_Avoid_: frame, step

## What goes in

**Verb**:
The one act a puzzle is built around. Every puzzle has exactly one.
_Avoid_: mechanic, action

**Move**:
One act a player makes in a round: the verb, or a lesser act such as a skip.
_Avoid_: action, input, command

**Setting**:
A named number a puzzle is tuned by, with its bounds and a line saying what it does.
_Avoid_: config, knob, parameter, number

**Signal in**:
A value from outside the puzzle that steers what it does, such as how hot a ship is running. It is
never a move.
_Avoid_: injected move, external input

**Log**:
The ordered record of a round's moves and signals, each stamped with its time, closed by a final
time mark. A round is replayed from its seed, settings and log.
_Avoid_: move list, history

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
A value the puzzle gives to whatever is outside it, such as an outcome or its pace.

## Depth

**Layer**:
A named group of rules that is either on or off.
_Avoid_: feature, mode, level

**Stage**:
One step of a ladder: the puzzle with some of its layers on, played until the player clears its
threshold.
_Avoid_: level, difficulty

**Ladder**:
A puzzle's stages in order. Each stage adds layers and none removes one, and the last stage is the
whole puzzle.

**Threshold**:
The bar a player clears to leave a stage, in the unit of the stage's measure.
_Avoid_: threshold for where a tier begins (that is a tier start)

## Judgement

**Tier**:
One of five bands of play, the same for every puzzle: Green, Steady, Sharp, Masterful and Legendary.
_Avoid_: rank, grade

**Tier start**:
The score at which a tier begins, for one puzzle.
_Avoid_: threshold, cutoff

**Performance**:
One round's play placed on the scale every puzzle shares.

**Pace**:
Performance over the recent stretch of a round, read while it is played.
_Avoid_: live rating, tempo

**Pace window**:
The stretch of recent play that pace reads.
_Avoid_: stretch, sample window

**Standing**:
A player's level at a puzzle across rounds, built from their performances and shown as a tier.
_Avoid_: rating, rank, Elo, MMR

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
Whoever holds a seat on another side: a player or a stand-in.

**Stand-in**:
An opponent the rules play themselves, in a seat no player holds.
_Avoid_: bot, AI, NPC

## Dressing

**Skin**:
The looks and sound that dress one puzzle. It never changes a number.
_Avoid_: reskin, theme (a theme is a set of skins)

**Theme**:
A set of skins, one for each puzzle, that dresses them all in one look, such as space.
_Avoid_: world, setting

**Drawing**:
A piece's picture, made of shapes on a square, for each of its states.
_Avoid_: sprite, image, frame, atlas

**Cue**:
A short synthesized sound.
_Avoid_: sample, sound effect, sfx

**Text**:
A piece of writing a player reads, found by its key.
_Avoid_: word, string, message, copy

**Callout**:
The text an event shows on the board when it happens.

**Beat**:
The one pulse of the whole board, kept for a puzzle's biggest moment.

## Teaching

**Preview**:
What a move would do, told before it is made.

**Hint**:
A move worth making, offered to a player who is stuck. Never in a round that counts.

## Outside the puzzle

**Host**:
What runs rounds and keeps each player's standing and place on a ladder, such as the game or the
studio.
_Avoid_: context, platform

**Role**:
What a puzzle does in a world: how its signals are wired and what a round earns there, such as a
duty station.
_Avoid_: context, purpose

**Countdown**:
The host's moment that marks a round's last seconds.
_Avoid_: tick
