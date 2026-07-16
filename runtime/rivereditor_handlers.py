# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""RiverEditor shell handler execution layer.

`rivereditor_shell_router.py` resolves a raw command against the registry but
deliberately never executes anything. This module is the runtime binding: it
looks up the resolved handler name, runs deterministic handler logic, and emits
the command's declared events onto the shared L99 event bus.
"""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any, Callable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rivereditor_shell_router import (  # noqa: E402
    CommandNotFoundError,
    load_registry,
    resolve_command,
    shell_event,
)
from l99_event_bus import append_event, load_events  # noqa: E402
from artifact_writer import write_artifact, build_incident_artifact  # noqa: E402
from lindymode_event_emitter import (  # noqa: E402
    LindymodeEvent,
    append_event as append_lindymode_event,
    emit_state_drift,
)

DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parent.parent / "configs" / "rivereditor_command_registry.json"
DEFAULT_FEED_PATH = Path(__file__).resolve().parent.parent / "samples" / "events.ndjson"
DEFAULT_TENANT_ID = "tenant_default"

CAVEMAN_DROP_WORDS = {
    "a",
    "an",
    "the",
    "of",
    "to",
    "in",
    "on",
    "at",
    "is",
    "are",
    "was",
    "were",
}


def ghost_apply(profile_id: str, text: str | None = None, **_kwargs: Any) -> dict[str, Any]:
    text = text or "She entered the room."
    return {
        "profile_id": profile_id,
        "voice_fingerprint": f"ghost::{profile_id}",
        "draft_unit": f"[{profile_id}] {text}",
    }


def caveman_rewrite(text: str | None = None, **_kwargs: Any) -> dict[str, Any]:
    text = text or "She entered the room."
    words = [
        word
        for word in text.split()
        if word.strip(".,!?").lower() not in CAVEMAN_DROP_WORDS
    ]
    rewritten = " ".join(word.strip(".,!?").upper() for word in words) or text.upper()
    return {"text": rewritten}


def proofread_run(text: str | None = None, **_kwargs: Any) -> dict[str, Any]:
    text = text or ""
    return {"status": "completed", "issues_found": 0, "text": text}


def style_chain(profile_id: str, text: str | None = None, **_kwargs: Any) -> dict[str, Any]:
    ghost_result = ghost_apply(profile_id, text)
    caveman_result = caveman_rewrite(ghost_result["draft_unit"])
    proofread_result = proofread_run(caveman_result["text"])
    return {
        "profile_id": profile_id,
        "stages": [
            {"stage": "ghost", "handler": "ghost_apply", "result": ghost_result},
            {"stage": "caveman", "handler": "caveman_rewrite", "result": caveman_result},
            {"stage": "proofread", "handler": "proofread_run", "result": proofread_result},
        ],
        "text": proofread_result["text"],
    }


def open_dashboard(dashboard_id: str = "ooda", **_kwargs: Any) -> dict[str, Any]:
    return {"opened": dashboard_id, "path": f"/{dashboard_id}"}


def open_episode(
    correlation_id: str,
    feed_path: str | Path = DEFAULT_FEED_PATH,
    **_kwargs: Any,
) -> dict[str, Any]:
    events = load_events(feed_path)
    return build_incident_artifact(correlation_id, events)


def show_events(
    feed_path: str | Path = DEFAULT_FEED_PATH,
    limit: int = 20,
    **_kwargs: Any,
) -> dict[str, Any]:
    events = load_events(feed_path)
    return {"event_count": len(events), "events": events[-limit:]}


def query_events(
    tenant_id: str,
    feed_path: str | Path = DEFAULT_FEED_PATH,
    **_kwargs: Any,
) -> dict[str, Any]:
    events = [
        event
        for event in load_events(feed_path)
        if event.get("tenant_id") == tenant_id
    ]
    return {"tenant_id": tenant_id, "event_count": len(events), "events": events}


def emit_lindymode_event(
    event_type: str,
    tenant_id: str,
    reason: str,
    correlation_id: str,
    feed_path: str | Path = DEFAULT_FEED_PATH,
    drift_score: float | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    if event_type == "lindymode.state_drift_detected":
        return emit_state_drift(
            feed_path,
            tenant_id=tenant_id,
            correlation_id=correlation_id,
            reason=reason,
            drift_score=drift_score if drift_score is not None else 0.5,
            chapter_id=kwargs.get("chapter_id"),
            arc_stage=kwargs.get("arc_stage"),
            continuity_entity=kwargs.get("continuity_entity"),
        )
    severity = (
        "sev2"
        if event_type in {
            "lindymode.continuity_conflict",
            "lindymode.context_budget_breach",
        }
        else "watch"
    )
    event = LindymodeEvent(
        event_type=event_type,
        tenant_id=tenant_id,
        severity=severity,
        status="active",
        reason=reason,
        correlation_id=correlation_id,
        drift_score=drift_score,
        chapter_id=kwargs.get("chapter_id"),
        arc_stage=kwargs.get("arc_stage"),
        pov=kwargs.get("pov"),
        continuity_entity=kwargs.get("continuity_entity"),
    )
    return append_lindymode_event(feed_path, event)


def chapter_generate(chapter_id: str | None = None, **_kwargs: Any) -> dict[str, Any]:
    return {"chapter_id": chapter_id or "chapter_unassigned", "status": "drafted"}


def outline_build(**_kwargs: Any) -> dict[str, Any]:
    return {"status": "built", "acts": 3}


def summary_refresh(
    feed_path: str | Path = DEFAULT_FEED_PATH,
    tenant_id: str = DEFAULT_TENANT_ID,
    correlation_id: str | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    correlation_id = correlation_id or f"inc_summary_{uuid4().hex}"
    event = append_lindymode_event(
        feed_path,
        LindymodeEvent(
            event_type="lindymode.summary_refresh_triggered",
            tenant_id=tenant_id,
            severity="info",
            status="completed",
            reason="summary_refresh_requested",
            correlation_id=correlation_id,
        ),
    )
    return {"status": "refreshed", "event_id": event["event_id"]}


def audit_continuity(
    feed_path: str | Path = DEFAULT_FEED_PATH,
    tenant_id: str = DEFAULT_TENANT_ID,
    correlation_id: str | None = None,
    drift_score: float = 0.0,
    **_kwargs: Any,
) -> dict[str, Any]:
    correlation_id = correlation_id or f"inc_audit_{uuid4().hex}"
    event = emit_state_drift(
        feed_path,
        tenant_id=tenant_id,
        correlation_id=correlation_id,
        reason="continuity_audit_completed",
        drift_score=drift_score,
    )
    return {
        "status": "audited",
        "drift_score": drift_score,
        "event_id": event["event_id"],
    }


HANDLER_REGISTRY: dict[str, Callable[..., dict[str, Any]]] = {
    "open_dashboard": open_dashboard,
    "open_episode": open_episode,
    "show_events": show_events,
    "emit_lindymode_event": emit_lindymode_event,
    "chapter_generate": chapter_generate,
    "outline_build": outline_build,
    "summary_refresh": summary_refresh,
    "ghost_apply": ghost_apply,
    "caveman_rewrite": caveman_rewrite,
    "style_chain": style_chain,
    "proofread_run": proofread_run,
    "audit_continuity": audit_continuity,
    "query_events": query_events,
}


def _emit_shell_event(
    *,
    event_type,
    tenant_id,
    correlation_id,
    reason,
    command,
    parent_event_id=None,
    status="completed",
    severity="info",
    feed_path,
):
    event = shell_event(
        event_type=event_type,
        tenant_id=tenant_id,
        namespace="rivereditor_shell",
        reason=reason,
        correlation_id=correlation_id,
        parent_event_id=parent_event_id,
        status=status,
        severity=severity,
        command=command,
    )
    event["artifact_ref"] = write_artifact("shell", event["event_id"], event)
    append_event(feed_path, event)
    return event


def dispatch(
    raw_command: str,
    registry_path: str | Path = DEFAULT_REGISTRY_PATH,
    feed_path: str | Path = DEFAULT_FEED_PATH,
    *,
    tenant_id: str = DEFAULT_TENANT_ID,
    correlation_id: str | None = None,
    **handler_kwargs: Any,
) -> dict[str, Any]:
    """Resolve, execute, and emit events for one RiverEditor shell command."""
    registry = load_registry(registry_path)
    resolved = resolve_command(raw_command, registry)
    correlation_id = correlation_id or f"inc_shell_{uuid4().hex}"

    started = _emit_shell_event(
        event_type="shell.command_started",
        tenant_id=tenant_id,
        correlation_id=correlation_id,
        reason=f"dispatching {resolved['command']}",
        command=raw_command,
        feed_path=feed_path,
    )

    handler = HANDLER_REGISTRY.get(resolved["handler"])
    if handler is None:
        raise CommandNotFoundError(
            f"no handler registered for: {resolved['handler']}"
        )

    context = {
        "tenant_id": tenant_id,
        "correlation_id": correlation_id,
        "feed_path": feed_path,
    }
    merged_args = {**context, **resolved["args"], **handler_kwargs}

    try:
        result = handler(**merged_args)
    except Exception as error:
        _emit_shell_event(
            event_type="shell.command_failed",
            tenant_id=tenant_id,
            correlation_id=correlation_id,
            reason=str(error),
            command=raw_command,
            parent_event_id=started["event_id"],
            status="failed",
            severity="sev2",
            feed_path=feed_path,
        )
        raise

    completed = _emit_shell_event(
        event_type="shell.command_completed",
        tenant_id=tenant_id,
        correlation_id=correlation_id,
        reason=f"completed {resolved['command']}",
        command=raw_command,
        parent_event_id=started["event_id"],
        feed_path=feed_path,
    )

    return {
        "resolved": resolved,
        "result": result,
        "correlation_id": correlation_id,
        "started_event_id": started["event_id"],
        "completed_event_id": completed["event_id"],
    }


if __name__ == "__main__":
    import json
    import shutil
    import tempfile

    with tempfile.TemporaryDirectory() as scratch_dir:
        scratch_feed = Path(scratch_dir) / "events.ndjson"
        shutil.copy(DEFAULT_FEED_PATH, scratch_feed)

        for sample, extra_kwargs in [
            ("/ghost apply profile_noir", {}),
            ("/style chain ghost->caveman profile_noir", {}),
            (
                ":emit lindy-event",
                {
                    "event_type": "lindymode.state_drift_detected",
                    "reason": "selftest_drift",
                    "drift_score": 0.6,
                },
            ),
            (":open episode inc_lindy_alpha_001", {}),
        ]:
            outcome = dispatch(
                sample,
                feed_path=scratch_feed,
                tenant_id="tenant_selftest",
                **extra_kwargs,
            )
            print(
                sample,
                "->",
                json.dumps(outcome["result"], sort_keys=True)[:200],
            )
