# 0004. PixiJS for game surfaces, React for UI

Status: Accepted

## Context

Puzzle boards, the sea battle grid, and the walkable island need a 2D renderer that holds 60fps on
phones. Menus, chat, crew panels, and lobbies are ordinary UI. Options: PixiJS, Phaser, raw Canvas
2D, DOM/CSS for everything.

## Decision

PixiJS v8 for every game surface. React with Vite for UI, overlaid on the canvas.

## Consequences

- We own the game loop and scene model, which keeps `engine` renderer-agnostic (ADR 0003).
- Phaser's bundled input, tween, and scene opinions are not taken on.
- React is chosen over lighter frameworks for reviewer familiarity and ecosystem, accepting a
  larger bundle.
