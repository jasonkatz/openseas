# 0069. Rating is a mode of its own

Status: Accepted. Supersedes the line of [0056](./0056-the-studio-is-laid-out-as-a-design-tool.md)
decision 3 that says rating is not a mode of its own and puts it in Scoring. The rest of ADR 0056
decision 3, and [0068](./0068-the-board-plays-from-every-mode-and-a-panel-can-open-wide.md), stand.

## Context

ADR 0056 kept the rating (the live tier's window and the thresholds) in Scoring: a short list
that belonged with what it rates. ADR 0068 then let a panel open wide, and a wide Scoring panel
drew both its curves as charts and the thresholds as a scale with the page's rounds on it. The two
halves asked different questions of the owner. Scoring asks what play is worth; Rating asks what
a score is worth, and where the rounds just played landed. In one panel each crowded the other, and
the owner asked for them apart.

## Decision

1. **Rating is the fourth numbers mode,** after Scoring on the rail, with its own icon and line.
   `MODE_SECTIONS` gives Scoring the scoring group and Rating the rating section (the live tier's
   window and the thresholds). A puzzle's groups file is unchanged.
2. **Wide, the thresholds take the panel's width:** the scale drawn long, with the page's rounds on
   it, and each threshold a tile under it.
3. **The search is unchanged:** it finds a number in any numbers mode, Rating among them.

## Alternatives considered

- **Two tabs inside Scoring.** The same split, one level further down, and a tab the rail's
  search and the top bar's list would have to open too.
- **Leave them together.** The panel the owner found crowded.

## Consequences

- The rail has eight modes. A smoke that looks for the thresholds or the pace turns to
  `tab-rating`.
- The strings `studio.mode.rating` and `studio.mode_hint.rating` are new; Scoring's line says only
  what play is worth.
