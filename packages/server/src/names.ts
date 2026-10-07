import type { Rng } from '@tidebound/shared';
import { rngPick } from '@tidebound/shared';

const SHIP_A = ['Black', 'Salty', 'Crimson', 'Wandering', 'Iron', 'Golden', 'Rusty', 'Silent', 'Grim', 'Lucky', 'Wild', 'Broken'];
const SHIP_B = ['Gull', 'Kraken', 'Marlin', 'Pearl', 'Tempest', 'Widow', 'Cutlass', 'Anchor', 'Lantern', 'Serpent', 'Wake', 'Howl'];
const BRIGAND_A = ['Scurvy', 'One-Eyed', 'Mad', 'Red', 'Old', 'Bloody', 'Cap\'n', 'Quiet', 'Lazy', 'Sharp'];
const BRIGAND_B = ['Pete', 'Marla', 'Hob', 'Nell', 'Grell', 'Tam', 'Bess', 'Finn', 'Ysolde', 'Rook'];

export function brigandShipName(r: Rng): [Rng, string] {
  let rng = r;
  let a: string, b: string;
  [rng, a] = rngPick(rng, SHIP_A);
  [rng, b] = rngPick(rng, SHIP_B);
  return [rng, `${a} ${b}`];
}

export function brigandName(r: Rng): [Rng, string] {
  let rng = r;
  let a: string, b: string;
  [rng, a] = rngPick(rng, BRIGAND_A);
  [rng, b] = rngPick(rng, BRIGAND_B);
  return [rng, `${a} ${b}`];
}

const HAND_A = ['Tam', 'Bess', 'Rook', 'Wren', 'Oda', 'Pip', 'Jory', 'Nan', 'Kit', 'Dru', 'Sal', 'Moss'];
const HAND_B = ['Tarwater', 'Quick', 'Barnacle', 'Halyard', 'Gullwing', 'Rudder', 'Saltbeard', 'Keel', 'Driftwood', 'Marlin'];
export function deckhandName(r: Rng): [Rng, string] {
  let rng = r;
  let a: string, b: string;
  [rng, a] = rngPick(rng, HAND_A);
  [rng, b] = rngPick(rng, HAND_B);
  return [rng, `${a} ${b}`];
}
