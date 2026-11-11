# 0038. Puzzle guides: a static site whose pictures are captured from the real boards

Status: Accepted. Builds on [0009](./0009-world-content-as-files.md), [0018](./0018-one-experience-and-a-puzzle-harness.md),
[0019](./0019-boards-package-and-harness-bench.md) and [0036](./0036-prototype-puzzles.md).

## Context

Fifteen puzzles exist: the seven the game deals and eight prototypes. Each explains itself in a
few lines on its start card, which is enough to make a first move and nothing more. What a puzzle
is for, how it scores, and above all how to get good at it lived only in `DESIGN.md`, the
prototype design files and the engines: written for whoever builds the game, not whoever plays it.

The owner asked for one place per puzzle that takes a player from a first round to expert play,
with screenshots and animations, short enough to read in a sitting.

Three things had to be decided: where the guides live, what they are written in, and where their
pictures come from. Pictures are the hard one. Board art and rules still change, and a guide whose
screenshots show last month's board, or a move the engine no longer allows, teaches the wrong
thing with more authority than no guide at all.

## Decision

1. **The guides are an application of their own: `packages/docs`.** A static Vite and React site,
   one page per puzzle at `/<id>` and a list at `/`. It has no server connection, no account and
   no board code: it depends on `content` (for the message table and every puzzle's numbers) and
   on `engine` (for the list of puzzles, and in its capture files for planning). It deploys to its
   own Vercel project, as the harness does. It links to neither the game nor the harness, and
   neither links to it yet; where the game points players at it is a later decision.
2. **Every guide has the same shape.** `src/guides/types.ts` defines a `Guide`: what the puzzle
   is and what it is for, the rules, the controls, how it scores, then four rungs (beginner,
   intermediate, advanced, expert) each with a goal, two to four tips and one thing to practise,
   and the common mistakes. The page shows one rung at a time. A unit test holds every guide to
   that shape and to a budget (counts and lengths), because a guide that says everything is not
   read. Prototypes get guides too, marked as prototypes: a puzzle is judged better by people who
   know how to play it well.
3. **Guide prose is files in the docs package, in English.** One TypeScript file per puzzle
   exports its `Guide`. This is long-form writing, not UI text: it does not go in the message
   table. The site's own chrome (headings, labels, level names) does, under `docs.*`, and a
   puzzle's title is the message table's `<id>.title` (CLAUDE.md rule 5).
4. **A guide types no tuned number.** Round lengths, multipliers, thresholds and point values are
   read from `content` (or an exported engine constant) and written into the sentence, so a
   retune reaches the guide without anyone remembering it. A claim about strategy cannot be
   derived that way: when a rule or the scoring of a puzzle changes, its guide is read again in
   the same PR, as its design file is.
5. **Pictures are captured from the real boards, by a script, and committed.**
   `capture/<id>.capture.ts` is a Playwright file that opens a lab round on the harness
   (ADR 0019) on a pinned seed, plays it with the pointer or the keyboard, and saves what the
   canvas shows: a still as WebP, a clip as a short silent H.264 MP4 with a WebP poster, under
   `public/media/<id>/`. `pnpm --filter @openseas/docs capture [id]` re-takes them. The capture
   run is not part of CI: it needs ffmpeg and real time, and its output is in the repository, so
   the site builds without a browser.
6. **A capture finds its board with the engine.** A picture has to show a particular idea: a
   swap that clears two runs, two slag pieces lifted together. The capture deals seeds in Node
   with the same engine and searches for the first whose opening, or whose short line of play,
   shows it (`findSeed`), then plays exactly that on the page. The search is the record of what
   the picture is meant to show, it is deterministic, and when a rule change makes a pinned
   position impossible it finds another instead of silently recording the wrong thing. Lab
   configs a capture uses must pass the server's schema, as every lab round's must.
7. **The site is smoked like the other front ends.** Its Playwright smoke opens every guide on a
   desktop and a phone profile, walks the four rungs, and checks that every picture a page names
   is served. CI runs it beside the game's and the harness's.

## Consequences

- A third front end to build and deploy. It is small, static and shares the pipeline's shape; the
  Deploy workflow skips it, with a warning, until its Vercel project exists (`docs/DEPLOY.md` 2c).
- About two megabytes of media per puzzle live in git, and change when a board's art does. That is
  the price of a site that builds anywhere and of pictures that are reviewed in the PR that
  changes them.
- A board change that alters how a puzzle looks or plays now has two follow-ups: the harness
  smoke (as before) and re-running that puzzle's capture. Nothing fails if the second is
  forgotten, except the guide's honesty; the capture's seed search fails loudly when a rule
  change makes its idea unreachable.
- Clips are real boards playing real moves, so a guide cannot show a position the engine would
  not deal. That limits a guide to what can be found; it has not been a limit in practice.
- The live-board alternative (embedding the PixiJS boards and replaying move logs in the page)
  was not taken: fifteen WebGL boards on a reading page is heavy on a phone, and the docs would
  have had to track every board's props. It remains possible for one interactive figure later.
