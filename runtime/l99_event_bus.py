"""Shared L99 event bus validator and appender.

Every producer (Lindymode, RiverEditor shell, rolling-window telemetry, ...)
should validate against `schemas/shared_event_bus_schema.json` before an event
reaches `samples/events.ndjson` or any other feed. This module is the single
place that happens so the contract can't silently drift between producers.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "shared_event_bus_schema.json"

_schema_cache: dict[str, Any] | None = None


def load_schema(path: str | Path = SCHEMA_PATH) -> dict[str, Any]:
    global _schema_cache
    if _schema_cache is None:
        with Path(path).open("r", encoding="utf-8") as handle:
            _schema_cache = json.load(handle)
    return _schema_cache


def validate_event(event: dict[str, Any], schema: dict[str, Any] | None = None) -> list[str]:
    """Return a list of validation problems; empty list means valid.

    This is a hand-rolled structural check (required fields, enum values,
    additionalProperties) rather than a full JSON Schema implementation —
    this repo has no third-party dependencies, so a general-purpose
    validator library is intentionally out of scope.
    """
    schema = schema or load_schema()
    problems: list[str] = []
    properties = schema.get("properties", {})

    for field in schema.get("required", []):
        if field not in event:
            problems.append(f"missing required field: {field}")

    if schema.get("additionalProperties") is False:
        for key in event:
            if key not in properties:
                problems.append(f"unexpected field not in schema: {key}")

    for key, value in event.items():
        prop = properties.get(key)
        if prop is None or value is None:
            continue
        enum = prop.get("enum")
        if enum is not None and value not in enum:
            problems.append(f"{key}={value!r} is not one of {enum}")

        prop_type = prop.get("type")
        if prop_type == "string" and not isinstance(value, str):
            problems.append(f"{key} must be a string, got {type(value).__name__}")
        elif prop_type == "integer" and not isinstance(value, int):
            problems.append(f"{key} must be an integer, got {type(value).__name__}")
        elif prop_type == "number" and not isinstance(value, (int, float)):
            problems.append(f"{key} must be a number, got {type(value).__name__}")
        elif prop_type == "array" and not isinstance(value, list):
            problems.append(f"{key} must be an array, got {type(value).__name__}")
        elif prop_type == "object" and not isinstance(value, dict):
            problems.append(f"{key} must be an object, got {type(value).__name__}")

        minimum = prop.get("minimum")
        if minimum is not None and isinstance(value, (int, float)) and value < minimum:
            problems.append(f"{key}={value} is below minimum {minimum}")
        maximum = prop.get("maximum")
        if maximum is not None and isinstance(value, (int, float)) and value > maximum:
            problems.append(f"{key}={value} is above maximum {maximum}")
        min_length = prop.get("minLength")
        if min_length is not None and isinstance(value, str) and len(value) < min_length:
            problems.append(f"{key} is shorter than minLength {min_length}")

    return problems


class InvalidEventError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


def append_event(feed_path: str | Path, event: dict[str, Any]) -> dict[str, Any]:
    """Validate and append one event as an NDJSON line. Returns the event."""
    problems = validate_event(event)
    if problems:
        raise InvalidEventError(problems)

    path = Path(feed_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
    return event


def load_events(feed_path: str | Path) -> list[dict[str, Any]]:
    path = Path(feed_path)
    if not path.exists():
        return []
    events = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


if __name__ == "__main__":
    sample_event = {
        "schema_version": "1.0",
        "event_version": 1,
        "event_id": "evt_bus_selftest_001",
        "event_type": "shell.command_started",
        "timestamp_utc": "2026-07-11T00:00:00Z",
        "tenant_id": "tenant_selftest",
        "namespace": "l99_event_bus_selftest",
        "severity": "info",
        "status": "active",
        "source_system": "l99_event_bus",
        "reason": "self_test",
    }
    print("problems:", validate_event(sample_event))
