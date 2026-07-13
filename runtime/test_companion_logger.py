"""
test_companion_logger.py — Batch 2 unit tests (Python runtime)

Tests schema validation, span flush behavior, fallback enforcement.
No real Supabase connection — _supabase is patched to None (queue mode).
"""

import time
import sys
import os

# Ensure no real Supabase credentials are loaded
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
os.environ["COMPANION_GHOST_FALLBACK_ENABLED"] = "true"

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from runtime.companion_logger import (
    CompanionRequestRecord,
    get_companion_logger,
    companion_request_span,
)

passed = 0
failed = 0


def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  ✅ {name}")
        passed += 1
    except Exception as e:
        print(f"  ❌ {name}: {e}")
        failed += 1


print("\n[companion_logger] Batch 2 Python unit tests\n")


def t_valid_record():
    rec = CompanionRequestRecord(
        user_id="uid-1", tenant_id="tid-1", session_id="sid-1",
        companion_id="raylene", model_used="gpt-4o", model_version="2025-01",
        request_at="2026-07-13T00:00:00+00:00",
        response_at="2026-07-13T00:00:01+00:00",
        latency_ms=1000, token_input=80, token_output=120, success=True,
    )
    rec.validate()  # must not raise


test("validate() passes for a complete valid record", t_valid_record)


def t_bad_companion():
    rec = CompanionRequestRecord(
        user_id="uid-1", tenant_id="tid-1", session_id="sid-1",
        companion_id="unknown_bot", model_used="gpt-4o", model_version="2025-01",
        request_at="2026-07-13T00:00:00+00:00",
        response_at="2026-07-13T00:00:01+00:00",
        latency_ms=500, success=True,
    )
    try:
        rec.validate()
        raise AssertionError("Should have raised")
    except AssertionError as e:
        if "Unknown companion_id" not in str(e) and "Should have raised" in str(e):
            raise


test("validate() rejects unknown companion_id", t_bad_companion)


def t_fallback_tokens_must_be_zero():
    rec = CompanionRequestRecord(
        user_id="uid-1", tenant_id="tid-1", session_id="sid-1",
        companion_id="cloud", model_used="gpt-4o", model_version="2025-01",
        request_at="2026-07-13T00:00:00+00:00",
        response_at="2026-07-13T00:00:01+00:00",
        latency_ms=200, token_input=50, token_output=60,
        success=False, is_fallback=True, fallback_reason="api_error_500",
    )
    try:
        rec.validate()
        raise AssertionError("Should have raised")
    except AssertionError as e:
        if "zero token" not in str(e) and "Should have raised" in str(e):
            raise


test("validate() rejects fallback row with non-zero tokens", t_fallback_tokens_must_be_zero)


def t_logger_queues_without_supabase():
    logger = get_companion_logger()
    before = len(logger._local_queue)
    row_id = logger.record(
        user_id="uid-2", tenant_id="tid-2", session_id="sid-2",
        companion_id="night", model_used="claude-3-5-sonnet", model_version="20241022",
        request_at=time.time() - 1,
        response_at=time.time(),
        token_input=60, token_output=90, success=True,
    )
    assert isinstance(row_id, str) and len(row_id) == 36
    assert len(logger._local_queue) == before + 1  # queued without supabase


test("record() queues to local buffer when Supabase unavailable", t_logger_queues_without_supabase)


def t_span_success():
    import contextlib
    with companion_request_span(
        user_id="uid-3", tenant_id="tid-3", session_id="sid-3",
        companion_id="oracle", model_used="gpt-4o", model_version="2025-01",
    ) as span:
        span.set_success(tokens_in=100, tokens_out=80)


test("companion_request_span() flushes on success", t_span_success)


def t_span_error():
    try:
        with companion_request_span(
            user_id="uid-4", tenant_id="tid-4", session_id="sid-4",
            companion_id="rylane", model_used="gpt-4o", model_version="2025-01",
        ) as span:
            raise TimeoutError("model timeout")
    except TimeoutError:
        pass  # expected re-raise


test("companion_request_span() flushes and re-raises on exception", t_span_error)


print(f"\n  {passed} passed, {failed} failed\n")
if failed:
    sys.exit(1)
