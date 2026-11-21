(() => {
  const LEGACY_STORAGE_KEY = 'l99_api_key';
  let sessionPromise = null;

  function purgeLegacyBootstrapKey() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      try { storage.removeItem(LEGACY_STORAGE_KEY); } catch {}
    }
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
    // Browsing the public StoryEngine front door never requests a private
    // credential. Protected APIs remain inaccessible without a server session.
    throw new Error('Creator sign-in required.');
  }

  // Transitional private-beta access only. Public account creation and
  // recovery must be implemented separately before a general-audience launch.
  async function signInWithAccessKey(rawKey) {
    const key = String(rawKey || '').trim();
    if (!key) throw new Error('Enter your private access key.');

    try {
      const response = await originalFetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        body: '{}'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.authenticated) {
        throw new Error(payload.message || payload.error || 'Private access was not accepted.');
      }
      sessionPromise = Promise.resolve(payload);
      return payload;
    } finally {
      // No access credential is persisted or added to ordinary API requests.
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
    signInWithAccessKey,
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

  // Do not ask visitors for an internal key on initial page load.
})();
