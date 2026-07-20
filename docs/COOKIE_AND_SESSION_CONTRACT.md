# Cookie and Session Contract

L99 currently sets zero cookies.

The event bus, provenance engine, partition resolver, artifacts, revocation logic, and promotion gates own operational truth. Dashboards are views. A browser cookie must never become a second canon, Story Memory, tenant boundary, workspace authority, provider capability, promotion decision, or release state.

## Forbidden

- direct `document.cookie`, Cookie Store API, or custom `Set-Cookie` handling;
- story content, creator drafts, tenant identifiers, credentials, provider tokens, or unpublished artifacts in cookies;
- analytics, advertising, fingerprinting, replay, or cross-site tracking cookies;
- client-created login, role, workspace, canon, provenance, or promotion state;
- claiming authenticated multi-user isolation before identity and workspace authorization are proven.

## Future studio gate

A future authenticated creator studio may add a strictly necessary server session only after identity, tenant/workspace isolation, revocation, CSRF, no-store caching, audit events, and logout are verified. That session must point to existing L99 authority; it must not become a parallel event spine or provenance source.
