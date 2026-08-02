---
name: typescript-behavior-tests
version: 1.0.0
status: active
scope: l99-storyengine
owners:
  - founder
review_cadence: quarterly
---

# TypeScript Behavior Tests Skill

## Purpose

Use this skill to write, repair, replace, or retire Jest/Vitest behavior tests for L99 StoryEngine TypeScript, TSX, JavaScript, Node, route, runtime, promotion, provenance, and compatibility code.

## Trigger

Invoke when the user asks to write tests, generate tests, match Jest or Vitest, review stale tests, remove old tests, prove behavior, repair CI test failures, or add regression coverage before a PR or promotion gate.

## Required with

- `skills/typescript-debugging-chain/SKILL.md` for audit, root-cause, patch, and review sequencing;
- `GLOBAL_AI.md` for founder authority and boundaries;
- `AGENTS.md` for L99 runtime, provenance, promotion, and rollback constraints.

## Core prompt

```text
Write TypeScript tests for the following code.

Rules:
- Test real behavior, not implementation details
- Cover happy path, edge cases, and failure modes
- No tests that would pass if the function were deleted
- Use Jest or Vitest (match the project's test runner)
- No mocks unless strictly necessary for external dependencies

Code:
[paste code]

Return:
- Test file with descriptive test names
- Brief note on what each test block covers
```

## Contract

Before writing tests:

1. inspect package scripts, test config, and nearby tests to match the runner and style;
2. define the behavior in terms of runtime output, API contract, state transition, provenance record, promotion gate, or compatibility result;
3. cover happy path, edge cases, and failure modes;
4. mock only true external dependencies such as network, filesystem, clock, randomness, provider APIs, or database connections;
5. choose assertions that fail if the protected behavior is removed.

## Retiring old tests

A stale test may be removed only when one of these is proven:

- the behavior was intentionally retired;
- stronger behavior coverage replaces it;
- it asserts implementation details instead of behavior and has replacement coverage;
- it depends on stale architecture or authority that has been superseded and documented.

When retiring a test, report the old file/name, the behavior it protected, the replacement proof, and remaining regression risk.

Never delete tests merely to make CI green.

## Output

Return:

1. Test file with descriptive test names;
2. Coverage notes;
3. Mocks used or no mocks used;
4. Retirement notes when replacing or deleting tests;
5. Exact verification command.

## Definition of done

The test suite change is done only when it matches the project runner, proves behavior, fails on behavior deletion, preserves or explicitly retires old coverage, and respects L99 provenance, promotion, compatibility, tenant/workspace isolation, and rollback boundaries.