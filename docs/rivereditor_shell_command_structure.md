# RiverEditor Multi-Mode Shell Command Structure

## Goal

Provide one front-door command system for RiverEditor so users can switch between authoring, ghostwriting, caveman rewriting, continuity, audit, and release workflows without leaving the main shell.

## Mode prefixes

### `>` Action mode

Use for navigation, product actions, project switching, and dashboard opening.

Examples:

```text
> project open fantasy-series
> chapter 12
> dashboard ooda
> open events
```

### `/` Writing mode

Use for AI writing, editing, style, review, and text-transformation commands.

Examples:

```text
/chapter generate
/outline build
/summary refresh
/ghost apply profile_noir
/caveman rewrite
/proofread run
/audit continuity
```

### `:` Operator mode

Use for system-level and operational actions.

Examples:

```text
:open ooda
:open episode inc_20260707_alpha_001
:run shadow-validation
:emit lindy-event
:show events
```

### `@` Agent mode

Use to route work to named agents or personas.

Examples:

```text
@editor review chapter_12
@continuity audit arc_2
@lindymode check drift
@release prepare
```

### `?` Query mode

Use for lookup, inspection, and read-only questions.

Examples:

```text
? events tenant_alpha
? drift chapter_12
? release blockers
? episode inc_20260707_alpha_001
```

## Command groups

### Authoring

- `/chapter generate`
- `/outline build`
- `/summary refresh`
- `/tone calibrate`

### Style

- `/ghost apply <profile_id>`
- `/ghost audit <profile_id>`
- `/caveman rewrite`
- `/style chain ghost->caveman <profile_id>`

### Review

- `/proofread run`
- `/grammar fix`
- `/audit continuity`
- `/audit release`

### Operations

- `:open ooda`
- `:open episode <correlation_id>`
- `:run shadow-validation`
- `:emit lindy-event`
- `:show events`

## Pipelines

RiverEditor should support chained commands for common workflows:

```text
/style chain ghost->caveman->proofread profile_noir
/pipeline release
```

A release pipeline can expand into:

```text
outline
→ continuity audit
→ ghost profile pass
→ caveman rewrite
→ grammar fix
→ proofread
→ release audit
```

## Event emission

Every shell command should be able to emit events to the shared L99 event bus:

```text
shell.command_started
shell.command_completed
shell.command_failed
```

Commands that invoke runtime operations may also emit producer-specific events such as:

```text
lindymode.state_drift_detected
shadow.started
promotion.blocked
```

## Core invariant

> One shell, many modes, one event spine.
