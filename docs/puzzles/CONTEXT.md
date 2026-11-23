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
What the seed puts in front of the player: the luck in a round, declared in full as its draws, checks,
bounds and secrets.

**Draw**:
One source of a round's luck, such as the kind of each new piece: what it gives, how (an even roll, a
weighted roll, a bag or a pick) and when.
_Avoid_: spawn, generator, random

**Bag**:
A shuffled set dealt out in order, then shuffled again, so every so many items hold the same ones.

**Stream**:
The run of luck one draw reads, made from the seed and the draw's id, so no draw changes another.
Between sides, a draw's stream is shared by every seat or one a seat.
_Avoid_: rng, PRNG (that is how a stream is made)

**Check**:
A test a deal must pass before a player sees it, such as a move being possible, with its tries and a
fallback that always passes.
_Avoid_: validation

**Fallback**:
What a check deals when every try fails. It always passes.

**Bound**:
A setting that caps what one draw can give, so no round is made by one windfall.
_Avoid_: limit, cap (a cap is a payout's)

**Secret**:
Part of the deal a player does not see, such as where contacts lie, revealed only by events. A round
with one is run by its host.
_Avoid_: hidden state, fog (that is how a skin shows one)

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

**Gesture**:
How a player makes a move by touch, such as a tap on a cell or a path drawn through cells. Keys
follow from the gesture.
_Avoid_: input, interaction

**In hand**:
What a player holds and adjusts before making a move with it, such as a plate taken from a tray.
Adjusting it is never a move; setting it down is.
_Avoid_: held piece, cursor piece

**Control**:
A button a puzzle declares for a move that has no place, such as a skip, or for switching what a tap
does.
_Avoid_: action, button (that is how a control looks)

**Setting**:
A named number a puzzle is tuned by, with its bounds and a line saying what it does.
_Avoid_: config, knob, parameter, number

**Relation**:
A rule two settings keep with one another, such as one at most the other, which no setting's bounds
can say alone.
_Avoid_: constraint, validation

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
What one event adds to the score, each point belonging to a payout.

**Payout**:
A named way a puzzle pays points, such as a path or a loop, paid on an event and grown from what that
event counts.
_Avoid_: term, component, source

**Growth**:
How a payout's points rise with what it counts: flat, linear, superlinear or stepped.
_Avoid_: curve, formula

**Cap**:
The count past which a payout grows no faster.

**Cascade**:
Everything one move sets off as the board settles, such as clears that cause more clears. Each link
is a step, and every event in a cascade belongs to the move that started it.
_Avoid_: chain (a streak is not a cascade), combo

**Score**:
The sum of a round's points. It never goes below zero.

**Multiplier**:
A percent that scales named payouts on an event: a setting, or an entry in a table indexed by the
streak or by a cascade's step. Multipliers that meet multiply together, and the result is rounded
down once for the event.
_Avoid_: bonus (a bonus is a flat amount), factor

**Streak**:
A run of successes that raises a multiplier through a table whose last entry holds. It builds on a
declared event or grade, and breaks on a mistake or on more misses than its grace. A puzzle has at
most one.
_Avoid_: combo, chain, pipeline

**Grace**:
How many misses in a row a streak forgives before it breaks.
_Avoid_: window

**Miss**:
A move, or a task, that builds nothing for the streak.

**Mistake**:
An event a puzzle declares as one, such as a wrong lock: it costs points, the streak, or both, and
never ends the round.
_Avoid_: error, fail (a fail is an ending)

**Task**:
A unit of work the deal sets within a round, such as a slab to cut or a clamp to fill, which ends when
it is done, given up or out of time.
_Avoid_: goal, objective, job

**Grade**:
How well a task was done, one of the puzzle's named grades in order from best, such as clean, full
and slow.
_Avoid_: rating (a player has standing), rank

**Par**:
The fewest moves that can finish a task, worked out by the rules when the task is dealt and shown to
the player.

**Best**:
The most any play could score from a task, worked out by the rules when the task is dealt to grade
it. It is never shown to the player.
_Avoid_: optimum, max score

**Moment**:
The event the puzzle names as its biggest, with an optional condition on it, and the number field that
says how big each one is. The skin plays the beat on it.
_Avoid_: climax, highlight

**Stat**:
A count the rules keep about a round, such as the longest path, shown when it ends.

**Gauge**:
A named number a player watches while a round is played, besides the score, such as moves left or a
rising line. It may have a most, and a point past which it means danger.
_Avoid_: meter, counter, indicator

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
threshold. It changes nothing but which layers are on.
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

## The board

**Geometry**:
Where pieces can be on a puzzle's board and which places touch. It is part of the rules.
_Avoid_: layout (which also covers arrangement)

**Shape**:
The kind of board a puzzle declares, a grid or rings, from which its cells come.
_Avoid_: topology

**Cell**:
One place on a board where a piece can be, whatever the board's shape. Every board counts its rows
from the top and its columns from the left.
_Avoid_: space, slot, square, tile

**Terrain**:
What a cell is, as opposed to the piece on it, such as a wall or a port. A cell has one terrain,
plain unless the puzzle says otherwise.
_Avoid_: fixture, obstacle, feature

**Rim**:
A ring of cells just outside a grid's playing area, holding terrain such as ports.
_Avoid_: edge, border

**Map**:
Terrain drawn by hand for a whole board. A puzzle with maps has a list of them, and the seed picks one.
_Avoid_: level, layout

**Zone**:
A named place beside the board that holds a fixed number of pieces, such as the next piece or a tray.
A player either only watches a zone or takes pieces from it.
_Avoid_: queue, tray, preview area

**Place**:
A cell on a board, or a numbered spot in a zone: what a move or an event points at.
_Avoid_: position, location

**Piece**:
A thing on the board that the rules know by its id: a number unique within the round, kept from the
moment the piece is dealt until it leaves.
_Avoid_: tile, sprite, token

**Footprint**:
The cells a piece covers: one, or several together.

**Family**:
A numbered set of interchangeable pieces, of which a setting decides how many are dealt.

**Kind**:
One member of a family.

**State**:
A form a piece can be in: one of several named forms, or a count it shows.

**Board change**:
One thing that happens on the board: a piece arrives, leaves or travels, or a piece or a cell's terrain
changes. Every board change is carried on an event.
_Avoid_: animation, diff

**Arrive**:
A board change: a piece comes onto the board, in place, from a spot in a zone, or from off the board
in a direction.
_Avoid_: spawn

**Leave**:
A board change: a piece goes from the board, cleared or taken to a zone.
_Avoid_: despawn, destroy

**Travel**:
A board change: a piece goes from one cell to another, by a route of cells when it passes through
others.
_Avoid_: move (a move is the player's), slide

**Change**:
A board change: a piece's state or kind, or a cell's terrain, becomes another where it stands.

## Sides

**Side**:
The players who win or lose a round together.
_Avoid_: team

**Seat**:
A place on a side for one player.

**Opponent**:
Whoever holds a seat on another side: a player or a stand-in.

**Stand-in**:
An opponent the rules play themselves, in a seat no player holds: a type and its dials. Its standing
is measured, never set by hand.
_Avoid_: bot, AI, NPC

**Stand-in type**:
How a stand-in chooses, the same for every puzzle: careless (any allowed move), greedy (the move worth
most now), planner (the move whose next few are worth most) or ghost (a player's round replayed on the
same deal).
_Avoid_: difficulty, level

**Dials**:
A stand-in's delay, the time it takes over a move, and its slip, the share of its moves made at random.
_Avoid_: difficulty, accuracy

## Dressing

**Skin**:
The looks and sound that dress one puzzle. It never changes a number.
_Avoid_: reskin, theme (a theme holds a skin for each puzzle)

**Theme**:
A look for every puzzle: a document holding a palette, type, a sound frame, the cues and motion a new
skin starts from, and host texts, with a skin for each puzzle, such as space. Skins read its palette and
type, and copy its cues and motion.
_Avoid_: world, setting, brand

**Palette**:
A theme's colours, each a name and a value: the seven fixed colours and its piece colours. A skin names
a colour and the theme says what it is.
_Avoid_: tokens, swatches

**Fixed colour**:
One of the seven colours every theme fills, so a host and any skin work under any theme: `ground`,
`raised`, `line`, `text`, `dim`, `yours` (what is the player's or active) and `danger` (what is bad).
_Avoid_: role (a role is a puzzle's place in a world), brand colour

**Piece colour**:
One of a theme's freely named colours for pieces, at least eight, because a family can deal eight kinds.
_Avoid_: tint, kind colour

**Type**:
A theme's typefaces and their sizes.
_Avoid_: font, typography

**Sound frame**:
A theme's scale, which every cue's notes come from, and its limits: the longest cue and the highest
cutoff. The checks read it.
_Avoid_: key, sound palette

**Host text**:
A text the host says in a theme: a tier's name, start, countdown, end.

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
The text an event shows on the board when it happens. At most one shows for each entry: the skin ranks
them.

**Motion**:
How a skin plays what happens on the board: each board change's length and easing, the stagger along
an event's places, its marks, where points rise from, and the beat's pulse. A new skin's motion starts
as a copy of its theme's, as its cues do.
_Avoid_: animation, tween, juice

**Mark**:
A ring or a line the skin draws from an event's places, to show a rule at work rather than a piece.
_Avoid_: particle, effect

**Beat**:
The skin's one effect for the puzzle's moment: a single pulse over the whole board, played on top of
every other motion, stronger for a bigger moment and never a second effect, with one cue of its own
heard alone.

**Reduced motion**:
A player's ask for less motion. The host passes it on, and each skin answers it in its own way.

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

**Settle**:
A board settles when everything an entry set off has finished playing. It takes no touch until then.
Motion from ticks never holds it, and the rules never wait on it.
_Avoid_: idle, ready

**Ceiling**:
The host's fixed limit, about a second, on how long what one entry sets off may play. Past it, the host
snaps whatever is still playing to its end.
_Avoid_: timeout, cap (a cap is a payout's)

**Arrangement**:
Where things sit on a screen and how big they are: the board, its zones, the score. It belongs to
whatever draws the board, never to the puzzle.
_Avoid_: layout
