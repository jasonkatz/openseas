# Tug

Status: design brief, not built yet. Prototype (ADR 0036), on the harness at `/tug`. Untimed moves;
a 120 second round.

## The puzzle

A cargo bay in zero gravity, seven by seven, with a few fixed blocks in it and four cargo pods, each
its own shape. Nothing stops by itself here: a pod that is flicked slides in a straight line until
it meets a wall, a block or another pod.

One clamp is lit on the floor, marked with the shape of the pod it wants. Get that pod to come to
rest on the clamp (sliding over it does not count) and it is delivered: the pod stays where it is,
and a new clamp lights for some pod somewhere else.

Every clamp is dealt with a par: the fewest flicks that could deliver it, which the engine works out
when it lights the clamp. Delivering at par is a clean delivery and scores double; within two flicks
of par scores in full; slower scores half. Clean deliveries in a row build a streak. Clamps get
harder as they are delivered: par two at first, then three, then four.

A clamp that has gone wrong can be skipped for a small penalty and the streak.

## Luck and skill

- **Luck:** where the next clamp lights and for which pod.
- **Skill:** first, seeing where a pod will stop. Then, using another pod as a stop: flick the
  blocker into place, then the cargo. Then, seeing a three-flick route at a glance. Pods stay where
  they stop, so the bay a player leaves behind is the bay the next clamp is dealt on.

## Input

- Swipe starting on a pod to flick it that way. Or tap a pod to pick it, then tap or swipe a
  direction. Keyboard: 1 to 4 or tab pick a pod, arrows flick it, S skips.
- A picked pod shows where each of its four flicks would end (an engine query), as faint ghosts.
- A slide eases out and lands with a thud and a little squash; a delivery bursts on the clamp; the
  board says the flicks taken against par.
- Unrated and lab rounds show the first flick of a par route after a pause.

## Engine sketch

Moves `{ type: "flick", pod, dir }`, `{ type: "skip" }`, `{ type: "end" }`. A clamp is dealt by
construction: from the bay as it stands, play a few random flicks on a copy and take where the
wanted pod ended, so a route exists; then a breadth-first search up to that depth finds the true
par, and the deal is retried until par is the depth wanted. The search is bounded and its order
fixed. The same search gives the hint.

## To settle by simulation

- The number of blocks, so the bay has enough stops to be interesting and not so many that every
  clamp is one flick away.
- That dealing a clamp is quick enough to run on every delivery, on the server too (keep the search
  to depth four on a seven by seven bay, and measure it).
- The scores for clean, full and slow deliveries, and the skip penalty.
