# Companion Pipeline Dashboard Spec

## Source of truth

`companion_requests` table (Supabase). Dashboard reads only — no writes.
Dashboard must not invent truth outside this event stream.

## Key metrics

| Metric | Query |
|---|---|---|  
| P50/P95/P99 latency by companion | percentile_cont on latency_ms grouped by companion_id |
| Fallback rate (%) | COUNT(is_fallback=true) / COUNT(*) per 10-min window |
| Success rate by model | COUNT(success=true) / COUNT(*) grouped by model_used |
| Token cost by companion | SUM(token_input + token_output) grouped by companion_id, date |
| Error frequency by code | COUNT(*) WHERE success=false grouped by error_code |
| Session health | COUNT(DISTINCT session_id) WHERE success=true vs false |

## Alert thresholds

| Alert | Threshold | Action |
|---|---|---|
| Fallback rate > 5% in 10 min | Any companion | Notify founder dashboard immediately |
| P95 latency > 6s | Any companion | Log + alert |
| All models failing | success=false for 100% of requests in 5 min | Critical alert — companion offline |
| Budget burn rate > $X/hr | Token cost exceeding set threshold | Notify + trigger fallback mode |

## Required columns in every dashboard row

`id`, `companion_id`, `model_used`, `latency_ms`, `token_input`, `token_output`,
`success`, `is_fallback`, `fallback_reason`, `request_at`

## Prohibited

- No joins to message content or journal tables
- No display of raw user_id in operator-facing view
- No mutation of source rows
