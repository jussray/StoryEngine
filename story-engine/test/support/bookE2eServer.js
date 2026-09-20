import { createServer } from 'node:http';

const providerPort = Number(process.env.BOOK_E2E_PROVIDER_PORT || 3199);

function chapterContent(number) {
  return [
    `Chapter ${number} begins when Mara notices a silver line moving across the locked library floor after midnight.`,
    'She follows it past the astronomy shelves and discovers that the map in her pocket changes whenever moonlight touches the paper.',
    'A concrete choice pushes the mystery forward, reveals a new fact about her family, and forces her to trade safety for a better chance at the truth.',
    'Before the chapter closes, Mara must decide who to trust, and the answer changes the next place she has to go before the moon disappears.'
  ].join(' ');
}

const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch {}
  const prompt = body.messages?.at(-1)?.content || '';
  const manuscript = /complete compact first-draft book manuscript/i.test(prompt) && /JSON schema:/i.test(prompt);
  const content = manuscript
    ? JSON.stringify({
        chapters: Array.from({ length: 6 }, (_, index) => ({
          chapter_number: index + 1,
          title: `Moon Map ${index + 1}`,
          content: chapterContent(index + 1)
        }))
      })
    : `${chapterContent(1)} ${chapterContent(1)}`;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: manuscript ? 'book-e2e-manuscript' : 'book-e2e-opening',
    model: 'book-e2e-local-provider',
    choices: [{ message: { content } }]
  }));
});

provider.listen(providerPort, '127.0.0.1', async () => {
  process.env.LLM_BASE_URL = `http://127.0.0.1:${providerPort}/v1`;
  process.env.OPENROUTER_API_KEY = 'playwright-book-test-only';
  process.env.GHOST_WRITER_PROVIDER = 'openrouter';
  process.env.DEFAULT_WRITING_LLM = 'openrouter';
  process.env.AUTONOMOUS_BOOK_CHAPTER_COUNT = '6';
  process.env.AUTONOMOUS_BOOK_MAX_TOKENS = '8192';
  await import('../../server.js');
});

function closeAndExit(code = 0) {
  provider.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGTERM', () => closeAndExit(0));
process.on('SIGINT', () => closeAndExit(0));
