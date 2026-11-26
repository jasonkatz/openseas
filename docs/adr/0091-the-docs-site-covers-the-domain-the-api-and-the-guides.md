# 0091. The docs site covers the domain, the API and the guides

Status: Accepted. Builds on [0038](./0038-puzzle-guides-site.md), whose guides, captures and numbers from
`content` it keeps, and changes where a guide lives on the site. Presents
[0088](./0088-a-puzzles-rules-are-hooks-on-one-round-loop.md) and [0090](./0090-the-engine-keeps-the-table.md)
without changing either.

## Context

`packages/docs` was the puzzle guides and nothing else: a list of puzzles and a page for each. Two other
things a reader needs had no home there.

- **What a puzzle is.** The puzzle domain guide (`docs/puzzles/DOMAIN.md`) is one long Markdown file in the
  repository. It was shown as one long page, which is hard to find a thing in and hard to link into.
- **How one is written.** The shapes of the puzzle, skin and theme documents are in that guide's last sections,
  and the rules' hooks are in two ADRs. Nobody who wants to write a puzzle should have to read a decision
  record to learn what a key means or what a hook is asked.

The owner asked for one site that covers all three, reads well from first principles, and stands on its own.

## Decision

1. **The docs site has three areas.** Domain at `/domain`, API at `/api`, and the puzzle guides at `/guides`.
   The front page introduces all three. One shell holds them: a bar, a side list of the area's pages, the
   page's own contents, a link to the page before and after, and a search over every heading on the site.
2. **The domain guide stays one file, and the site cuts it into pages.** `docs/puzzles/DOMAIN.md` is still the
   only place the domain is written. `packages/docs/src/domain/pages.ts` names which of its sections each page
   shows. A link in the guide to one of its own headings becomes a link to the page that heading is on. A test
   fails when a section is on no page or on two, and when a link leads nowhere. The glossary page is built
   from `docs/puzzles/CONTEXT.md`.
3. **The API area is written for the site, and its reference is typed data.** `packages/docs/src/api/schema/`
   holds the puzzle, skin and theme objects as data: every field with its type down to a primitive value,
   whether it is required, what leaving it out means, every value an enum takes with what the value means, and
   what must hold between fields. The site draws an object browser from it. Each top-level object has a page
   at `/api/<object>`, and every object that belongs to it has a page under that, at `/api/<object>/<key>`.
   Anything nested more deeply is defined on its parent's page. The types that fields share are on one page,
   `/api/types`. Tests read the shapes in the domain guide and fail when a key is not in the reference, and
   hold the Paths puzzle, its skin and every example on a page to the types the reference gives.
   `packages/docs/content/api/` holds the rest in Markdown: the overview, a worked puzzle from an empty
   folder, the whole Paths documents read from `docs/puzzles/examples/`, and the page on writing rules.
4. **The rules SDK is documented as a design, from one file of declarations.** The engine of ADR 0088 and
   ADR 0090 is not built. `packages/docs/content/api/sdk/engine.d.ts` declares its whole surface, and
   `packages/docs/src/api/sdk/` describes it as data: every hook, every member of a view and a context, and
   every type, with its signature, its parameters, what each value it gives back means, and when a call is
   refused. The rules object, the view and the context each have a page, with a page under it for every hook
   or method, and the types share one page. Tests hold every signature on a page to the declarations, and
   compile every example against them with the TypeScript compiler, on two generated puzzle types kept
   beside them. The pages carry a notice that this is a design. Where the ADRs name a thing and give it no
   signature, the declarations give one, so they are also the first whole sketch of the SDK's surface. When
   the engine lands, its own declarations replace the file, and a difference between them is settled in the
   engine's own ADR.
5. **The site stands on its own.** No page in Domain or API names an ADR, a pull request or a file of this
   repository's `docs`. A test holds that.
6. **A guide is at `/guides/<id>`.** This changes ADR 0038, where it was at `/<id>`. The old address still
   leads to the new one, so no link a player has kept breaks.
7. **Markdown is read as data, never as markup.** The site lexes it with `marked`, a build-time dependency of
   the docs package only, and draws the tokens as React elements. No HTML from a file is ever put on the page.
8. **The site's own words stay in the message table**, under `docs.*`. The prose of a page is a file, as a
   guide's is (ADR 0038, decision 3).
9. **A change to the domain guide deploys the site.** `docs/puzzles` joins the paths that deploy `docs`.

## Consequences

- The domain guide can be linked to by idea, and searched. It is still edited in one place, and the site
  cannot drift from it.
- A new section of the domain guide, or a new key in a document's shape, fails the site's tests until it has
  a page or a row. That is one more step in a change to the guide, and it is the step that keeps the site whole.
- The reference restates the shapes that the domain guide's last sections hold, and says more than they do:
  a type for every value and the combinations that are refused. The test on keys keeps the two in step. Where
  the guide gives a key and no type, the reference's type is a proposal until the engine reads the document.
- A sentence that describes a part of the puzzle is its `description`. The guide wrote that key as `line`
  when ADR 0088 and ADR 0090 were written, and they keep the word they were written in.
- The rules SDK pages say more than the ADRs do in places: a type for every argument, and a few members the
  ADRs do not name. Until the engine exists they are a proposal for those places, and the page on writing
  rules lists the edges that are open.
- The docs package gains one build-time dependency. The engine stays pure and the site still has no server.
