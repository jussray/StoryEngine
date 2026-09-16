# AI Crawler Contract v1

StoryEngine / L99 treats automated public access as a governed discovery surface, separate from its creator runtime and production authority.

- Allow reputable search/discovery and user-directed retrieval only for deliberately public product documentation and canonical public evidence.
- Deny model-training and bulk dataset collection by default.
- Never expose stories, drafts, prompts, creator workspaces, provider responses, runtime logs, credentials, analytics records, private artifacts, or governance-only material through crawler surfaces.
- Request canonical source attribution when supported.
- Crawler access is read-only and never grants release, runtime, publishing, billing, provider, credential, or founder authority.

Default bot split: `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, and `Googlebot` may be allowed on verified public surfaces. `GPTBot`, `ClaudeBot`, and `Google-Extended` are denied by default.

This crawler branch is intentionally separate from PR #102, the authoritative end-to-end repair carrier. Do not let crawler work bypass, replace, or greenwash StoryEngine runtime/release proof. The canonical production authority remains the project release contract and its verified production origin.

`robots.txt` is preference, not authentication or authorization.
