-- Migration: 001_companion_requests
-- Batch 1 of companion pipeline observability
-- Append-only. No UPDATE or DELETE except cascade on user deletion.
-- Requires RLS to be enabled and policies applied before any client access.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS companion_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  tenant_id             UUID NOT NULL,
  session_id            UUID NOT NULL,
  companion_id          TEXT NOT NULL CHECK (companion_id IN ('raylene', 'rylane', 'cloud', 'night', 'oracle')),
  model_used            TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  request_at            TIMESTAMPTZ NOT NULL,
  response_at           TIMESTAMPTZ NOT NULL,
  latency_ms            INTEGER NOT NULL CHECK (latency_ms >= 0),
  token_input           INTEGER NOT NULL DEFAULT 0 CHECK (token_input >= 0),
  token_output          INTEGER NOT NULL DEFAULT 0 CHECK (token_output >= 0),
  success               BOOLEAN NOT NULL,
  is_fallback           BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason       TEXT CHECK (
                          fallback_reason IN (
                            'api_error_500', 'api_timeout', 'api_rate_limit',
                            'network_offline', 'safety_block', 'budget_exceeded'
                          ) OR fallback_reason IS NULL
                        ),
  error_code            TEXT,
  user_visible_latency_ms INTEGER CHECK (user_visible_latency_ms >= 0)
);

-- Indexes for Control Room dashboard queries
CREATE INDEX IF NOT EXISTS idx_cr_user_session    ON companion_requests (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_cr_companion_time  ON companion_requests (companion_id, request_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_fallback        ON companion_requests (is_fallback, request_at DESC) WHERE is_fallback = TRUE;
CREATE INDEX IF NOT EXISTS idx_cr_tenant          ON companion_requests (tenant_id, request_at DESC);

-- RLS: users see only their own rows
ALTER TABLE companion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY cr_select_own ON companion_requests
  FOR SELECT USING (user_id = auth.uid());

-- Only the service role may insert (server-side only, never from client)
CREATE POLICY cr_insert_service ON companion_requests
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Cascade delete on user account deletion
-- Wire this to your user deletion event handler:
-- DELETE FROM companion_requests WHERE user_id = $deleted_user_id;
-- Add FK if users table exists:
-- ALTER TABLE companion_requests
--   ADD CONSTRAINT fk_cr_user FOREIGN KEY (user_id)
--   REFERENCES auth.users(id) ON DELETE CASCADE;

-- ROLLBACK:
-- DROP TABLE IF EXISTS companion_requests;
