-- L99 Story Engine schema

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  genre TEXT,
  pitch TEXT,
  mode TEXT,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL UNIQUE,
  content TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  chapter_id TEXT,
  title TEXT NOT NULL,
  content TEXT,
  text TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Drafted',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS movie_beats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  chapter_id INTEGER,
  act TEXT NOT NULL DEFAULT 'I',
  beat TEXT,
  title TEXT,
  logline TEXT,
  sources TEXT DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  mode TEXT,
  schema_version TEXT DEFAULT '1.0.0',
  client_tier TEXT DEFAULT 'small',
  event_type TEXT NOT NULL,
  payload TEXT,
  duration_ms INTEGER,
  rollback INTEGER NOT NULL DEFAULT 0,
  snapshot_trust_status TEXT DEFAULT 'snapshot_plus_delta',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS lindymode_state (
  workspace_id TEXT PRIMARY KEY,
  summary TEXT DEFAULT '',
  pov TEXT DEFAULT '',
  arc_stage TEXT DEFAULT '',
  token_budget INTEGER DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS lindymode_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  parent_event_id TEXT,
  workspace_id TEXT NOT NULL,
  chapter_id INTEGER,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT NOT NULL,
  drift_score REAL NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}',
  recovery_action TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS ooda_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  action TEXT NOT NULL,
  readiness TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  recovery_plan_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS release_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  result TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  checks_json TEXT NOT NULL DEFAULT '[]',
  blockers_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS release_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  gate_status TEXT,
  gate_audit_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS ooda_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  correlation_id TEXT,
  trigger_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  recovery_action TEXT,
  outcome TEXT NOT NULL DEFAULT 'unknown',
  confidence_before INTEGER,
  confidence_after INTEGER,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS ooda_risk_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  drift_score REAL NOT NULL DEFAULT 0,
  p99 INTEGER NOT NULL DEFAULT 0,
  rollback_rate REAL NOT NULL DEFAULT 0,
  predicted_risk TEXT NOT NULL,
  prediction_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS ooda_recovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  incident_id TEXT,
  strategy TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  reversible INTEGER NOT NULL DEFAULT 1,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS story_genomes (
  workspace_id TEXT PRIMARY KEY,
  genome_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE TABLE IF NOT EXISTS memory_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  char_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'alive',
  location TEXT,
  arc_stage TEXT,
  traits TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  first_chapter INTEGER,
  last_chapter INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, char_id)
);

CREATE TABLE IF NOT EXISTS memory_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  loc_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  description TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, loc_id)
);

CREATE TABLE IF NOT EXISTS memory_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  char_a TEXT NOT NULL,
  char_b TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, relationship_id)
);

CREATE TABLE IF NOT EXISTS memory_lore (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  lore_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, lore_id)
);

CREATE TABLE IF NOT EXISTS memory_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  obj_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  holder TEXT,
  location TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, obj_id)
);

CREATE TABLE IF NOT EXISTS memory_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  timeline_id TEXT NOT NULL,
  event_label TEXT NOT NULL,
  story_time TEXT NOT NULL,
  chapter_id INTEGER,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(workspace_id, timeline_id)
);

CREATE TABLE IF NOT EXISTS memory_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  diff_id TEXT UNIQUE,
  workspace_id TEXT NOT NULL,
  chapter_id INTEGER,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  conflict INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS engine_memory_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  chapter_id INTEGER,
  prompt_hash TEXT,
  prompt_summary TEXT,
  lindy_classification TEXT,
  lindy_score REAL,
  ooda_action TEXT,
  ooda_confidence INTEGER,
  redteam_passed INTEGER NOT NULL DEFAULT 0,
  redteam_issues_json TEXT NOT NULL DEFAULT '[]',
  runtime_steps_json TEXT NOT NULL DEFAULT '[]',
  gate_result TEXT,
  gate_blockers_json TEXT NOT NULL DEFAULT '[]',
  user_accepted INTEGER,
  confidence_before REAL,
  confidence_after REAL,
  lessons_json TEXT NOT NULL DEFAULT '[]',
  repeated_mistake INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS autonomous_runtime_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  chapter_id INTEGER,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  steps_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS event_compaction_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compaction_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  cutoff_at INTEGER NOT NULL,
  keep_ms INTEGER NOT NULL,
  compacted_groups INTEGER NOT NULL DEFAULT 0,
  deleted_events INTEGER NOT NULL DEFAULT 0,
  skipped_groups INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS compacted_event_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compaction_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  first_event_at INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  UNIQUE(correlation_id, first_event_at, last_event_at)
);

CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_mode_created ON events(mode, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_chapters_workspace ON chapters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_beats_workspace ON movie_beats(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lindy_incidents_workspace ON lindymode_incidents(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lindy_incidents_correlation ON lindymode_incidents(correlation_id);
CREATE INDEX IF NOT EXISTS idx_ooda_decisions_workspace ON ooda_decisions(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_release_audits_workspace ON release_audits(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_release_attempts_workspace ON release_attempts(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_release_attempts_operation ON release_attempts(operation, status);
CREATE INDEX IF NOT EXISTS idx_ooda_episodes_workspace ON ooda_episodes(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ooda_episodes_trigger ON ooda_episodes(trigger_type, outcome);
CREATE INDEX IF NOT EXISTS idx_ooda_risk_workspace ON ooda_risk_snapshots(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ooda_recovery_workspace ON ooda_recovery_runs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_characters_workspace ON memory_characters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_locations_workspace ON memory_locations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_relationships_workspace ON memory_relationships(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_lore_workspace ON memory_lore(workspace_id, category);
CREATE INDEX IF NOT EXISTS idx_memory_objects_workspace ON memory_objects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_memory_timeline_workspace ON memory_timeline(workspace_id, position);
CREATE INDEX IF NOT EXISTS idx_memory_diffs_workspace ON memory_diffs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_diffs_conflict ON memory_diffs(conflict, resolved);
CREATE INDEX IF NOT EXISTS idx_engine_memory_workspace ON engine_memory_episodes(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_engine_memory_gate ON engine_memory_episodes(gate_result, created_at);
CREATE INDEX IF NOT EXISTS idx_engine_memory_mistakes ON engine_memory_episodes(repeated_mistake, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_workspace ON autonomous_runtime_runs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_correlation ON autonomous_runtime_runs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_compacted_events_correlation ON compacted_event_episodes(correlation_id);
CREATE INDEX IF NOT EXISTS idx_compaction_runs_created ON event_compaction_runs(created_at);
