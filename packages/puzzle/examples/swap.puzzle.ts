import { puzzle, grid, swap, lines, refill, budget } from "../src/index.js";

export default puzzle("swap", {
  board: grid(6, 7),
  pieces: 5,
  parts: [swap(), lines(3), refill()],
  ends: budget(20),
});
