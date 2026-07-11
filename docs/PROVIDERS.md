# L99 Provider Guide

L99 uses providers as replaceable capabilities. Provenance, isolation, event history, canon, approvals, and recovery remain owned by L99.

## Claude / Claude Code

Best for long-context analysis, schema-aware implementation, repository-wide dependency tracing, and documentation. It must distinguish the root Python runtime from `story-engine/` and may not infer unseen deployment state.

## Codex / ChatGPT

Best for debugging, code review, tests, data analysis, PR operations, and founder-readable decisions. Tool proof is required for claimed writes, checks, merges, or deployments.

## OpenAI Platform

Server-side model capability behind versioned adapters. Keep keys off clients. Record model, prompt, tool schema, source evidence, cost, and fallback. Model output is not authorization, canon, or release approval.

## Anthropic Platform

Server-side model capability behind versioned adapters. Keep keys off clients. Conversation context is not durable memory. Validate outputs before event, database, artifact, or creator-facing writes.

## Perplexity

Current public research and source discovery. It does not know private runtime, event, cache, database, or deployment state unless those sources were explicitly connected and inspected.

## GitHub

Source, review, CI evidence, and provenance. A commit, PR, merge, deployment, and healthy runtime are separate states. Promotion gates must be tied to real evidence rather than decorative badges.

## Required provider handoff

Every handoff should state:

- subsystem and source of truth;
- tenant/workspace/user boundary;
- verified inputs and provenance;
- requested decision or action;
- approval state;
- output schema or artifact;
- validation and proof;
- rollback or fallback;
- sensitive information intentionally excluded.

The provider may generate the result. L99 must still know where it came from, who it belongs to, whether it is allowed, and how to revoke it.