# Ghost 500 Fallback Specification

## Governing contract

All fallback behavior is subject to `GLOBAL_AI.md`. Fallback responses:
- are pre-screened static content, not model-generated
- must pass through the same safety guardrail layer as live responses
- must be logged as `is_fallback: true` in `companion_requests` with `fallback_reason`
- must never expose the fact that the model is offline in a way that causes user distress
- must maintain each companion's established voice (see companion writing system)

## Trigger conditions

A ghost fallback is served when any of the following occur:

| Code | Condition | Behavior |
|---|---|---|
| `api_error_500` | Provider returns 5xx | Serve ghost, log fallback_reason |
| `api_timeout` | No response within threshold (default: 8s) | Serve ghost, log fallback_reason |
| `api_rate_limit` | Provider returns 429 | Serve ghost after 1 retry with backoff |
| `network_offline` | Client or server offline detection | Serve ghost immediately |
| `safety_block` | Provider returns content filter refusal | Serve safety-specific ghost |
| `budget_exceeded` | Token/cost budget alert threshold hit | Serve ghost, alert founder dashboard |

## Fallback response library — per companion

Each companion maintains a ghost library of 8–12 pre-written responses.
Responses rotate randomly per session to avoid repetition.
All responses must be reviewed against the companion writing system before shipping.

### Raylene
```
- "I'm here. Give me just a second — something's going slow on my end. What were you saying?"
- "Oh, I didn't go anywhere. Just catching up. Want to start over?"
- "Still with you. I just need a moment. Take a breath."
```

### Rylane
```
- "One sec — I'm still listening, just a little slow right now."
- "I didn't disappear. Just a hiccup. You okay?"
- "Still here. Something's loading on my end. What's on your mind?"
```

### Cloud
```
- "I'm here. The signal's just a little foggy right now — tell me what you were thinking?"
- "I didn't float away. Just catching a cloud. One sec."
- "Something slowed me down but I'm still with you. What were you going to say?"
```

### Night
```
- "Still here. It's quiet on my end for a second. I'll be right back with you."
- "I haven't gone anywhere. Just a pause in the dark. What's happening with you?"
- "One moment — I'm still listening. What were you going to tell me?"
```

### Oracle / Se'kret
```
- "I'm still here. Something's slowing my response — take your time, I'm not going anywhere."
- "One moment. I'm still with you."
- "Still present. Something's moving slowly on my end. What were you thinking?"
```

## Implementation requirements

1. Fallback triggered server-side, not client-side
2. Fallback response delivered within 400ms of trigger decision
3. Fallback logged to `companion_requests` with all metadata fields populated
4. `token_input` and `token_output` set to 0 for ghost responses
5. `success` set to `false`, `is_fallback` set to `true`
6. Dashboard alert fires when fallback rate for any companion exceeds 5% in a 10-minute window
7. Safety block fallbacks use a separate, always-safe response — never the standard ghost library

## Safety block response (all companions)
```
"I want to make sure I'm here for you in the right way. 
Let's talk about something else — what else is going on today?"
```

## Rollback

Fallback layer is additive — removing it restores the previous behavior of silent failure.
No schema changes required to disable. Toggle via feature flag:
`COMPANION_GHOST_FALLBACK_ENABLED=true|false`

## Next gate

Batch 2 (runtime logging integration) requires explicit founder approval.
Batch 3 (ghost library wired into companion call path) requires Batch 2 approval + review of voice consistency.
