(() => {
  const LEGACY_STORAGE_KEY = 'l99_api_key';
  let sessionPromise = null;

  function readBootstrapKey() {
    return sessionStorage.getItem(LEGACY_STORAGE_KEY) || '';
  }

  function clearBootstrapKey() {
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  function askBootstrapKey() {
    const entered = window.prompt('Enter the L99 bootstrap key for this session:');
    const key = String(entered || '').trim();
    if (key) sessionStorage.setItem(LEGACY_STORAGE_KEY, key);
    return key;
  }

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
      clearBootstrapKey();
      return existing;
    }

    const key = readBootstrapKey() || askBootstrapKey();
    if (!key) throw new Error('Authentication required.');

    const response = await originalFetch('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      clearBootstrapKey();
      throw new Error(payload.error || `Authentication failed (${response.status}).`);
    }

    // The explicit credential is bootstrap-only. Ordinary application requests
    // use the server-issued HttpOnly session cookie from this point forward.
    clearBootstrapKey();
    return payload;
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
      clearBootstrapKey();
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
