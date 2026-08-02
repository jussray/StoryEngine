# Third-Party Components

L99 StoryEngine contains first-party proprietary material and third-party software. The repository’s proprietary `LICENSE` applies only to first-party material authored by or for Juss Ray. It does not replace, narrow, or revoke rights granted by third-party licensors.

## Dependency sources inspected

- `story-engine/package.json`
- `story-engine/package-lock.json` (`lockfileVersion: 3`)

The StoryEngine package is marked `private` and `UNLICENSED`. Resolved third-party packages, including Playwright and its transitive dependencies, retain their own license identifiers and upstream notices.

## Distribution rule

Before distributing a binary, source bundle, hosted package, or other artifact outside the owner-controlled environment, generate an attribution report from the exact resolved lockfile used for that release and include any copyright notices or license texts required by the applicable third-party licenses.

This file is a boundary and audit record, not a substitute for upstream license texts. Package metadata, installed package license files, upstream repositories, and release-specific attribution output remain the source of truth for third-party terms.
