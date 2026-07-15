# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""RiverEditor style-chain L99 telemetry analyzer.

Reads style-chain telemetry records and reports p50, p95, and L99-style tail
latency along with success, rollback, validation, migration, and unsupported
registry block rates.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any, Iterable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from artifact_writer import write_artifact  # noqa: E402


DEFAULT_SLICE_FIELDS = (
    "tenant_id",
    "profile_tier",
    "cache_state",
    "command_type",
    "chain_id",
    "registry_schema_version",
)


@dataclass(frozen=True)
class Percentiles:
    p50: float
    p95: float
    l99: float


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * percentile
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _percentiles(values: list[float]) -> Percentiles:
    return Percentiles(
        p50=round(_percentile(values, 0.50), 2),
        p95=round(_percentile(values, 0.95), 2),
        l99=round(_percentile(values, 0.99), 2),
    )


def load_records(path: str | Path) -> list[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _slice_key(record: dict[str, Any], fields: Iterable[str]) -> str:
    return "|".join(
        f"{field}={record.get(field, 'unknown')}" for field in fields
    )


def summarize_records(
    records: list[dict[str, Any]],
    slice_fields: Iterable[str] = DEFAULT_SLICE_FIELDS,
) -> dict[str, Any]:
    latencies = [float(record.get("latency_ms", 0)) for record in records]
    total = len(records)
    completed = sum(
        1 for record in records if record.get("status") == "completed"
    )
    failed = sum(
        1
        for record in records
        if record.get("status") in {"failed", "timed_out"}
    )
    rolled_back = sum(
        1
        for record in records
        if record.get("rollback_applied")
        or record.get("status") == "rolled_back"
    )
    validation_failed = sum(
        1 for record in records if record.get("validation_failed")
    )
    migration_applied = sum(
        1 for record in records if record.get("migration_applied")
    )
    unsupported_blocked = sum(
        1 for record in records if record.get("unsupported_registry_blocked")
    )

    percentiles = _percentiles(latencies)
    by_slice: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_slice[_slice_key(record, slice_fields)].append(record)

    return {
        "record_count": total,
        "p50_latency_ms": percentiles.p50,
        "p95_latency_ms": percentiles.p95,
        "l99_latency_ms": percentiles.l99,
        "chain_success_rate": round(completed / total, 4) if total else 0,
        "command_failure_rate": round(failed / total, 4) if total else 0,
        "rollback_rate": round(rolled_back / total, 4) if total else 0,
        "validation_failure_rate": round(validation_failed / total, 4)
        if total
        else 0,
        "migration_applied_rate": round(migration_applied / total, 4)
        if total
        else 0,
        "unsupported_registry_block_rate": round(
            unsupported_blocked / total,
            4,
        )
        if total
        else 0,
        "slices": {
            key: summarize_records(value, slice_fields=())
            if slice_fields
            else _summarize_leaf(value)
            for key, value in by_slice.items()
        }
        if slice_fields
        else {},
    }


def _summarize_leaf(records: list[dict[str, Any]]) -> dict[str, Any]:
    latencies = [float(record.get("latency_ms", 0)) for record in records]
    total = len(records)
    completed = sum(
        1 for record in records if record.get("status") == "completed"
    )
    rolled_back = sum(
        1
        for record in records
        if record.get("rollback_applied")
        or record.get("status") == "rolled_back"
    )
    validation_failed = sum(
        1 for record in records if record.get("validation_failed")
    )
    migration_applied = sum(
        1 for record in records if record.get("migration_applied")
    )
    unsupported_blocked = sum(
        1 for record in records if record.get("unsupported_registry_blocked")
    )
    percentiles = _percentiles(latencies)
    return {
        "record_count": total,
        "p50_latency_ms": percentiles.p50,
        "p95_latency_ms": percentiles.p95,
        "l99_latency_ms": percentiles.l99,
        "chain_success_rate": round(completed / total, 4) if total else 0,
        "rollback_rate": round(rolled_back / total, 4) if total else 0,
        "validation_failure_rate": round(validation_failed / total, 4)
        if total
        else 0,
        "migration_applied_rate": round(migration_applied / total, 4)
        if total
        else 0,
        "unsupported_registry_block_rate": round(
            unsupported_blocked / total,
            4,
        )
        if total
        else 0,
    }


def write_report(input_path: str | Path, output_path: str | Path) -> dict[str, Any]:
    records = load_records(input_path)
    report = summarize_records(records)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return report


def write_telemetry_artifact(
    report: dict[str, Any],
    artifact_id: str | None = None,
) -> str:
    artifact_id = artifact_id or f"telemetry_{uuid4().hex}"
    return write_artifact("telemetry", artifact_id, report)


if __name__ == "__main__":
    write_report(
        "samples/style_chain_telemetry.sample.json",
        "samples/style_chain_l99_report.sample.json",
    )
