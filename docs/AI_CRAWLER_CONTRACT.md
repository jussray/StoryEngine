# AI Crawler Contract v1

StoryEngine treats automated access as a governed public product surface, not as an automatic license to copy the product or its private state.

## Founder intent

- Let reputable search and answer engines discover bounded public truth that can produce citations, source links, and qualified referral traffic.
- Let user-directed retrieval use intentionally public material where the provider supports it.
- Deny model-training and bulk dataset collection by default.
- Keep authentication, creator workspaces, API data, drafts, artifacts, logs, prompts, provider responses, metrics ledgers, release controls, and governance-only material outside crawler scope.
- Crawler access is read-only. It never grants merge, deployment, publication, billing, credential, or founder authority.

## Public machine surfaces

The intended public crawler surface is deliberately narrow:

- `/robots.txt`
- `/llms.txt`
- `/crawlers.json`
- `/guardrails`
- `/guardrails.json`
- `/runtime-identity`

Everything else remains outside compliant crawler scope unless deliberately added later.

## Provider policy

- `OAI-SearchBot`: allow the bounded public surface for ChatGPT discovery/citations.
- `GPTBot`: deny. StoryEngine content is not offered for model-training collection by default.
- `Claude-SearchBot`: allow the bounded public surface for search discovery.
- `Claude-User`: allow the bounded public surface for user-directed retrieval.
- `ClaudeBot`: deny. StoryEngine content is not offered for model-training collection by default.
- `Googlebot`: receives only the same bounded public surface through the default policy.
- `Google-Extended`: deny by default.

Provider bot names and semantics can change. Re-verify provider documentation before changing production policy.

## Attribution and evidence

Machine-readable pages point to the canonical repository and runtime evidence. Where a provider supports citations or source links, prefer linking to the canonical source rather than detached summaries.

Public claims must preserve StoryEngine's truth boundary: source, tests, deployment receipts, runtime identity, provider acceptance, and user outcomes are different evidence classes. Unknown stays unknown.

## Security invariant

`robots.txt`, `llms.txt`, and `crawlers.json` are crawler policy and discovery metadata, not access control. Authentication and server-side authorization remain the security boundary even if a crawler ignores these files.

## Economic layer

If a verified production zone later gains an authorized crawler-control or pay-per-crawl capability, keep discovery metadata free, measure which crawlers create citations/referrals, and consider charging selected bulk AI crawler access instead of granting it for free. Do not claim paid crawling is active without provider evidence.
