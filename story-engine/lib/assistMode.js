// lib/assistMode.js

import { randomUUID } from 'node:crypto';
import { log } from '../models/eventModel.js';

export const ASSIST_MODES = Object.freeze(['human_first', 'system_first']);

function normalizeMode(value, fallback = 'human_first') {
  const mode = String(value || fallback).trim().toLowerCase();
  if (!ASSIST_MODES.includes(mode)) throw new Error(`Unsupported assist mode: ${mode}.`);
  return mode;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function ensureAssistSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_assist_settings (
      profile_id TEXT PRIMARY KEY,
      default_assist_mode TEXT NOT NULL DEFAULT 'human_first',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_assist_profiles (
      workspace_id TEXT PRIMARY KEY,
      assist_mode TEXT NOT NULL DEFAULT 'human_first',
      suggestion_level TEXT NOT NULL DEFAULT 'on_request',
      overwrite_policy TEXT NOT NULL DEFAULT 'never_without_accept',
      voice_learning INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assist_contributions (
      contribution_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      chapter_id INTEGER,
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      original_text TEXT,
      proposed_text TEXT,
      accepted_text TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assist_contributions_workspace
      ON assist_contributions(workspace_id, created_at);
  `);

  if (!db.prepare("SELECT 1 FROM operator_assist_settings WHERE profile_id='primary'").get()) {
    db.prepare(`
      INSERT INTO operator_assist_settings (profile_id, default_assist_mode, updated_at)
      VALUES ('primary', 'human_first', ?)
    `).run(Date.now());
  }
}

export function getOperatorAssistDefault(db) {
  ensureAssistSchema(db);
  const row = db.prepare("SELECT * FROM operator_assist_settings WHERE profile_id='primary'").get();
  return { default_assist_mode: normalizeMode(row?.default_assist_mode), updated_at: row?.updated_at || null };
}

export function setOperatorAssistDefault(db, mode) {
  ensureAssistSchema(db);
  const normalized = normalizeMode(mode);
  const now = Date.now();
  db.prepare(`
    UPDATE operator_assist_settings
    SET default_assist_mode=?, updated_at=?
    WHERE profile_id='primary'
  `).run(normalized, now);
  log(db, {
    workspace_id: 'control-room',
    mode: 'operator_profile',
    event_type: 'operator.assist_default_updated',
    payload: { default_assist_mode: normalized }
  });
  return { default_assist_mode: normalized, updated_at: now };
}

export function getWorkspaceAssist(db, workspaceId, fallback = null) {
  ensureAssistSchema(db);
  const row = db.prepare('SELECT * FROM workspace_assist_profiles WHERE workspace_id=?').get(workspaceId);
  if (!row) {
    const now = Date.now();
    const mode = normalizeMode(fallback || getOperatorAssistDefault(db).default_assist_mode);
    db.prepare(`
      INSERT INTO workspace_assist_profiles (
        workspace_id, assist_mode, suggestion_level, overwrite_policy,
        voice_learning, version, created_at, updated_at
      ) VALUES (?, ?, 'on_request', 'never_without_accept', 1, 1, ?, ?)
    `).run(workspaceId, mode, now, now);
    return getWorkspaceAssist(db, workspaceId, mode);
  }
  return {
    ...row,
    voice_learning: Boolean(row.voice_learning),
    permissions: row.assist_mode === 'human_first'
      ? {
          may_draft_without_request: false,
          may_overwrite_human_text: false,
          requires_accept_for_changes: true,
          primary_author: 'human'
        }
      : {
          may_draft_without_request: true,
          may_overwrite_human_text: false,
          requires_accept_for_final_changes: true,
          primary_author: 'l99'
        }
  };
}

export function setWorkspaceAssist(db, workspaceId, input = {}) {
  const current = getWorkspaceAssist(db, workspaceId, input.assist_mode || null);
  const assistMode = normalizeMode(input.assist_mode, current.assist_mode);
  const suggestionLevel = String(input.suggestion_level || current.suggestion_level || 'on_request').trim();
  const overwritePolicy = String(input.overwrite_policy || 'never_without_accept').trim();
  if (overwritePolicy !== 'never_without_accept') {
    throw new Error('L99 may not overwrite human text without explicit acceptance.');
  }
  const voiceLearning = input.voice_learning == null ? current.voice_learning : Boolean(input.voice_learning);
  const now = Date.now();

  db.prepare(`
    UPDATE workspace_assist_profiles
    SET assist_mode=?, suggestion_level=?, overwrite_policy=?, voice_learning=?,
        version=version+1, updated_at=?
    WHERE workspace_id=?
  `).run(assistMode, suggestionLevel, overwritePolicy, voiceLearning ? 1 : 0, now, workspaceId);

  const profile = getWorkspaceAssist(db, workspaceId);
  log(db, {
    workspace_id: workspaceId,
    mode: 'assist_mode',
    event_type: 'assist_mode.updated',
    payload: { assist_mode: profile.assist_mode, version: profile.version }
  });
  return profile;
}

export function recordAssistContribution(db, input = {}) {
  ensureAssistSchema(db);
  const workspaceId = String(input.workspace_id || '').trim();
  if (!workspaceId) throw new Error('workspace_id is required.');
  const source = String(input.source || '').trim();
  if (!['human', 'l99'].includes(source)) throw new Error('source must be human or l99.');
  const action = String(input.action || '').trim();
  if (!action) throw new Error('action is required.');
  const contributionId = `assist_${randomUUID()}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO assist_contributions (
      contribution_id, workspace_id, chapter_id, source, action,
      original_text, proposed_text, accepted_text, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contributionId,
    workspaceId,
    input.chapter_id ?? null,
    source,
    action,
    input.original_text ?? null,
    input.proposed_text ?? null,
    input.accepted_text ?? null,
    JSON.stringify(input.metadata || {}),
    now
  );

  log(db, {
    workspace_id: workspaceId,
    mode: 'assist_mode',
    event_type: `assist.${source}.${action}`,
    payload: { contribution_id: contributionId, chapter_id: input.chapter_id ?? null }
  });

  return {
    contribution_id: contributionId,
    workspace_id: workspaceId,
    chapter_id: input.chapter_id ?? null,
    source,
    action,
    created_at: now
  };
}

export function listAssistContributions(db, workspaceId, limit = 100) {
  ensureAssistSchema(db);
  return db.prepare(`
    SELECT * FROM assist_contributions
    WHERE workspace_id=?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({
    ...row,
    metadata: parseJson(row.metadata_json, {})
  }));
}
