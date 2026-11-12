# Railway IaC adoption, review-only

Authoritative Railway project: StoryEngine, production environment. This repository currently owns the only Railway service in that environment, so this is a full-project file with no named partial. It is NOT yet proven to be an exact provider import.

1. The plan-only GitHub workflow uses the existing `RAILWAY_API_KEY` GitHub secret as the Railway CLI's `RAILWAY_API_TOKEN` (account/workspace API-key authentication). Never paste or commit it. Do not pass an account API key into `RAILWAY_TOKEN`, which selects project-token authentication.
2. In an authenticated Railway CLI checkout run `railway link --project d497b2c2-4cfc-4e0d-8441-bd48eb02baae --environment ad033208-07f8-47d8-9218-66618ad83ae7`.
3. Run `railway config partials list --json`; STOP if named partials already own the environment.
4. Run `railway config pull` in a SEPARATE clean checkout. Compare the imported file (including builder, watch patterns, storage, source, domains, and `preserve()` secrets) to this candidate. Do not overwrite without review.
5. Run `railway config plan --out railway-plan.json` on the reviewed branch. Verify the exact environment ID, inspect all changes, and BLOCK any destructive or non-zero plan until the imported provider configuration matches. Never auto-apply.
6. Require current main SHA, exact head, merge-base, CI, and **one independent human GitHub approval** before release. Existing Production ruleset currently has required_approving_review_count=0: correct that separate governance gate first.
7. StoryEngine's existing 500 MB `story-engine-data` volume at `/data`, Dockerfile builder, custom domain, existing variable values, and routing must remain unchanged.

This repo's workflow runs a read-only CLI plan for owner-created same-repository PRs and uploads `railway-plan-review-only` evidence only when a plan succeeds. It rejects destructive/non-zero changes. It does not post a plan comment, and has no apply, merge, or deployment step. The repository's formal approval protections must be repaired separately; the founder's Auto merge click is the final merge authorization, not a substitute for an independent approving review.

Reference: https://docs.railway.com/infrastructure-as-code
