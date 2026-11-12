# Railway IaC adoption, review-only

Authoritative Railway project: StoryEngine, production environment. This repository currently owns the only Railway service in that environment, so this is a full-project file with no named partial. It is NOT yet proven to be an exact provider import.

1. Use a production-environment-scoped `RAILWAY_TOKEN` secret in GitHub. Never paste or commit it.
2. In an authenticated Railway CLI checkout run `railway link --project d497b2c2-4cfc-4e0d-8441-bd48eb02baae --environment ad033208-07f8-47d8-9218-66618ad83ae7`.
3. Run `railway config partials list --json`; STOP if named partials already own the environment.
4. Run `railway config pull` in a SEPARATE clean checkout. Compare the imported file (including builder, watch patterns, storage, source, domains, and `preserve()` secrets) to this candidate. Do not overwrite without review.
5. Run `railway config plan --detailed-exit-code` on the reviewed branch. Exit 0 = no drift, exit 2 = pending change and BLOCKED. Never auto-apply.
6. Require current main SHA, exact head, merge-base, CI, and **one independent human GitHub approval** before release. Existing Production ruleset currently has required_approving_review_count=0: correct that separate governance gate first.
7. StoryEngine's existing 500 MB `story-engine-data` volume at `/data`, Dockerfile builder, custom domain, existing variable values, and routing must remain unchanged.

This repo's new workflow ONLY generates a plan comment for owner-created same-repository PRs. It has no apply job.

Reference: https://docs.railway.com/infrastructure-as-code
