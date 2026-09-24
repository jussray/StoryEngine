# Media Router ↔ Domain Protocol Contract v1

## Authority

> Media Router routes and stores. `/MAKEVIDEO` classifies and approves.

The router is execution infrastructure, not StoryEngine's release authority. A technically successful routed asset is not automatically cleared for claims, commercial use, cross-project reuse, or publication.

`/MAKEVIDEO` **can grant authority**. A valid grant carries a resolvable `sourceRecordId`, an approval level, a timestamp, and an immutable fingerprint. The router may mirror that grant, but it may not invent one.

This deliberately separates two facts:

- an execution/evidence receipt may say `authority_granted: false` because evidence is not itself permission;
- a `/MAKEVIDEO` domain authority grant may say `authority_granted: true` because the domain protocol has actually approved a bounded use.

## Required attack-flow bundle

Every production handoff carries exactly one record for each gate:

1. production council
2. founder-value / GaryVee
3. Lindy
4. Red Team I
5. L99
6. Red Team II
7. OODA
8. Attack Ten
9. Attack 20
10. truthmode
11. confess
12. proof

Any blocking verdict blocks routing. The bundle fingerprint is part of the handoff fingerprint, so changing governance evidence changes the executable handoff identity.

## Publication boundary

The FCR Media Router never self-authorizes publication. StoryEngine release permission comes from `/MAKEVIDEO` and remains scoped to the approved release receipt. Publication execution is a separate handoff.

For `published_release`, a `releaseReceiptId` is mandatory.

## Reference boundary

Per-asset `maySendToExternalProvider` policy is evaluated before provider cost. A protected reference does not become externally transmissible because a cheaper model exists.

## Revocation

Revocation is additive. Prior receipts remain immutable; new revocation evidence marks downstream uses for review or takedown.

## Versioning

Approval levels, source protocols, intended-use values, and attack-flow ids are closed sets. Adding a value requires a new contract version.
