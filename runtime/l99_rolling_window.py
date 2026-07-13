# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Persist rolling L99 telemetry windows over time.

`runtime/rivereditor_l99_latency_monitor.py` already builds one rich
snapshot report (`summary` + `by_stage` + `by_handler` + `by_chain_id`, ...)
from a batch of telemetry records — see `build_report`. What's still missing
is persistence across successive runs so p50/p95/L99 and rollback rate can be
read as a trend instead of a single point-in-time snapshot. This module adds
that: each call to `append_window` computes one report and appends it to an
NDJSON window store, plus (optionally) emits a `latency.window_computed`
event onto the shared event bus so dashboards see it in the live feed too.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any, Iterable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rivereditor_l99_latency_monitor import build_report, load_records  # noqa: E402
from l99_event_bus import append_event  # noqa: E402
from artifact_writer import write_artifact  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WINDOW_STORE_PATH = ROOT / "samples" / "style_chain_l99_windows.ndjson"
DEFAULT_FEED_PATH = ROOT / "samples" / "events.ndjson"


def append_window(
    records: list[dict[str, Any]],
    window_start_utc: str,
    window_end_utc: str,
    store_path: str | Path = DEFAULT_WINDOW_STORE_PATH,
    *,
    feed_path: str | Path | None = None,
    tenant_id: str = "all_tenants",
) -> dict[str, Any]:
    """Compute one L99 report over `records` and persist it as a window snapshot."""
    window_id = f"win_{uuid4().hex}"
    report = build_report(records)
    window = {
        "window_id": window_id,
        "window_start_utc": window_start_utc,
        "window_end_utc": window_end_utc,
        "computed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "report": report,
    }

    path = Path(store_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(window, sort_keys=True, separators=(",", ":")) + "\n")

    artifact_ref = write_artifact("telemetry", window_id, window)

    if feed_path is not None:
        summary = report["summary"]
        event = {
            "schema_version": "1.0",
            "event_version": 1,
            "event_id": f"evt_latency_{uuid4().hex}",
            "event_type": "latency.window_computed",
            "timestamp_utc": window["computed_at"],
            "tenant_id": tenant_id,
            "namespace": "l99_rolling_window",
            "severity": "info",
            "status": "completed",
            "source_system": "l99_rolling_window",
            "reason": f"window_computed:{window_start_utc}..{window_end_utc}",
            "rollback_rate": summary["rollback_rate"],
            "validation_failure_rate": summary["validation_failure_rate"],
            "chain_success_rate": summary["chain_success_rate"],
            "unsupported_registry_block_rate": summary["unsupported_registry_block_rate"],
            "artifact_ref": artifact_ref,
        }
        if summary["l99_chain_latency_ms"] is not None:
            event["l99_latency_ms"] = summary["l99_chain_latency_ms"]
        if summary["p50_chain_latency_ms"] is not None:
            event["p50_latency_ms"] = summary["p50_chain_latency_ms"]
        if summary["p95_chain_latency_ms"] is not None:
            event["p95_latency_ms"] = summary["p95_chain_latency_ms"]
        append_event(feed_path, event)
        window["event_id"] = event["event_id"]

    return window


def append_window_from_file(
    input_path: str | Path,
    window_start_utc: str,
    window_end_utc: str,
    store_path: str | Path = DEFAULT_WINDOW_STORE_PATH,
    **kwargs: Any,
) -> dict[str, Any]:
    records = load_records(input_path)
    return append_window(records, window_start_utc, window_end_utc, store_path, **kwargs)


def load_recent_windows(store_path: str | Path = DEFAULT_WINDOW_STORE_PATH, limit: int = 12) -> list[dict[str, Any]]:
    path = Path(store_path)
    if not path.exists():
        return []
    windows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                windows.append(json.loads(line))
    return windows[-limit:]


def trend_deltas(windows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compute window-over-window deltas for p95/L99 latency and rollback rate."""
    windows = list(windows)
    deltas = []
    for previous, current in zip(windows, windows[1:]):
        prev_summary = previous["report"]["summary"]
        cur_summary = current["report"]["summary"]
        deltas.append({
            "from_window_id": previous["window_id"],
            "to_window_id": current["window_id"],
            "p95_chain_latency_delta_ms": cur_summary["p95_chain_latency_ms"] - prev_summary["p95_chain_latency_ms"],
            "l99_chain_latency_delta_ms": cur_summary["l99_chain_latency_ms"] - prev_summary["l99_chain_latency_ms"],
            "rollback_rate_delta": cur_summary["rollback_rate"] - prev_summary["rollback_rate"],
            "validation_failure_rate_delta": cur_summary["validation_failure_rate"] - prev_summary["validation_failure_rate"],
        })
    return deltas


if __name__ == "__main__":
    telemetry_sample = ROOT / "samples" / "rivereditor_style_chain_telemetry.sample.json"

    append_window_from_file(
        telemetry_sample,
        "2026-07-07T11:00:00Z",
        "2026-07-07T11:15:00Z",
        feed_path=DEFAULT_FEED_PATH,
    )
    append_window_from_file(
        telemetry_sample,
        "2026-07-07T11:15:00Z",
        "2026-07-07T11:30:00Z",
        feed_path=DEFAULT_FEED_PATH,
    )
    windows = load_recent_windows()
    print("windows persisted:", len(windows))
    print("trend deltas:", trend_deltas(windows))
