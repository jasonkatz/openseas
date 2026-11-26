import type { Need, Rule } from "../schema/types.js";

/**
 * The rules SDK as data. Every hook, every member of a view and a context, and every type they
 * name is written here with its signature, its parameters, what it returns and what is refused.
 * The pages are drawn from it, the search finds every member in it, and the tests hold each
 * signature to the declarations in `content/api/sdk/engine.d.ts` and compile every example.
 *
 * Every string a reader sees is inline Markdown. A `type` or a `signature` is TypeScript.
 */

/** One value a parameter takes or a call gives back, and what it means. */
export interface Value {
  readonly value: string;
  readonly description: string;
}

export interface Param {
  readonly name: string;
  readonly type: string;
  readonly optional?: boolean;
  readonly description: string;
  /** What leaving it out means, where it may be left out. */
  readonly absent?: string;
  /** Each value it may take, where they are few. */
  readonly values?: readonly Value[];
  /** What it holds, where it is an object written in place. */
  readonly fields?: readonly Param[];
  readonly rules?: readonly Rule[];
}

export interface Returns {
  readonly type: string;
  readonly description: string;
  /** Each case of what comes back, and what it means. One for every part of a union. */
  readonly values?: readonly Value[];
}

/** The puzzle an example is written for. Each has a generated type beside the declarations. */
export type Fixture = "swap" | "tricks";

export interface CodeExample {
  readonly title: string;
  readonly note?: string;
  readonly code: string;
  readonly puzzle: Fixture;
  /**
   * How the code stands in a file: `file` is a whole file, `rules` is one or more hooks of a
   * rules object, and `body` is statements inside a hook, with `ctx`, `view`, `seat`, `side`
   * and an event's `e` at hand.
   */
  readonly wrap: "file" | "rules" | "body";
  /** The rules' state the example assumes, as a type. An empty object where unsaid. */
  readonly state?: string;
  /** Helpers the example calls and does not show, as declarations. */
  readonly given?: string;
}

export type MemberKind = "hook" | "method" | "property" | "function";

/** The stages of the loop a hook is asked in. */
export type Stage = "Start" | "Wait" | "Check" | "Move" | "Cascade" | "Move end" | "Close" | "End";

export interface Member {
  readonly name: string;
  readonly kind: MemberKind;
  /** As it is declared, or for a hook, as a rules file writes it. */
  readonly signature: string;
  readonly description: string;
  readonly about?: readonly string[];
  /** A hook only: whether a rules file must have it, and what the loop does without it. */
  readonly need?: Need;
  readonly absent?: string;
  /** A hook only: what it is handed. */
  readonly given?: "context" | "view" | "values";
  readonly stages?: readonly Stage[];
  /** A hook only: how often it is asked. */
  readonly asked?: string;
  /** A hook only: what the loop has done before it asks, and what it does with the answer. */
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  /** Another way the same hook may be written. */
  readonly each?: { readonly signature: string; readonly note: string };
  readonly params?: readonly Param[];
  readonly returns?: Returns;
  /** When the engine refuses the call. Each stops the round and names what was wrong. */
  readonly refused?: readonly string[];
  readonly rules?: readonly Rule[];
  /** What it holds, where that is defined on this page: a draw's methods, an event's builder. */
  readonly members?: readonly { readonly title: string; readonly name: string; readonly note?: string; readonly members: readonly Member[] }[];
  readonly examples?: readonly CodeExample[];
  /** True where it has a page of its own under its object. */
  readonly page?: boolean;
  /** A context's member that is a view's: where it is defined. */
  readonly from?: string;
}

export type SdkRootId = "hooks" | "view" | "context";

export interface SdkRoot {
  readonly root: SdkRootId;
  /** The interface it is in the declarations. */
  readonly name: string;
  readonly title: string;
  readonly lede: string;
  readonly about: readonly string[];
  readonly groups: readonly { readonly title: string; readonly note?: string; readonly members: readonly Member[] }[];
  readonly holds?: { readonly title: string; readonly items: readonly string[] };
  readonly example: CodeExample;
}

/** A type the SDK names, down to what it is made of. */
export interface TypeDef {
  readonly name: string;
  /** As it is declared. */
  readonly definition: string;
  readonly description: string;
  readonly detail?: readonly string[];
  readonly fields?: readonly Param[];
  readonly values?: readonly Value[];
  /** Where a value takes one of several forms: each form and what it holds. */
  readonly forms?: readonly { readonly label: string; readonly type: string; readonly description: string; readonly fields?: readonly Param[] }[];
  readonly examples?: readonly string[];
}

export const only = (text: string): Rule => ({ kind: "only", text });
export const never = (text: string): Rule => ({ kind: "never", text });
export const must = (text: string): Rule => ({ kind: "must", text });
