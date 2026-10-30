# LEEVIZE Render Ledger

`story_video_open_renders` remains the fast mutable read model for the Studio UI. It is no longer the only durable evidence of what happened.

The render path now writes an append-only execution ledger before and around the existing self-hosted renderer calls.

## Receipt chain

Each render attempt owns a `receipt_id`. Events are SHA-256 fingerprinted with `/MAKEVIDEO v2.1`, carry the previous event hash, and are protected by SQLite triggers that reject updates and deletes.

Typical chain:

```text
READY
-> BUDGET_RESERVED
-> SUBMITTED
-> PROVIDER_RUNNING (optional)
-> PROVIDER_COMPLETED
-> ASSET_PERSISTED
-> QA_RECORDED
-> BUDGET_COMMITTED
-> BUDGET_RELEASED
-> REVIEW_RECORDED (when human film QA is saved)
```

Failures keep their own chain and reservation. One attempt cannot erase or rewrite another attempt's receipt.

Legacy/current renderer rows without an attempt ledger are recovered explicitly with `RECOVERED_SNAPSHOT`. Recovery is marked as reconstruction and is never presented as original submission proof.

## Provider-job durability

Once the renderer returns a provider `prompt_id`, the existing renderer row persists it before returning to the HTTP route. The ledger then binds that durable render row to the attempt with a `SUBMITTED` event. If a pre-ledger or interrupted row is later read, snapshot recovery binds it without pretending the recovery event existed at original submission time.

## Lease

Polling uses a bounded render lease. Only one unexpired `poll` lease may own a render at once. Acquire/release history is append-only and fingerprint chained separately from the mutable current-lease row.

Leases coordinate work. They grant no founder, publication, billing, deployment, or approval authority.

## Budget

Every newly requested open-weight render reserves a bounded internal budget record before renderer submission.

The current self-hosted lane accounts specifically for `vendor_generation_credit`. Its committed vendor-generation-credit cost is zero and the unused reservation is released when the attempt terminates. This does **not** claim GPU electricity, hosting, hardware depreciation, or other infrastructure cost is zero; those costs require separate accounting evidence.

## Fingerprints and cookies

The ledger keeps the existing LEEVIZE continuity cookie and full continuity fingerprint bound to the attempt. Asset persistence records the output SHA-256 and proof cookie. Changed source/canon/shot-plan state continues to invalidate stale green proof.

Cookies and fingerprints are evidence markers only. They do not contain credentials and do not authorize actions.

## Rollback

The ledger is additive. Reverting the ledger integration leaves the pre-existing renderer read model and media artifacts intact. Do not delete ledger rows to roll back behavior; receipt and lease event tables intentionally reject mutation and deletion.
