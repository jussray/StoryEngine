// routes/storyEngineAsync.js
// Reserved for future async route helpers.

export async function sendAsyncJson(res, promise) {
  try {
    const data = await promise;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}
