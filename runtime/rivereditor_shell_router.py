"""RiverEditor shell router.

This module parses RiverEditor command prefixes and resolves commands against a
registry. It is intentionally small: handlers are named but not executed here,
so UI shells, CLIs, or tests can route commands without binding to a runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any
from uuid import uuid4
from datetime import datetime, timezone


PREFIX_TO_MODE = {
    ">": "action",
    "/": "writing",
    ":": "operator",
    "@": "agent",
    "?": "query",
}


@dataclass(frozen=True)
class ParsedCommand:
    raw: str
    prefix: str
    mode: str
    normalized: str
    tokens: tuple[str, ...]


class CommandNotFoundError(ValueError):
    pass


class InvalidCommandError(ValueError):
    pass


def parse_command(raw: str) -> ParsedCommand:
    value = raw.strip()
    if not value:
        raise InvalidCommandError("command is empty")

    prefix = value[0]
    if prefix not in PREFIX_TO_MODE:
        raise InvalidCommandError(f"unknown command prefix: {prefix}")

    normalized = " ".join(value.split())
    tokens = tuple(normalized.split())
    return ParsedCommand(
        raw=raw,
        prefix=prefix,
        mode=PREFIX_TO_MODE[prefix],
        normalized=normalized,
        tokens=tokens,
    )


def load_registry(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _command_pattern_matches(pattern: str, parsed: ParsedCommand) -> bool:
    pattern_tokens = tuple(pattern.split())
    if len(pattern_tokens) != len(parsed.tokens):
        return False

    for expected, actual in zip(pattern_tokens, parsed.tokens):
        if expected.startswith("<") and expected.endswith(">"):
            continue
        if expected != actual:
            return False
    return True


def _extract_args(pattern: str, parsed: ParsedCommand) -> dict[str, str]:
    args: dict[str, str] = {}
    for expected, actual in zip(pattern.split(), parsed.tokens):
        if expected.startswith("<") and expected.endswith(">"):
            args[expected[1:-1]] = actual
    return args


def resolve_command(raw: str, registry: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_command(raw)
    for command in registry.get("commands", []):
        if command.get("mode") != parsed.mode:
            continue
        if _command_pattern_matches(command["command"], parsed):
            return {
                "raw": raw,
                "mode": parsed.mode,
                "command": command["command"],
                "group": command["group"],
                "handler": command["handler"],
                "args": _extract_args(command["command"], parsed),
                "pipeline": command.get("pipeline", []),
                "emits": command.get("emits", []),
                "requires_confirmation": command.get("requires_confirmation", False),
            }
    raise CommandNotFoundError(f"no registered command matched: {raw}")


def shell_event(
    *,
    event_type: str,
    tenant_id: str,
    namespace: str,
    reason: str,
    correlation_id: str | None = None,
    parent_event_id: str | None = None,
    status: str = "completed",
    severity: str = "info",
    command: str | None = None,
) -> dict[str, Any]:
    event = {
        "schema_version": "1.0",
        "event_version": 1,
        "event_id": f"evt_shell_{uuid4().hex}",
        "event_type": event_type,
        "timestamp_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "tenant_id": tenant_id,
        "namespace": namespace,
        "severity": severity,
        "status": status,
        "source_system": "rivereditor_shell",
        "reason": reason,
        "correlation_id": correlation_id or f"inc_shell_{uuid4().hex}",
        "group_key": f"tenant:{tenant_id}:severity:{severity}",
    }
    if parent_event_id:
        event["parent_event_id"] = parent_event_id
    if command:
        event["metadata"] = {"command": command}
    return event


def route(raw: str, registry_path: str | Path = "configs/rivereditor_command_registry.json") -> dict[str, Any]:
    registry = load_registry(registry_path)
    return resolve_command(raw, registry)


if __name__ == "__main__":
    for sample in [
        "> dashboard ooda",
        ":open episode inc_20260707_alpha_001",
        "/style chain ghost->caveman profile_noir",
        "? events tenant_alpha",
    ]:
        print(json.dumps(route(sample), indent=2, sort_keys=True))
