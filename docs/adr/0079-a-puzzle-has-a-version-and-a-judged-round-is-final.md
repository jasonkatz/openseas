# 0079. A puzzle has a version, and a judged round is final

Status: Accepted. Builds on [0003](./0003-pure-engine-replay-verification.md), whose replay from the log
it bounds by version, and [0028](./0028-standing-is-earned-in-the-game.md), whose recorded rounds and
standing it keeps across a change.

## Context

The host is the only authority because it replays every round from its seed, settings and log (ADR
0003). A log only replays the same on the rules it was played on, and the puzzle domain guide
(`docs/puzzles/DOMAIN.md`) had no word for a puzzle's version and listed rule versions under "Not yet
covered". Nothing said what becomes of stored rounds, standing, ladder places or rounds still being
played when a puzzle changes. The server's `puzzle_round` table keeps a round's seed and move log but
neither its settings nor any version, so an old round may already not replay the same once a default
changes.

## Decision

1. **A puzzle has a version, `major.minor`,** one for the rules and the puzzle document together.
   Every puzzle starts at `1.0`, prototypes too, and promoting a prototype into the game keeps its
   version running.
2. **The major rises when a change can make a stored round replay differently** from the same seed,
   settings and log: the rules, the deal, the board, pieces, moves, events, tempo, endings or the log
   cap. The minor goes back to 0.
3. **The minor rises for any other change to a number in the puzzle document:** a setting's default or
   bounds, a relation, tier starts, the ladder, the pace window. These change what new rounds are dealt
   or how they are judged, never how a stored round replays, because a stored round keeps every
   setting's value.
4. **Wording and skins raise nothing.** A setting's `line`, the `mechanic`, and any drawing, cue, text
   or motion change no round.
5. **A stored round keeps** the puzzle id and version, the seed, every setting's value (not only those
   changed from a default) and the layers on, the log, and the score, performance and tier the host
   judged.
6. **A judged round is final.** It is never judged again, even when a later version would score its log
   differently. The standing and ladder places built from it stand.
7. **A round is played and judged on the version it was dealt on.** Every new round is dealt on the
   current version, so the sides of a versus round always share one, and a ghost is drawn only from
   rounds of the same version. The host keeps the previous
   major's rules until every round dealt on it could have ended, as the log cap and the clock bound,
   then refuses logs for it.
8. **Replay is promised for the current and previous major only.** A round from an older major still
   shows its score and tier but cannot be watched again. A host may keep more.
9. **Standing carries over unchanged.** Tier starts put every version on the one scale. The host may
   widen how unsure it is of a standing after a change, and never resets it.
10. **Ladder places are kept by stage id.** A player whose stage is gone moves to the next stage that
    still exists, never back. Rounds already played at a stage count toward its threshold.
11. **Each puzzle keeps witness rounds:** a few recorded rounds, each a seed, settings, log and the read
    it must give. A change that alters any of them without raising the major fails the checks. Raising
    the major records them again.
12. **The version rises once, when a change merges,** not at each Save in the studio. Finishing a draft
    by the `puzzles` skill includes raising it, and the witness check enforces the major. Studio rounds
    on a draft count for nothing.
13. **A skin has no version.** It must be ready against the puzzle's current version, and that is
    checked whenever the version rises.
14. **The puzzle document keeps a history,** one plain line for each version. A host may show the
    newest line when a player first meets a new version.

## Alternatives considered

- **One whole number.** Simpler, but a retuned default or tier start would look the same as new rules,
  and a host could not tell which rounds still replay on the current code. `major.minor` says that in
  the number.
- **Re-judging old rounds on the new version.** Standing would move under players who did nothing, and
  every version's rules would have to replay every round.
- **Keeping every version's rules forever.** It would promise any old round can be watched, at the cost
  of carrying every past engine in the code. Two majors cover rounds in flight and recent checks.
- **Resetting standing at a major.** It throws away what tier starts exist to carry across.
- **A version per skin.** A skin changes no round, so its readiness check is enough.

## Consequences

- The domain guide gains a Versions section, `version` and `history` in the puzzle document, witness
  rounds in what makes a puzzle ready, and loses "Rule versions" from "Not yet covered".
- The glossary gains version, major, minor, witness round, history and stored round, and the log's
  entry says a round replays on the version it was dealt on.
- In the code, puzzles carry no version, the server's `puzzle_round` keeps no version or settings, and
  there are no witness rounds. Storing them, the witness check and the host's hold on the previous
  major are each a change of their own.
- ADR 0075's wait is answered: moving an engine from one generator to a stream a draw changes what a
  seed deals, so it raises that puzzle's major.
