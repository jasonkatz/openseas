The reference is everything a puzzle can say, and everything its rules can call. It is not a tutorial: each page is laid out the way the thing it describes is, so that you can go straight to a key or a hook and read what it means. To learn the API from the start, begin with the [guides](/guides).

## What it covers

A puzzle is three kinds of document and one file of code. The reference has a page for each.

| Page | What it is | Read it when |
|---|---|---|
| [The puzzle object](/reference/puzzle) | Every key of `<id>.puzzle.json`: its round, board, pieces, deal, settings, moves, events, scoring, layers and ladder | You are writing or reading a puzzle document, or what `expand` prints |
| [The skin object](/reference/skin) | Every key of `<id>.skin.json`: a drawing for every piece, its cues, its motion and its words | You are dressing a puzzle in a theme |
| [The theme object](/reference/theme) | Every key of `<theme>.theme.json`: a palette, type, a sound frame, and what a new skin starts from | You are making a look every puzzle shares |
| [Types](/reference/types) | The value types the three documents use, down to primitive values | A field names a type you want to know |
| [The rules object](/reference/hooks) | Every hook a rules file may hold, when the loop asks it and what it must answer | You are writing `<id>.rules.ts` |
| [The view](/reference/view) | What one seat may see of a round, handed to every question | A hook is asked something |
| [The context](/reference/context) | The whole table, the draws and `emit`, handed to every hook that reports events | A hook changes the round |
| [Types and functions](/reference/sdk) | `defineRules`, the generated puzzle types, and every type the SDK names | A signature names a type you want to know |

The documents say what exists. The rules say what a move does. The engine runs both, the same way for every puzzle.

## Reading a document

Each of the three documents is one JSON object, and the reference is laid out the way the object is. The [puzzle object](/reference/puzzle), the [skin object](/reference/skin) and the [theme object](/reference/theme) each have one page, with everything in the object on it. Every object inside one is a section of that page, such as [`round`](/reference/puzzle#round) in the puzzle, and whatever is nested deeper is defined inside its parent's section.

Every field says four things.

| Part | Says |
|---|---|
| Name | The key as it is written, with its path from its section's object, such as `tempo.kind` |
| Type | What its value is, down to a primitive value. A list always says what it is a list of. A named type links to [Types](/reference/types) |
| Required, optional or conditional | Whether the key is always written, may be left out, or is written in one case and refused in every other |
| Description | What the value means. Then what leaving it out means, what it may only sit beside, what it may never sit beside, and what it must agree with |

Where a value is one of a fixed set, every possible value is listed and explained. Each section ends with what must hold across its fields: the combinations a host refuses.

A key that is left out is left out of the file. It is never written as `null`.

## Reading the rules SDK

The rules object, the view and the context each have one page, with a section for every hook or member, such as [`canMove`](/reference/hooks#canmove) on the rules object and [`emit`](/reference/context#emit) on the context.

A hook's section says when the loop asks it, which [stage of the loop](/guides/rules#the-loop) that is, how often, and what it is given: a view, a context, or plain values. Then its parameters, what it returns, and when the engine refuses what it returns. A member of a view or a context says the same of itself. Every type a signature names links to [Types and functions](/reference/sdk), and every id a hook may name is checked against the puzzle it is written for.

> [!PREVIEW]
> The engine is being built to this design, a rung at a time. The documents and the names of the hooks are settled. Exact TypeScript signatures may still move while it is built.
