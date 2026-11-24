/** Every puzzle the bots can play, by id. A puzzle joins by its own file and one line here. */
import type { AnyBotGame } from "../core.js";
import { SALVAGE_BOTS } from "./salvage.js";
import { OVERLOAD_BOTS } from "./overload.js";
import { DEFLECTORS_BOTS } from "./deflectors.js";
import { REACTOR_BOTS } from "./reactor.js";
import { SCANNER_BOTS } from "./scanner.js";
import { TUG_BOTS } from "./tug.js";
import { RACKS_BOTS } from "./racks.js";
import { CUTTING_BOTS } from "./cutting.js";
import { TRACTOR_BOTS } from "./tractor.js";
import { REFINING_BOTS } from "./refining.js";
import { FREEFALL_BOTS } from "./freefall.js";
import { SHOWDOWN_BOTS } from "./showdown.js";
import { FORGING_BOTS } from "./forging.js";
import { POURING_BOTS } from "./pouring.js";

export const BOT_GAMES: Readonly<Record<string, AnyBotGame>> = {
  salvage: SALVAGE_BOTS as unknown as AnyBotGame,
  overload: OVERLOAD_BOTS as unknown as AnyBotGame,
  deflectors: DEFLECTORS_BOTS as unknown as AnyBotGame,
  reactor: REACTOR_BOTS as unknown as AnyBotGame,
  scanner: SCANNER_BOTS as unknown as AnyBotGame,
  tug: TUG_BOTS as unknown as AnyBotGame,
  racks: RACKS_BOTS as unknown as AnyBotGame,
  cutting: CUTTING_BOTS as unknown as AnyBotGame,
  tractor: TRACTOR_BOTS as unknown as AnyBotGame,
  refining: REFINING_BOTS as unknown as AnyBotGame,
  freefall: FREEFALL_BOTS as unknown as AnyBotGame,
  showdown: SHOWDOWN_BOTS as unknown as AnyBotGame,
  forging: FORGING_BOTS as unknown as AnyBotGame,
  pouring: POURING_BOTS as unknown as AnyBotGame,
};
