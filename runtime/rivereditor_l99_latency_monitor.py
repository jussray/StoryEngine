"""RiverEditor L99 latency monitor.

Reads telemetry JSON or NDJSON and produces a compact latency / reliability
report for shell commands and style-chain operations. Uses no external deps.
"""

from __future__ import annotations

from collections import defaultdict
import json
import math
from pathlib import Path
from typing import Any, Iterable


TERMINAL_SUCCESS = {"completed", "migrated"}
TERMINAL_FAILURE = {"failed", "blocked", "timed_out", "rolled_back"}


def load_records(path: str | Path) -> list[dict[str, Any]]:
    target = Path(path)
    text = target.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if target.suffix == ".ndjson":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    payload = json.loads(text)
    if isinstance(payload, list):
        return payload
    return [payload]


def percentile(values: Iterable[float], p: float) -> float | None:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    if len(ordered) == 1:
        return ordered[0]
    rank = (p / 100.0) * (len(ordered) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[int(rank)]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def summarize_latencies(records: list[dict[str, Any]], key: str) -> dict[str, Any]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for record in records:
        value = record.get(key, "unknown")
        grouped[str(value)].append(float(record.get("latency_ms", 0)))
    return {
        group: {
            "count": len(values),
            "p50_ms": percentile(values, 50),
            "p95_ms": percentile(values, 95),
            "l99_ms": percentile(values, 99),
            "max_ms": max(values) if values else None,
        }
        for group, values in sorted(grouped.items())
    }


def chain_totals(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    chains: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        chains[str(record.get("chain_id", "unknown"))].append(record)

    output: dict[str, dict[str, Any]] = {}
    for chain_id, chain_records in sorted(chains.items()):
        latency = sum(float(record.get("latency_ms", 0)) for record in chain_records)
        statuses = {str(record.get("status", "unknown")) for record in chain_records}
        output[chain_id] = {
            "stage_count": len(chain_records),
            "total_latency_ms": latency,
            "status": "failed" if statuses & TERMINAL_FAILURE else "completed",
            "rollback_applied": any(bool(record.get("rollback_applied")) for record in chain_records),
            "validation_failed": any(bool(record.get("validation_failed")) for record in chain_records),
            "migration_applied": any(bool(record.get("migration_applied")) for record in chain_records),
            "unsupported_registry_blocked": any(bool(record.get("unsupported_registry_blocked")) for record in chain_records),
            "tenant_id": chain_records[0].get("tenant_id", "unknown"),
            "profile_tier": chain_records[0].get("profile_tier", "unknown"),
            "cache_state": chain_records[0].get("cache_state", "unknown"),
            "command_type": chain_records[0].get("command_type", "unknown"),
            "registry_schema_version": chain_records[0].get("registry_schema_version", "unknown"),
            "correlation_id": chain_records[0].get("correlation_id"),
        }
    return output


def rate(numerator: int, denominator: int) -> float:
    return 0.0 if denominator == 0 else numerator / denominator


def build_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    chains = chain_totals(records)
    chain_values = list(chains.values())
    chain_latencies = [float(value["total_latency_ms"]) for value in chain_values]
    total_chains = len(chain_values)
    failed_chains = sum(1 for value in chain_values if value["status"] == "failed")
    rollback_chains = sum(1 for value in chain_values if value["rollback_applied"])
    validation_failed = sum(1 for value in chain_values if value["validation_failed"])
    migrated = sum(1 for value in chain_values if value["migration_applied"])
    unsupported = sum(1 for value in chain_values if value["unsupported_registry_blocked"])

    return {
        "summary": {
            "record_count": len(records),
            "chain_count": total_chains,
            "chain_success_rate": rate(total_chains - failed_chains, total_chains),
            "rollback_rate": rate(rollback_chains, total_chains),
            "validation_failure_rate": rate(validation_failed, total_chains),
            "migration_applied_rate": rate(migrated, total_chains),
            "unsupported_registry_block_rate": rate(unsupported, total_chains),
            "p50_chain_latency_ms": percentile(chain_latencies, 50),
            "p95_chain_latency_ms": percentile(chain_latencies, 95),
            "l99_chain_latency_ms": percentile(chain_latencies, 99),
            "max_chain_latency_ms": max(chain_latencies) if chain_latencies else None,
        },
        "by_stage": summarize_latencies(records, "stage"),
        "by_handler": summarize_latencies(records, "handler"),
        "by_profile_tier": summarize_latencies(records, "profile_tier"),
        "by_cache_state": summarize_latencies(records, "cache_state"),
        "by_command_type": summarize_latencies(records, "command_type"),
        "by_chain_id": {chain_id: data for chain_id, data in chains.items()},
        "by_registry_schema_version": summarize_latencies(records, "registry_schema_version"),
    }


def write_report(input_path: str | Path, output_path: str | Path) -> dict[str, Any]:
    records = load_records(input_path)
    report = build_report(records)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    write_report(
        "samples/rivereditor_style_chain_telemetry.sample.json",
        "artifacts/rivereditor_l99_latency_report.sample.json",
    )
