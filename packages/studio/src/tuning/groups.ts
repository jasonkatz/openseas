/**
 * The tuning panel's sections (DESIGN.md 3.14), the same five for every puzzle so the owner finds
 * a number in the same place on each: what the board is, what the deal puts on it, how fast the
 * round moves, what play is worth, and the bounds that only keep a round or its log sane. Their
 * names are in the message table under `studio.group.<id>`.
 */
export const GROUP_IDS = ["board", "deal", "pace", "scoring", "limits"] as const;
export type GroupId = (typeof GROUP_IDS)[number];

/**
 * Which section each of a puzzle's config keys is tuned in, in the order the panel shows them. A
 * key is its dotted path under `config` as the content file spells it; a parent's path stands for
 * every key under it. One small file a puzzle in `groups/`; test/tuning.test.ts holds each to
 * naming every key of its content file exactly once.
 */
export type TuningGroups = Readonly<Partial<Record<GroupId, readonly string[]>>>;
