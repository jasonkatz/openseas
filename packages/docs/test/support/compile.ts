import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "api", "sdk");

export const ENGINE_DTS = readFileSync(join(SDK, "engine.d.ts"), "utf8");

/**
 * Compiles files of TypeScript against the SDK's declarations, as a rules file would be: strict,
 * with `@openseas/engine` resolving to `engine.d.ts` and each generated puzzle type beside it.
 * Gives back what the compiler says is wrong, a line for each, with the file it is in.
 */
export function compile(files: Readonly<Record<string, string>>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "sdk-"));
  mkdirSync(join(dir, "node_modules", "@openseas", "engine"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "@openseas", "engine", "index.d.ts"), ENGINE_DTS);
  writeFileSync(join(dir, "node_modules", "@openseas", "engine", "package.json"), JSON.stringify({ name: "@openseas/engine", types: "index.d.ts" }));
  for (const gen of ["swap.puzzle.gen.ts", "tricks.puzzle.gen.ts"]) writeFileSync(join(dir, gen), readFileSync(join(SDK, gen), "utf8"));
  const roots: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
    roots.push(join(dir, name));
  }
  const program = ts.createProgram(roots, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: false,
    noUncheckedIndexedAccess: false,
    types: [],
  });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file ? `${d.file.fileName.slice(dir.length + 1)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : "";
    return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}
