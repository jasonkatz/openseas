import type { DraftNumbers } from "@openseas/protocol";

/** What a running agent says back to the service, in order. */
export type AgentEvent =
  /** The session the next turn resumes. */
  | { kind: "session"; id: string }
  /** The agent's words, a whole block at a time. */
  | { kind: "reply"; text: string }
  /** One thing it is doing: a tool, and a line saying what with. */
  | { kind: "step"; id: string; tool: string; summary: string }
  /** How that step went: its output or diff, cut to a readable length. */
  | { kind: "stepDone"; id: string; detail: string; failed: boolean };

/** What the service gives a turn: the rules it is held to and the one thing it can change besides files. */
export interface TurnHost {
  /** Whether the agent may write this path (absolute, or relative to the worktree). A refusal is recorded for the owner to see. */
  mayWrite(path: string): boolean;
  /** Set draft numbers by their key in the content file, and put others back to shipped. The words the agent is told. */
  setNumbers(set: Record<string, unknown>, reset: string[]): Promise<string>;
  /** The draft's numbers now, for the agent to read. */
  numbers(): Promise<DraftNumbers>;
  emit(event: AgentEvent): void;
}

export interface TurnRequest {
  /** The draft's worktree. */
  cwd: string;
  puzzle: string;
  /** The owner's message with the draft's numbers and recent rounds under it. */
  prompt: string;
  /** The model's id. */
  model: string;
  /** The session to resume, or null for a draft's first turn. */
  session: string | null;
  /** Where the agent's process reaches a model, and the token that lets this turn through (chat/proxy). */
  modelUrl: string;
  modelToken: string;
  host: TurnHost;
}

export interface TurnResult {
  status: "done" | "failed";
  /** Why it failed, for the log. */
  error?: string;
}

export interface AgentTurn {
  /** Resolves when the turn is over, however it ended. Never rejects. */
  readonly done: Promise<TurnResult>;
  /** A message sent while the turn runs: it joins the turn. */
  steer(text: string): void;
  /** Stop now. `done` then resolves. */
  stop(): void;
}

/** What runs a turn. The service's own is the Claude Agent SDK (chat/sdkRunner); a test hands in a scripted one. */
export interface AgentRunner {
  start(request: TurnRequest): AgentTurn;
}

/** What the agent is told beyond `CLAUDE.md` and the skills it loads from the worktree. */
export const STUDIO_PROMPT = (puzzle: string): string =>
  [
    `You are working inside the openseas puzzle studio, for the owner, on one puzzle: \`${puzzle}\`. Your working directory is this draft's own git worktree of the repository. Start any change to the puzzle with the \`puzzles\` skill.`,
    "",
    "How the studio works, and what it holds you to:",
    "- A number that has a control is changed with the `set_numbers` tool, never by editing the content file: every key under `config`, `roundSeconds`, `paceSeconds` and `thresholds`. The owner's controls move at once and the board deals on the new numbers. Save writes them into the content file later. `get_numbers` reads what the draft changes now.",
    "- Edit files only for what no control expresses: rules, board code, structural constants, strings, design files, guides.",
    `- You may write the puzzle's own files without asking: its engine, protocol schema, content, messages, board, briefs, design file, guide and studio page. A write anywhere else is refused by the studio. When one is, do not work around it: say which path you need and why, and stop there. The owner can allow that path for this draft, and you will be told.`,
    "- Do not commit, push, switch branches or open pull requests. The studio commits each turn's edits when the turn ends, so the owner can revert a turn, and Save pushes them.",
    "- The owner sees a code change only on the pull request's preview deploy, after Save: the board beside this chat runs the shipped build with the draft's numbers. Whenever you edit code, say so in your reply, so they know to Save and look there.",
    "- New sprites and sounds are takes, made with the `puzzle-sprites` and `puzzle-sounds` skills' scripts. You are not in a cloud session and cannot send files: when your turn ends the studio keeps every take the scripts made and lists each in the owner's Sprites or Sounds panel, under its frame or cue, numbered as the script numbered it (`take 3`). The owner looks and listens there, on the running board. So make the takes, say which frames or cues have new ones and which you would shortlist, and end the turn. The owner picks a take with a tap in that panel: the pick is part of the draft, changes the board at once, and is listed under each message as the draft's picks. You have no tool that picks, and the owner picks every take. Never run either script's `place`: Save places the draft's picks, in the atlas and the sounds folder (ADR 0053). If the owner names a take here, ask them to pick it in its panel and Save. Each take costs money the owner's cap counts: make the script's default number unless asked for more.",
    "- Each message ends with the draft's numbers, what the current build refuses of them, and the last rounds played. Use them: \"that felt too easy\" has the rounds behind it.",
    "- Be brief. The owner is tuning with one hand on the board.",
  ].join("\n");
