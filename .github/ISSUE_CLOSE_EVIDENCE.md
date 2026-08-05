# Issue Closure Evidence Template

Post this as a new issue comment immediately before closing an issue.

```md
## Closure Evidence
Resolution: <what was actually resolved>
Scope: <code | docs | operations | non-code>
Exact head: <40-character commit SHA | not_applicable: specific reason>
Proof: <tests, promotion gates, artifact checks, provenance evidence, or authoritative proof>
Rollback: <how to reverse the change or reopen the work>
Next gate: <next required action | none>
Unresolved risks: none
Founder approval: @jussray
```

The gate reopens the issue when evidence is absent, malformed, not founder-authored, or still reports unresolved risk. Generated artifacts, approvals, publishing, promotion, or verbal agreement do not automatically authorize closure.
