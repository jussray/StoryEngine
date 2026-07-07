# L99 Story Engine

Book-first story workspace: title/genre/pitch → outline → chapters → auto-generated
Movie mode beats, with every write logged to an event table for future OODA/L99
latency and rollback tracking.

## Run it

```
node server.js
```

Then open `http://localhost:3000`. That's it — **no `npm install`.**

This intentionally has zero dependencies: it uses Node's built-in `node:sqlite`
(stable since Node 22.5) instead of `better-sqlite3`, and a ~90-line router
(`lib/miniRouter.js`) instead of Express. Swap in Express or `better-sqlite3`
later if you want the ecosystem; the route/model code is written in a near-identical
style to both so the swap is mechanical.

Requires **Node 22.5+** for `node:sqlite`. Check with `node --version`.

## Structure

```
server.js                 http server, static file serving, API mounting
lib/miniRouter.js         tiny express-like router (get/post/put, :params, JSON body)
lib/oodaProcessor.js      OODA loop — p50/p95/p99 + rollback_rate per workspace/mode
config/db.js              node:sqlite connection + WAL/perf PRAGMAs
db/schema.sql             stories, outlines, chapters, events, movie_beats
routes/                   story, outline, chapters, movie, events
models/                   storyModel, outlineModel, chapterModel, movieModel, eventModel
public/                   front_door, story_home, outline, chapters, movie,
                          events_view (HTML + JS + CSS)
```

## Flow

1. `front_door.html` — enter title/genre/pitch → `POST /api/story` → redirects to
   story home with `?workspace_id=`.
2. `story_home.html` — links to Outline / Chapters / Movie / Events.
3. `outline.html` — edit acts/chapters, `PUT /api/outline/:workspace_id`.
4. `chapters.html` — add/select/edit chapters, `POST`/`PUT /api/chapters/...`.
5. `movie.html` — `POST /api/movie/beats/generate/:workspace_id` turns your
   chapters into three-act beats (one beat per chapter, split I/II/III by
   position); edit loglines per beat.
6. `events_view.html` — live event log for the workspace (type, duration, rollback).
7. Every mutation logs to `events` via `eventModel.log` — the raw feed for
   OODA/L99 dashboards.

## OODA Loop

`lib/oodaProcessor.js` runs a 30-second interval loop:

- Reads last 15 minutes of events per workspace/mode.
- Computes p50/p95/p99 latency and rollback rate.
- Detects incidents when p99 > 1000ms or rollback_rate > 2%.
- Calls your `onIncidents` callback — wire to SSE/WebSocket for live dashboards.

## SQLite Performance

`config/db.js` applies on startup:

```sql
PRAGMA journal_mode = WAL;      -- readers don't block writers
PRAGMA synchronous = NORMAL;    -- reduced fsync strictness
PRAGMA cache_size = -10000;     -- 10MB page cache
PRAGMA temp_store = MEMORY;     -- temp tables in memory
```

## Known gaps (by design, not bugs)

- `movie_beats` regenerating replaces all beats for the workspace — edits to
  loglines only persist until you hit "Save beat," and a regenerate wipes them.
  Fine for v1; add a merge strategy if that becomes annoying.
- No auth — single-user local tool. Add a session/auth layer before going public.
- Comic and Audio modes aren't built — same `workspace_id` + `eventModel.log`
  pattern extends to them when you're ready.
