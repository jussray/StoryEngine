# L99 — MCP tooling boundary

L99 treats isolation, provenance, revocation, evidence, and rollback as runtime contracts. MCP tools may improve development research, but they do not become part of the production trust chain.

## MCP servers

- **GitHub:** repository, pull-request, Actions, and security evidence with allow-listed toolsets and lockdown mode.
- **Bright Data:** VS Code/Codespaces only, prompted at runtime for `API_TOKEN`, and restricted to `GROUPS=code` for current npm and PyPI package metadata.
- **Microsoft Learn:** current official Microsoft technical documentation and code samples; no authentication required.

The committed root `.mcp.json` remains credential-free. MCP hosts other than VS Code/Codespaces must configure Bright Data locally and keep the API token outside the repository.

Bright Data Pro Mode, browser automation, ecommerce tools, broad scraping, and general web-data groups are intentionally disabled. Package metadata is advisory and cannot establish authorization, provenance, tenant boundaries, promotion approval, incident truth, or production state.

Do not send tenant identifiers, user identifiers, cache entries, provenance artifacts, event-bus records, incident evidence, private prompts, credentials, or production traces to external MCP tools.
