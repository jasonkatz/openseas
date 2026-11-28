import type { ComponentType, ReactNode } from "react";

/**
 * The figures a page of prose can place with `<!-- figure: name -->`. Each is laid out in HTML, not
 * drawn in SVG, so its words stay the size of the page's and it folds into one column on a phone.
 * A figure's words are long-form writing, like the prose around it, and live here with it.
 */

function Diagram({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  return (
    <figure className="diagram" role="group" aria-label={label}>
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Part({ name, line, items, tone }: { name: string; line: string; items?: readonly string[]; tone?: "core" }) {
  return (
    <div className={`part ${tone === "core" ? "part-core" : ""}`}>
      <b>{name}</b>
      <span>{line}</span>
      {items && (
        <ul>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Arrow = () => <span className="flow-arrow" aria-hidden="true" />;

/** The puzzle, and the four things around it that each own what it does not. */
function Around() {
  return (
    <Diagram label="A puzzle and what sits around it" caption="A puzzle holds rules and numbers. Everything else is added around it, and none of it can change a round.">
      <div className="dg dg-around">
        <div className="dg-col">
          <span className="dg-head">Dress it</span>
          <Part name="Skin" line="The drawings, sounds, words and motion for one puzzle" />
          <Part name="Theme" line="The look a whole set of skins share" />
        </div>
        <div className="dg-col">
          <span className="dg-head">The puzzle</span>
          <Part name="Puzzle" line="Rules played in rounds" tone="core" items={["Board and pieces", "Moves and events", "The deal", "Scoring", "Layers and a ladder"]} />
        </div>
        <div className="dg-col">
          <span className="dg-head">Run it</span>
          <Part name="Host" line="Runs rounds, replays them and keeps each player's standing" />
          <Part name="Role" line="Gives the puzzle a job in a world, and turns tiers into rewards" />
        </div>
      </div>
    </Diagram>
  );
}

/** What a round takes in and gives out. */
function Round() {
  return (
    <Diagram label="What goes into a round and what comes out" caption="The same seed, settings and log always make the same round. That one promise is what lets a host check any score by playing the round again.">
      <div className="dg dg-flow">
        <div className="dg-col">
          <span className="dg-head">Goes in</span>
          <Part name="Seed" line="Fixes the luck" />
          <Part name="Settings" line="The numbers, and the layers that are on" />
          <Part name="Log" line="Every move, signal and seat entry, with its time" />
        </div>
        <Arrow />
        <div className="dg-col">
          <span className="dg-head">The round</span>
          <Part name="Rules" line="Decide what each entry does" tone="core" />
        </div>
        <Arrow />
        <div className="dg-col">
          <span className="dg-head">Comes out</span>
          <Part name="Events" line="What happened, in order" />
          <Part name="Score" line="Read for each seat" />
          <Part name="Tier" line="The score, judged on one shared scale" />
        </div>
      </div>
    </Diagram>
  );
}

const STAGES: readonly { name: string; hooks: readonly string[]; again?: boolean }[] = [
  { name: "Start", hooks: ["onStart", "onFallback", "onOpen"] },
  { name: "Wait", hooks: ["whoseTurn", "onTurn", "pickMove"], again: true },
  { name: "Check", hooks: ["canMove"], again: true },
  { name: "Move", hooks: ["onMove"], again: true },
  { name: "Cascade", hooks: ["onCascade"], again: true },
  { name: "Move end", hooks: ["onMoveEnd"], again: true },
  { name: "Close", hooks: ["pointsFor", "onTaskNeeded", "onClose"], again: true },
  { name: "End", hooks: ["onEnd", "placing", "score"] },
];

/** The loop every round runs, with the hooks asked at each stage. */
function Loop() {
  return (
    <Diagram label="The loop every round runs" caption="One loop, the same for every puzzle. The six stages in the middle run again for every entry, until an ending is met.">
      <ol className="dg dg-loop">
        {STAGES.map((s, i) => (
          <li key={s.name} className={s.again ? "again" : undefined}>
            <span className="dg-n">{i + 1}</span>
            <b>{s.name}</b>
            <span className="dg-hooks">
              {s.hooks.map((h) => (
                <code key={h}>{h}</code>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </Diagram>
  );
}

/** The four files that make a puzzle. */
function Documents() {
  return (
    <Diagram label="The four files that make a puzzle" caption="The puzzle document and the rules decide every round. The skin and its theme decide only how it looks, sounds and reads.">
      <div className="dg dg-files">
        <div className="dg-col">
          <span className="dg-head">What happens</span>
          <div className="part part-core">
            <code>&lt;id&gt;.puzzle.json</code>
            <span>What exists: the board, pieces, moves, events and what each pays</span>
          </div>
          <div className="part">
            <code>&lt;id&gt;.rules.ts</code>
            <span>What a move does. The only code, and it names the document's ids</span>
          </div>
        </div>
        <div className="dg-col">
          <span className="dg-head">How it looks</span>
          <div className="part">
            <code>&lt;id&gt;.skin.json</code>
            <span>Dresses one puzzle: drawings, cues, motion and words</span>
          </div>
          <div className="part">
            <code>&lt;theme&gt;.theme.json</code>
            <span>What its skins share: palette, type and a sound frame</span>
          </div>
        </div>
      </div>
    </Diagram>
  );
}

export const FIGURES: Readonly<Record<string, ComponentType>> = { around: Around, round: Round, loop: Loop, documents: Documents };
