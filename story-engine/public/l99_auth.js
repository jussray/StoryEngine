(() => {
  const LEGACY_STORAGE_KEY = 'l99_api_key';
  let sessionPromise = null;

  function purgeLegacyBootstrapKey() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      try { storage.removeItem(LEGACY_STORAGE_KEY); } catch {}
    }
  }

  function askBootstrapKey() {
    const entered = window.prompt('Enter the L99 bootstrap key for this session:');
    return String(entered || '').trim();
  }

  // Older builds persisted the bootstrap credential in web storage. Purge that
  // state immediately. New credentials remain in memory only long enough to be
  // exchanged for the server-issued HttpOnly SameSite session cookie.
  purgeLegacyBootstrapKey();

  const originalFetch = window.fetch.bind(window);

  async function currentSession() {
    const response = await originalFetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }

  async function establishSession() {
    const existing = await currentSession();
    if (existing?.authenticated) {
      purgeLegacyBootstrapKey();
      return existing;
    }

    const key = askBootstrapKey();
    if (!key) throw new Error('Authentication required.');

    try {
      const response = await originalFetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Authentication failed (${response.status}).`);
      return payload;
    } finally {
      // The lexical key reference becomes unreachable after this call returns;
      // there is deliberately no localStorage/sessionStorage persistence path.
      purgeLegacyBootstrapKey();
    }
  }

  function ensureSession() {
    if (!sessionPromise) {
      sessionPromise = establishSession().catch(error => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  }

  window.L99Auth = {
    ensureSession,
    currentSession,
    async logout() {
      await originalFetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }).catch(() => null);
      sessionPromise = null;
      purgeLegacyBootstrapKey();
    }
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const sameOriginApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    const authBootstrap = url.includes('/api/auth/session') || url.includes('/api/auth/me') || url.includes('/api/auth/logout');

    if (sameOriginApi && !authBootstrap) await ensureSession();

    return originalFetch(input, {
      ...init,
      credentials: init.credentials || 'same-origin'
    });
  };

  void ensureSession().catch(() => {});
})();
