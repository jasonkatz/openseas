import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { cssVariables } from "@openseas/boards/look";

/**
 * The game's look is one palette in one file (docs/BRAND.md, ADR 0061). A colour typed anywhere
 * else in the game, its boards or its guides is a bug. Milestone M10 restyles the game in steps, so
 * the files it has not reached yet are listed in `PENDING`; a file leaves the list in the PR that
 * restyles it, and this test fails if a listed file is already clean, so the list only shrinks.
 */

const PACKAGES = join(import.meta.dirname, "..", "..");
const ROOTS = ["boards/src", "client/src", "docs/src"];
const TOKENS = "boards/src/look/tokens.ts";
const HEX = /#[0-9a-fA-F]{3,8}\b|\b0x[0-9a-fA-F]{6}\b|\brgba?\(/;

const PENDING: readonly string[] = JSON.parse(readFileSync(join(import.meta.dirname, "look.pending.json"), "utf8"));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

/** A stylesheet's token block is the one place a stylesheet may hold a hex value. */
const withoutTokenBlock = (text: string): string => text.replace(/\/\* tokens:start[\s\S]*?tokens:end \*\//, "");

/** Comments may name a colour; code may not. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const typed = (path: string): boolean => HEX.test(withoutComments(withoutTokenBlock(readFileSync(path, "utf8"))));

describe("the look (docs/BRAND.md, ADR 0061)", () => {
  const all = ROOTS.flatMap((root) => files(join(PACKAGES, root))).map((path) => relative(PACKAGES, path).split("\\").join("/"));
  const dirty = all.filter((file) => file !== TOKENS && typed(join(PACKAGES, file)));

  it("types no colour outside the token module, except in files M10 has not restyled yet", () => {
    expect(dirty.filter((file) => !PENDING.includes(file))).toEqual([]);
  });

  it("lists as pending only files that still type a colour", () => {
    expect(PENDING.filter((file) => !dirty.includes(file))).toEqual([]);
  });

  it("keeps the stylesheet's token block equal to the token module", () => {
    const sheet = readFileSync(join(PACKAGES, "boards/src/styles.css"), "utf8");
    const block = /\/\* tokens:start[^\n]*\*\/\n([\s\S]*?)\n\s*\/\* tokens:end \*\//.exec(sheet);
    expect(block?.[1]).toBe(cssVariables());
  });
});
