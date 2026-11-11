import { PUZZLE_IDS, type PuzzleId } from "@openseas/engine";
import type { Guide } from "./types.js";
import { cooling } from "./cooling.js";
import { engines } from "./engines.js";
import { plating } from "./plating.js";
import { gunnery } from "./gunnery.js";
import { navigation } from "./navigation.js";
import { battle } from "./battle.js";
import { swordfight } from "./swordfight.js";
import { salvage } from "./salvage.js";
import { overload } from "./overload.js";
import { deflectors } from "./deflectors.js";
import { reactor } from "./reactor.js";
import { scanner } from "./scanner.js";
import { tug } from "./tug.js";
import { racks } from "./racks.js";
import { cutting } from "./cutting.js";

export * from "./types.js";

/** Every puzzle's guide. A puzzle the engine registers has one: `test/guides.test.ts` holds that. */
export const GUIDES: Readonly<Record<PuzzleId, Guide>> = { cooling, engines, plating, gunnery, navigation, battle, swordfight, salvage, overload, deflectors, reactor, scanner, tug, racks, cutting };

/** The guides in the order the site lists them: the game's own puzzles, then the prototypes. */
export const GUIDE_ORDER: readonly PuzzleId[] = PUZZLE_IDS;
