# LEEVIZE render receipt schema

A render receipt records evidence. It never grants authority.

Required fields for a completed shot include renderer identity, workflow SHA-256, source revision, continuity cookie, proof cookie, output SHA-256, media probe result, model identifier when configured, and explicit `authority_granted: false`.

Failure receipts keep their own identifiers and classes. A compute failure does not stand in for a workflow failure; a workflow failure does not stand in for a license failure; a render failure does not stand in for a publish or analytics failure.

Receipts must not include API keys, bearer tokens, `.env` content, private runtime URLs, raw provider payloads, or model-supplied authority fields.
