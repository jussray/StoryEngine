(() => {
  const STORAGE_KEY = 'l99_api_key';

  function readKey() {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  }

  function persistKey(value) {
    const key = String(value || '').trim();
    if (!key) return '';
    // Transitional session-only storage. This repository already treats
    // browser-readable API-key persistence as a production blocker; do not
    // widen exposure by attaching the key to every same-origin request cookie.
    sessionStorage.setItem(STORAGE_KEY, key);
    return key;
  }

  function ensureKey() {
    const existing = readKey();
    if (existing) return existing;
    const entered = window.prompt('Enter the L99 API key for this session:');
    return persistKey(entered);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const sameOriginApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    if (!sameOriginApi) return originalFetch(input, init);

    const key = ensureKey();
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
    if (key && !headers.has('x-api-key')) headers.set('x-api-key', key);
    return originalFetch(input, { ...init, headers });
  };

  ensureKey();
})();
