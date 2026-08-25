(() => {
  const STORAGE_KEY = 'l99_api_key';

  function readKey() {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  }

  function persistKey(value) {
    const key = String(value || '').trim();
    if (!key) return '';
    // Transitional session-only storage. Browser-readable API-key persistence
    // remains a production blocker, but it must never become ambient cookie state.
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

  function authenticatedEventStream(path, handlers = {}) {
    const controller = new AbortController();
    let retryTimer = null;

    const connect = async () => {
      try {
        const response = await fetch(path, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Event stream failed: ${response.status}`);
        if (!response.body) throw new Error('Event stream body is unavailable.');

        handlers.open?.();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
            const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            handlers[event]?.({ data });
          }
        }
        if (!controller.signal.aborted) throw new Error('Event stream closed.');
      } catch (error) {
        if (controller.signal.aborted) return;
        handlers.error?.(error);
        retryTimer = window.setTimeout(connect, 3000);
      }
    };

    connect();
    return {
      close() {
        if (retryTimer) window.clearTimeout(retryTimer);
        controller.abort();
      }
    };
  }

  window.L99 = { ...(window.L99 || {}), authenticatedEventStream };
  ensureKey();
})();
