# 0010. One ship acquisition path to make gating a config change

Status: Accepted

## Context

Ships are individually owned. In v1 every new pirate gets a free sloop because the player base is
tiny. The owner wants to gate ship ownership later as a goal to work toward.

## Decision

Ships are acquired only through a shipyard purchase with currency. The starter sloop is granted
through that same path as a zero-cost grant on account creation, defined in content. Future
gating raises the grant's requirements (voyages completed, rating tier) or its price.

## Consequences

- One code path, one ledger entry per ship, regardless of how it was obtained.
- Gating is a `content` edit, never a code change.
- The grant's eligibility rules must be expressible in content from the start.
