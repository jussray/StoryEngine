"""
companion_logger.py — Batch 2, Companion Pipeline Observability

Append-only logger for every companion AI request in the Python runtime.
No message body is ever stored. Retries are new rows.
Emits to the L99 event bus after each write (event bus owns operational truth).
Fails closed: if Supabase is unavailable, the companion call still completes
and the log entry is queued locally for retry.

Governed by: GLOBAL_AI.md, schemas/companion_requests.schema.json
"""

from __future__ import annotations

import os
import uuid
import time
import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional, Literal

logger = logging.getLogger(__name__)

COMPANION_IDS = Literal["raylene", "rylane", "cloud", "night", "oracle"]
FALLBACK_REASONS = Literal[
    "api_error_500", "api_timeout", "api_rate_limit",
    "network_offline", "safety_block", "budget_exceeded"
]

FALLBACK_ENABLED = os.environ.get("COMPANION_GHOST_FALLBACK_ENABLED", "true").lower() == "true"
ALERT_FALLBACK_RATE_THRESHOLD = float(os.environ.get("COMPANION_FALLBACK_ALERT_THRESHOLD", "0.05"))
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")


@dataclass
class CompanionRequestRecord:
    """Mirrors companion_requests.schema.json exactly. No message body."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = ""
    tenant_id: str = ""
    session_id: str = ""
    companion_id: str = ""
    model_used: str = ""
    model_version: str = ""
    request_at: str = ""
    response_at: str = ""
    latency_ms: int = 0
    token_input: int = 0
    token_output: int = 0
    success: bool = False
    is_fallback: bool = False
    fallback_reason: Optional[str] = None
    error_code: Optional[str] = None
    user_visible_latency_ms: Optional[int] = None

    def validate(self) -> None:
        """Fail fast on schema violations before any write attempt."""
        assert self.user_id, "user_id is required"
        assert self.tenant_id, "tenant_id is required"
        assert self.session_id, "session_id is required"
        assert self.companion_id in ("raylene", "rylane", "cloud", "night", "oracle"), \
            f"Unknown companion_id: {self.companion_id}"
        assert self.model_used, "model_used is required"
        assert self.latency_ms >= 0, "latency_ms must be non-negative"
        assert self.token_input >= 0
        assert self.token_output >= 0
        if self.is_fallback:
            assert self.fallback_reason is not None, \
                "fallback_reason required when is_fallback=True"
            assert self.token_input == 0 and self.token_output == 0, \
                "Ghost fallbacks must have zero token counts"

    def to_insert_payload(self) -> dict:
        return asdict(self)


class CompanionLogger:
    """
    Server-side, service-role-only companion request logger.
    All writes use the service role key — never exposed to clients.
    Fails closed: companion call succeeds even if logging fails.
    """

    def __init__(self) -> None:
        self._local_queue: list[dict] = []  # in-memory retry buffer
        self._supabase = self._init_supabase()

    def _init_supabase(self):
        """Lazy import so the module loads even without supabase installed."""
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            logger.warning(
                "[companion_logger] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. "
                "Logs will be queued in memory only."
            )
            return None
        try:
            from supabase import create_client  # type: ignore
            return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        except ImportError:
            logger.warning("[companion_logger] supabase-py not installed. Logging disabled.")
            return None

    def record(
        self,
        *,
        user_id: str,
        tenant_id: str,
        session_id: str,
        companion_id: str,
        model_used: str,
        model_version: str,
        request_at: float,  # unix timestamp
        response_at: float,  # unix timestamp
        token_input: int = 0,
        token_output: int = 0,
        success: bool = True,
        is_fallback: bool = False,
        fallback_reason: Optional[str] = None,
        error_code: Optional[str] = None,
        user_visible_latency_ms: Optional[int] = None,
    ) -> str:
        """Write one append-only row. Returns the row id. Never raises."""
        latency_ms = max(0, int((response_at - request_at) * 1000))
        row = CompanionRequestRecord(
            user_id=user_id,
            tenant_id=tenant_id,
            session_id=session_id,
            companion_id=companion_id,
            model_used=model_used,
            model_version=model_version,
            request_at=datetime.fromtimestamp(request_at, tz=timezone.utc).isoformat(),
            response_at=datetime.fromtimestamp(response_at, tz=timezone.utc).isoformat(),
            latency_ms=latency_ms,
            token_input=token_input,
            token_output=token_output,
            success=success,
            is_fallback=is_fallback,
            fallback_reason=fallback_reason,
            error_code=error_code,
            user_visible_latency_ms=user_visible_latency_ms,
        )
        try:
            row.validate()
        except AssertionError as e:
            logger.error("[companion_logger] Schema validation failed: %s", e)
            return row.id

        payload = row.to_insert_payload()
        self._write(payload)
        self._emit_event(payload)
        return row.id

    def _write(self, payload: dict) -> None:
        """Insert to Supabase using service role. Queue locally on failure."""
        if self._supabase is None:
            self._local_queue.append(payload)
            return
        try:
            self._supabase.table("companion_requests").insert(payload).execute()
            self._drain_local_queue()
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("[companion_logger] Supabase write failed, queuing: %s", exc)
            self._local_queue.append(payload)

    def _drain_local_queue(self) -> None:
        """Best-effort flush of the in-memory queue after a successful write."""
        if not self._local_queue or self._supabase is None:
            return
        retrying = list(self._local_queue)
        self._local_queue.clear()
        for item in retrying:
            try:
                self._supabase.table("companion_requests").insert(item).execute()
            except Exception:  # pylint: disable=broad-except
                self._local_queue.append(item)  # put back

    def _emit_event(self, payload: dict) -> None:
        """Emit to L99 event bus so Control Room observability sees every request."""
        try:
            from runtime.l99_event_bus import get_event_bus  # type: ignore
            bus = get_event_bus()
            bus.emit(
                event_type="companion.request.logged",
                correlation_id=payload["id"],
                data={
                    "companion_id": payload["companion_id"],
                    "is_fallback": payload["is_fallback"],
                    "success": payload["success"],
                    "latency_ms": payload["latency_ms"],
                    "session_id": payload["session_id"],
                },
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("[companion_logger] Event bus emit failed (non-fatal): %s", exc)


# Singleton — one logger per process
_logger_instance: Optional[CompanionLogger] = None


def get_companion_logger() -> CompanionLogger:
    global _logger_instance
    if _logger_instance is None:
        _logger_instance = CompanionLogger()
    return _logger_instance


@contextmanager
def companion_request_span(
    *,
    user_id: str,
    tenant_id: str,
    session_id: str,
    companion_id: str,
    model_used: str,
    model_version: str,
):
    """
    Context manager for wrapping a companion call.

    Usage:
        with companion_request_span(
            user_id=uid, tenant_id=tid, session_id=sid,
            companion_id="raylene", model_used="gpt-4o", model_version="2025-01",
        ) as span:
            response = call_model(prompt)
            span.set_success(tokens_in=100, tokens_out=80)

    The span records automatically on exit, even on exception.
    """
    span = _RequestSpan(
        user_id=user_id, tenant_id=tenant_id, session_id=session_id,
        companion_id=companion_id, model_used=model_used, model_version=model_version,
    )
    try:
        yield span
    except Exception as exc:
        span.set_error(str(type(exc).__name__))
        raise
    finally:
        span.flush()


class _RequestSpan:
    """Mutable span state collected during a companion call."""

    def __init__(self, **kwargs):
        self._kwargs = kwargs
        self._start = time.monotonic()
        self._start_wall = time.time()
        self._token_input = 0
        self._token_output = 0
        self._success = False
        self._is_fallback = False
        self._fallback_reason: Optional[str] = None
        self._error_code: Optional[str] = None
        self._user_visible_ms: Optional[int] = None

    def set_success(self, tokens_in: int = 0, tokens_out: int = 0) -> None:
        self._success = True
        self._token_input = tokens_in
        self._token_output = tokens_out

    def set_fallback(self, reason: str) -> None:
        self._is_fallback = True
        self._fallback_reason = reason
        self._success = False

    def set_error(self, code: str) -> None:
        self._error_code = code
        self._success = False

    def set_user_visible_latency(self, ms: int) -> None:
        self._user_visible_ms = ms

    def flush(self) -> str:
        end = time.time()
        return get_companion_logger().record(
            **self._kwargs,
            request_at=self._start_wall,
            response_at=end,
            token_input=self._token_input,
            token_output=self._token_output,
            success=self._success,
            is_fallback=self._is_fallback,
            fallback_reason=self._fallback_reason,
            error_code=self._error_code,
            user_visible_latency_ms=self._user_visible_ms,
        )
