# Human-Safe Build Contract

This repository is built for the human creating, reviewing, or receiving the story output, not merely for code completion.

## Core rule

A user-facing screen, generation workflow, route, approval gate, or artifact state must not resolve to silence when the system knows enough to show a state.

Do not use `return null` for loading, error, empty, denied, offline, unavailable, recovery, or transitional states that can block understanding or action.

## Required human-facing states

Every story workflow must provide the applicable state with clear language and an honest next action:

- loading or checking;
- success;
- empty;
- denied or permission-limited;
- offline or degraded;
- error;
- recovery, retry, back, revise, or safe exit.

Never imply that a story, artifact, provenance record, release gate, or generation is complete when evidence is missing.

## Where `null` remains valid

`null` may remain in data, parser, service, storage, cache, and optional-value contracts when it explicitly means `not found`, `not configured`, or `not applicable`.

That contract must be typed or tested. A human-facing caller must translate it into a visible state whenever the absence affects comprehension, trust, provenance, authorship, or the next action.

Optional decorative elements may render nothing only when their absence cannot hide progress, failure, denial, important data, or a required action.

## Safe implementation loop

### Observe

Inspect the active route, generator, caller, exact branch head, existing tests, and rendered behavior. Distinguish a valid data sentinel from a blank-state defect.

### Orient

Red-team slow generation, empty prompts, malformed inputs, provider failures, missing provenance, denied access, stale artifacts, network loss, and narrow/mobile layouts.

### Decide

Choose the smallest proven repair. Prefer platform primitives and existing components. Do not add a dependency when plain JavaScript, Node.js, browser, or server behavior is sufficient.

### Act

Render the missing state, preserve authorship and provenance boundaries, add a focused regression test, and run the exact applicable proof gates.

## Proof requirements

- Unit or source-contract proof for the state decision.
- Type, test, and build proof where applicable.
- Playwright proof for changed rendered behavior.
- Exact-head CI evidence before merge.

A screenshot, design mock, or green unrelated workflow is not runtime proof.

## Red-team constraints

Never replace `null` mechanically across a repository. Blind replacement can invent content, obscure provider failure, weaken denial states, or break optional contracts.

Never show a completed or released state when the underlying generation, evidence, or provenance is unknown or failed.

## Definition of done

The change is complete when the human can tell:

1. what the system is doing;
2. what happened;
3. whether the artifact and its provenance are trustworthy;
4. what they can do next;
5. how to recover when recovery is possible.

Build the smallest safe thing, prove it at the exact head, and leave no human staring into an empty frame.
