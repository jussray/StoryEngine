# Zapier SDK tooling

This package gives the L99 Story Engine a server-side Zapier SDK development boundary beside the real `story-engine` runtime. It is not a second event bus, provenance source, memory system, or release authority.

## Local setup

Requirements: Node.js 22.5+ and a Zapier account with at least one connected app.

```bash
cd story-engine/tools/zapier
npm install
npx skills add zapier/sdk -y
npm run login
npm run connections
npm run start
```

`npm run start` performs a read-only authentication check with `getProfile()`. It does not run an app action or read tenant/workspace content.

## Explore connected apps

```bash
npm run apps
npm run connections
npx zapier-sdk list-actions github
npx zapier-sdk list-actions hubspot
```

Generate TypeScript types only for integrations selected for a reviewed workflow:

```bash
npx zapier-sdk add github hubspot --types-output ./src/generated
```

## Production credentials

Browser login is for local development. For server-side execution, create approved client credentials locally:

```bash
npx zapier-sdk create-client-credentials "l99-story-engine-tooling"
```

Store the returned values in the server or deployment secret manager as:

- `ZAPIER_CREDENTIALS_CLIENT_ID`
- `ZAPIER_CREDENTIALS_CLIENT_SECRET`

The bootstrap also supports an approved `ZAPIER_CREDENTIALS` direct token, but client credentials are preferred for server-side use.

Never commit credentials, generated connection output, tenant/workspace data, provenance artifacts, event payloads, or private source material. Live writes, promotion, publication, deployment, and credential lifecycle changes remain separate approval gates.

Official quickstart: https://docs.zapier.com/sdk/quickstart
