// THROWAWAY SPIKE. `pnpm --filter @openseas/puzzle-spike expand` writes Swap's expansion beside its seven lines.
import { writeFileSync } from "node:fs";
import swap from "../examples/swap.puzzle.js";
import { expand, explain } from "../src/index.js";

const out = expand(swap);
writeFileSync(new URL("../examples/expanded/swap.puzzle.json", import.meta.url), out.document);
writeFileSync(new URL("../examples/expanded/swap.rules.generated.ts.txt", import.meta.url), out.rules);
console.log(explain(swap));
