# ⚓ Tidebound

A modern, browser-native reimagining of the puzzle-pirate MMO: a living hex ocean of
islands, crews that sail ships together, and **duty puzzles whose results physically
drive the ship**. Built end to end in TypeScript — Vite + React + Canvas 2D on the
client, a Node WebSocket world server, and a shared package of pure, deterministic
puzzle engines that the server replays to verify every score.

## Play

```bash
pnpm install
pnpm dev          # server on :8787, client on :5173 (proxied /ws)
```

Open http://localhost:5173 in two browser windows to sail together.

Production build (single process serves the client and the WebSocket API):

```bash
pnpm build
pnpm start        # http://localhost:8787
```

Or `docker build -t tidebound . && docker run -p 8787:8787 tidebound`.

## The loop

1. **Come ashore** at Saltmarrow. Walk around (WASD / click), chat (Enter), enter buildings (E).
2. **Board a ship** at the dock. Navy sloops are free; the first aboard is captain.
3. **Take a station** on deck — each one is a puzzle, and your rating drives the ship:
   | Station | Puzzle | Effect |
   |---|---|---|
   | 🪣 Bilge | match-3 swap with rising water | pumps water → speed |
   | ⛵ Sails | Columns-style falling trios | sail power → speed & battle move tokens |
   | 🔨 Carpentry | polyomino hull patching | repairs damage |
   | 💣 Guns | line-clear stacking (powder / wad / shot) | loads cannons for battle |
   | 🧭 Helm | star-chart pipe rotation | navigation bonus |
   | ⚔️ Swordfight | Puyo-style versus with breakers | boarding actions |
4. The captain **sets a course** on the ocean chart. Brigands roam the open water.
5. **Sea battle**: 12×12 board, 20-second turns. Queue move tokens (L/F/R, earned by the
   Sails station) and cannon shots (loaded by Guns). Grapple when adjacent to board.
6. **Boarding**: the whole crew swordfights the brigands at once. Win for booty.
7. Sell goods where they're dear, buy your own ship at the shipwright, found a crew at the tavern.

## Architecture

- `packages/shared` — engines (`init / reduce / tick / score`, no `Math.random`), zod protocol,
  world data, hex math, sea-battle simulation. 230+ vitest tests.
- `packages/server` — authoritative world: islands, ships, voyages, encounters, battles,
  swordfights with NPC AI, chat, crews, economy. JSON snapshot persistence in `data/`.
- `packages/client` — React shell + Zustand store; every scene and puzzle is drawn on canvas.

Design notes live in `docs/DESIGN.md`; the puzzle contract in `docs/PUZZLE_AUTHORING.md`.

Anti-cheat: the client records every action with its elapsed time and streams checkpoints;
the server replays the log on the same seed and trusts only its own score.

## Server flags

| Env | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | HTTP + WebSocket port |
| `TIDEBOUND_DATA` | `data/world.json` | world snapshot path |
| `TIDEBOUND_BOTS` | 8 | ambient NPC islanders |
| `TIDEBOUND_ENCOUNTER` | 0.07 | per-league brigand chance while sailing |
| `TIDEBOUND_BRAWL` | off (`1`) | dev: battles start adjacent and brigands grapple at once |

## Testing

```bash
pnpm test                       # engines + server integration
pnpm --filter @tidebound/client build
TIDEBOUND_ENCOUNTER=0.7 TIDEBOUND_BRAWL=1 pnpm start &
node e2e/smoke.mjs              # two headless pirates: island → ship → puzzles → battle
node e2e/battle.mjs             # drives one pirate straight into a boarding swordfight
node e2e/shots.mjs http://localhost:5173   # screenshots each puzzle from the local harness (/?puzzle=<id>)
```
