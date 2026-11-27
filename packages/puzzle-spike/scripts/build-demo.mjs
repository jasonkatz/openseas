// THROWAWAY SPIKE. Builds demo/dist/swap-spike.html: one file, everything inline.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = await build({ configFile: false, logLevel: "warn", build: { write: false, minify: false, lib: { entry: here("../demo/main.ts"), formats: ["iife"], name: "spike" } } });
const code = (Array.isArray(out) ? out[0] : out).output[0].code;
mkdirSync(here("../demo/dist"), { recursive: true });
writeFileSync(here("../demo/dist/swap-spike.html"), `${readFileSync(here("../demo/page.html"), "utf8")}<script>\n${code.replaceAll("</script", "<\\/script")}\n</script>\n`);
console.log("wrote demo/dist/swap-spike.html");
