# 0101. The docs site has four areas: domain, guides, reference and puzzles

Status: Accepted. Supersedes decisions 1 and 6 of [0091](./0091-the-docs-site-covers-the-domain-the-api-and-the-guides.md),
and the address its decision 3 gave the reference. Everything else in 0091 stands: the domain is still cut from
one guide, the reference is still typed data, and the rules SDK is still documented from one file of declarations.

## Context

ADR 0091 gave the site three areas: Domain, API and the puzzle guides. The API area grew. It now holds the
overview, the quickstart, a climb of six rung pages (ADR 0092 to ADR 0096), the page on writing rules and Paths
in full, and beside them the reference to the three documents and the rules SDK. Its side list mixed pages that
are read once, in order, with pages that are looked things up in. A reader who wanted a key had to scroll past a
tutorial to find it, and a reader learning the API met the reference halfway through the climb.

The word "guides" also named the per-puzzle pages, which teach a player to play, not a writer to write. The owner
asked for the site to say what each part is for.

## Decision

1. **The docs site has four areas**, in this order on the bar and the front page.
   - **Domain** at `/domain`, as before: what a puzzle is, a page for each idea, and the glossary.
   - **Guides** at `/guides`: the how-tos for writing a puzzle, read in order. Getting started (the old API
     overview) and the quickstart, the climb from Tune to Ship it, writing rules, and Paths in full.
   - **Reference** at `/reference`: only what drives the engine. A front page on how to read it, the puzzle, skin
     and theme objects at `/reference/<object>`, their types at `/reference/types`, the rules object, the view and
     the context at `/reference/hooks`, `/reference/view` and `/reference/context`, and the SDK's types and
     functions at `/reference/sdk`. No tutorial is listed here.
   - **Puzzles** at `/puzzles`: one page for each puzzle the game or the studio deals, from a first round to expert
     play, as ADR 0038 made them.
2. **Every old address still arrives**, at the same anchor. `/api` goes to `/guides`, `/api/<page>` of a how-to to
   `/guides/<page>`, `/api/<object>` to `/reference/<object>`, and a puzzle's `/guides/<id>` and `/<id>` to
   `/puzzles/<id>`. The host redirects them permanently, and the page does the same for a link followed inside the
   site. A test holds the host's list and the page's to each other.
3. **Where a page of prose is written does not change.** The how-tos and the reference's front page are Markdown
   in `packages/docs/content/api/`, each listed with its area in `packages/docs/src/api/pages.ts`. A puzzle's page
   is still `packages/docs/src/guides/<id>.ts`.

## Consequences

- Each area has one job, and its side list shows it: the guides read top to bottom, and the reference is a list of
  things to look up.
- The section of the old overview on reading the reference moved to the reference's front page, beside a table of
  every page in it.
- "Guide" now means a how-to on the site. A puzzle's page is still called its guide in the code and in ADR 0038,
  and the site calls the area Puzzles.
- A link anyone kept to the old API area or to a puzzle's guide still works, so nothing outside the repository
  has to change.
