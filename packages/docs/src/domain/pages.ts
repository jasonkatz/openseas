/**
 * How the domain guide is cut into pages. The guide itself is one document in the repository,
 * `docs/puzzles/DOMAIN.md`, and stays the only place its words are written: each page here names
 * the guide's sections it shows, in order. `test/domain.test.ts` fails when a section of the guide
 * is on no page, so the site cannot fall behind the guide.
 *
 * A page's `lede` is the site's own: one or two sentences that say, from nothing, why the page
 * matters. It is long-form writing, like a puzzle guide's prose, and lives here.
 */
export interface DomainPage {
  /** The last part of its address, `/domain/<slug>`. Empty for the first page, at `/domain`. */
  readonly slug: string;
  readonly title: string;
  readonly lede: string;
  /** The guide's `##` headings this page shows. */
  readonly sections: readonly string[];
  /** A figure shown under the lede, by its name in `figures/`. */
  readonly figure?: string | undefined;
}

export interface DomainGroup {
  readonly title: string;
  readonly pages: readonly DomainPage[];
}

export const GLOSSARY_SLUG = "glossary";

export const DOMAIN_GROUPS: readonly DomainGroup[] = [
  {
    title: "Foundations",
    pages: [
      {
        slug: "",
        title: "What a puzzle is",
        lede: "A puzzle is a set of rules and nothing else. It has no pictures, no sounds and no story. Everything a player sees and hears is added around it, and none of that can change how a round goes.",
        sections: ["What a puzzle is"],
        figure: "around",
      },
      {
        slug: "round",
        title: "The round",
        lede: "A round is one play of a puzzle. It starts from a seed and settings, takes in what is played, and ends. Give it the same three things again and it is the same round, every time.",
        sections: ["The round"],
        figure: "round",
      },
      {
        slug: "moves-and-events",
        title: "Moves, events and signals",
        lede: "Everything that reaches a round comes in as a move, a setting or a signal. Everything a round tells the outside goes out as an event, a score, a gauge or a signal. Nothing crosses any other way.",
        sections: ["What goes in", "What comes out"],
      },
      {
        slug: "scoring",
        title: "Scoring",
        lede: "A puzzle says how it pays in a few declared parts: payouts, multipliers, a streak and tasks. The rules report what happened, and the points follow from the declarations.",
        sections: ["Scoring"],
      },
    ],
  },
  {
    title: "The table",
    pages: [
      {
        slug: "board-and-pieces",
        title: "The board and its pieces",
        lede: "The board is where pieces can be and which places touch. A piece is anything the rules know about. Both are described without saying how either looks.",
        sections: ["The board", "Pieces"],
      },
      {
        slug: "deal",
        title: "The deal",
        lede: "The deal is all the luck in a round. A puzzle declares every source of it, so anyone can tell luck from skill without reading code, and so one seed always deals the same round.",
        sections: ["The deal"],
      },
      {
        slug: "sides",
        title: "Sides and seats",
        lede: "A puzzle can be played alone or between sides. Seats, who holds them, and the opponents the rules play themselves are all part of the puzzle, kept the same way for every puzzle.",
        sections: ["Sides", "What a player sees"],
      },
    ],
  },
  {
    title: "Growing with the player",
    pages: [
      {
        slug: "depth-and-judgement",
        title: "Depth and judgement",
        lede: "A puzzle opens up a few rules at a time, and every round is judged on one scale of five tiers that all puzzles share.",
        sections: ["Depth", "Judgement"],
      },
      {
        slug: "versions",
        title: "Versions",
        lede: "Rules change, and old rounds must still mean what they meant. A version says which rules a round was played on, and what a change is allowed to touch.",
        sections: ["Versions"],
      },
    ],
  },
  {
    title: "Code and dress",
    pages: [
      {
        slug: "rules",
        title: "The rules",
        lede: "The rules are the only part of a puzzle that is code. They are small, because one loop runs every round and asks the rules only for what is the puzzle's own, and smaller still when a puzzle is put together from parts.",
        sections: ["The rules", "Parts"],
        figure: "loop",
      },
      {
        slug: "motion",
        title: "Motion",
        lede: "The puzzle says what changed on the board. The skin says how that plays on a screen. Keeping the two apart is why no look can ever change a round.",
        sections: ["Motion"],
      },
      {
        slug: "skins-and-themes",
        title: "Skins and themes",
        lede: "A skin dresses one puzzle with drawings, sounds, words and motion. A theme is the look a whole set of skins share.",
        sections: ["The skin", "Themes"],
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        slug: "documents",
        title: "The documents",
        lede: "A puzzle, its skin and its theme are each one document. This page gives the shape of all three in brief, and says when a puzzle is valid, when it is ready, and what promotion does. The [API reference](/api) explains every key.",
        sections: ["The documents", "Not yet covered"],
        figure: "documents",
      },
      {
        slug: GLOSSARY_SLUG,
        title: "Glossary",
        lede: "Every word of the puzzle domain, with the one thing it means here.",
        sections: [],
      },
    ],
  },
];

export const DOMAIN_PAGES: readonly DomainPage[] = DOMAIN_GROUPS.flatMap((g) => g.pages);

export const domainPath = (slug: string): string => (slug === "" ? "/domain" : `/domain/${slug}`);
