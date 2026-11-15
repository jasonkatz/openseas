---
name: puzzle-sprites
description: Generate a puzzle's sprites through the OpenAI Images API and place the owner's picks in its atlas. Use when a puzzle needs a new or redrawn frame, a new kind, or a whole sheet, or when writing a sprite brief.
---

Sprites are made from a **brief** kept in the repository, one take per image, and the owner picks
every take that lands (ADR 0040). The script is `packages/boards/scripts/sprites.py`; atlas format
and fallbacks are in `packages/boards/src/sprites/README.md`.

## 1. Brief

Write or extend `packages/boards/briefs/sprites/<puzzle>.json`; `swordfight.json` is the worked
example.

- `frames`: one entry a frame, keyed by the name the renderer asks for (`drawSprite(..., name)` on a
  core board, `this.sprite(g, name, ...)` on a kit board, or the frame already in `frames.json`).
- Each description says what the object is, its material and surface, and its silhouette. Kinds
  that sit side by side differ in silhouette and surface as well as color (rule 6).
- `refs`: two to four existing frames (`<atlas>:<frame>`) that hold the set's style. A new atlas
  borrows a neighbour's.
- `style` (optional): a line for this puzzle on top of `briefs/sprite-style.txt`.
- Describe things in their own words: name no other game, film, franchise or artist (rule 3).

Done when every frame the change needs has an entry.

## 2. Key

`OPENAI_API_KEY`, from the environment or the repository's untracked `.env`. In a cloud session,
ask for it with `request_credential` (host `api.openai.com`, bearer) and run the script with
`OPENAI_API_KEY=placeholder`: the proxy puts the real key in.

## 3. Generate

```bash
python3 packages/boards/scripts/sprites.py gen <puzzle> [frame ...]
```

Two takes a frame by default (`--takes`), all frames when none are named. Each run costs credit and
adds to the takes already in `.art/sprites/<puzzle>/`, so generate again only the frames the owner
turned down, with the brief reworded. A take reported with no transparency is unusable: reword or
try another model (`--model`, or `OPENAI_IMAGE_MODEL`). Beside each `take-<n>.png` the script
writes `frame-<n>.webp`, the take as the frame it would be placed as.

## 4. Review

Look at `.art/sprites/<puzzle>/contact.png` yourself: a row a frame, the atlas's current frame
first where there is one. Shortlist the takes that show the whole object, a clean transparent edge,
no text, a silhouette apart from its siblings, and the set's style. Then the owner picks: locally
they open `.art/sprites/<puzzle>/review.html` (each take at frame size and board size, on dark and
light); in a cloud session, send them `contact.png` and the shortlisted takes; in the studio's
chat, end the turn, and the studio lists every take in the frame's row of the owner's Sprites
panel, numbered as here, to be seen on the running board (ADR 0051). Done when the owner
has named a take for every frame, or asked for a reworded brief.

## 5. Place

In the studio's chat, never place: the owner picks a take with a tap in its row, and Save places
every pick in one pass, from the base branch's atlas (ADR 0053). If the owner names a take in the
chat, ask them to pick it in the Sprites panel and Save. Everywhere else:

```bash
python3 packages/boards/scripts/sprites.py place <puzzle> <frame> <take>
```

This writes the take as the frame's lossless override, `sprites/overrides/<puzzle>-<frame>.webp`.
The boards draw it over the atlas's frame (ADR 0053); the atlas and `frames.json` are not touched,
so no other frame is encoded again. Then:

- A new frame name: the renderer asks for it, and the piece has a code-drawn fallback
  (`boards/src/parts.ts`, or the kit's art) in the same silhouette.
- `pnpm --filter @openseas/studio test:smoke` is green, and
  `pnpm --filter @openseas/docs capture <puzzle>` is re-run with every picture looked at.

Commit the brief and the override together.
