"""Lindymode event emitter for the L99 shared event bus.

The emitter appends Lindymode continuity and state-drift events to an NDJSON
feed. Each line is one independently parseable event object that follows the
shared L99 event bus contract.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from l99_event_bus import append_event as _bus_append_event  # noqa: E402
from artifact_writer import write_artifact  # noqa: E402


LINDYMODE_NAMESPACE = "l99_lindymode"
LINDYMODE_SOURCE = "lindymode"

VALID_LINDYMODE_EVENTS = {
    "lindymode.state_drift_detected",
    "lindymode.summary_refresh_triggered",
    "lindymode.continuity_conflict",
    "lindymode.context_budget_breach",
    "lindymode.recovery_completed",
}


@dataclass
class LindymodeEvent:
    event_type: str
    tenant_id: str
    severity: str
    status: str
    reason: str
    correlation_id: str
    event_id: str | None = None
    parent_event_id: str | None = None
    trace_id: str | None = None
    timestamp_utc: str | None = None
    chapter_id: str | None = None
    arc_stage: str | None = None
    pov: str | None = None
    continuity_entity: str | None = None
    drift_score: float | None = None
    summary_window: str | None = None
    token_budget_state: str | None = None
    recovery_action: str | None = None

    def to_event(self) -> dict:
        if self.event_type not in VALID_LINDYMODE_EVENTS:
            raise ValueError(f"unsupported Lindymode event_type: {self.event_type}")

        event = {
            "schema_version": "1.0",
            "event_version": 1,
            "event_id": self.event_id or f"evt_lindy_{uuid4().hex}",
            "event_type": self.event_type,
            "timestamp_utc": self.timestamp_utc or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "tenant_id": self.tenant_id,
            "namespace": LINDYMODE_NAMESPACE,
            "severity": self.severity,
            "status": self.status,
            "source_system": LINDYMODE_SOURCE,
            "reason": self.reason,
            "correlation_id": self.correlation_id,
            "group_key": f"tenant:{self.tenant_id}:severity:{self.severity}",
        }

        optional = asdict(self)
        for key in [
            "parent_event_id",
            "trace_id",
            "chapter_id",
            "arc_stage",
            "pov",
            "continuity_entity",
            "drift_score",
            "summary_window",
            "token_budget_state",
            "recovery_action",
        ]:
            value = optional.get(key)
            if value is not None:
                event[key] = value

        return event


def append_event(feed_path: str | Path, event: LindymodeEvent) -> dict:
    """Write a Lindymode artifact, validate, and append the event to an NDJSON feed."""
    payload = event.to_event()
    payload["artifact_ref"] = write_artifact("lindymode", payload["event_id"], payload)
    return _bus_append_event(feed_path, payload)


def emit_state_drift(
    feed_path: str | Path,
    *,
    tenant_id: str,
    correlation_id: str,
    reason: str,
    drift_score: float,
    chapter_id: str | None = None,
    arc_stage: str | None = None,
    continuity_entity: str | None = None,
) -> dict:
    severity = "sev2" if drift_score >= 0.75 else "watch"
    return append_event(
        feed_path,
        LindymodeEvent(
            event_type="lindymode.state_drift_detected",
            tenant_id=tenant_id,
            severity=severity,
            status="active",
            reason=reason,
            correlation_id=correlation_id,
            drift_score=drift_score,
            chapter_id=chapter_id,
            arc_stage=arc_stage,
            continuity_entity=continuity_entity,
        ),
    )


if __name__ == "__main__":
    append_event(
        "samples/events.ndjson",
        LindymodeEvent(
            event_id="evt_lindy_sample_001",
            event_type="lindymode.state_drift_detected",
            tenant_id="tenant_alpha",
            severity="sev2",
            status="active",
            reason="relationship_memory_diverged_from_arc_state",
            correlation_id="inc_lindy_alpha_001",
            chapter_id="chapter_12",
            arc_stage="rising_conflict",
            pov="first_person",
            continuity_entity="main_character_relationship_state",
            drift_score=0.82,
            summary_window="chapters_8_12",
            token_budget_state="near_limit",
        ),
    )
