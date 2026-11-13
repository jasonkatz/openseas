import type { PuzzleId } from "@openseas/engine";
import type { TuningGroups } from "../groups.js";
import { groups as cooling } from "./cooling.js";
import { groups as engines } from "./engines.js";
import { groups as plating } from "./plating.js";
import { groups as gunnery } from "./gunnery.js";
import { groups as navigation } from "./navigation.js";
import { groups as battle } from "./battle.js";
import { groups as swordfight } from "./swordfight.js";
import { groups as salvage } from "./salvage.js";
import { groups as overload } from "./overload.js";
import { groups as deflectors } from "./deflectors.js";
import { groups as reactor } from "./reactor.js";
import { groups as scanner } from "./scanner.js";
import { groups as tug } from "./tug.js";
import { groups as racks } from "./racks.js";
import { groups as cutting } from "./cutting.js";

/** Every puzzle's sections, by id. A new puzzle adds its file and its line here. */
export const TUNING_GROUPS: Readonly<Record<PuzzleId, TuningGroups>> = { cooling, engines, plating, gunnery, navigation, battle, swordfight, salvage, overload, deflectors, reactor, scanner, tug, racks, cutting };
