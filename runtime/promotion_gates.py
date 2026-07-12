"""L99 CI promotion gates.

Seven gates, one per category named in the README backlog: provenance,
revocation, partition-boundary, event-schema, Lindymode drift, shell-command,
and L99 latency. Each gate is a `(passed: bool, reasons: list[str])` function
so `main()` can print a single pass/fail report and exit non-zero in CI —
same zero-dependency reporter style as `style_chain_l99_analyzer.py`.
"""

from __future__ import annotations

from pathlib import Path
import sys
import tempfile
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from l99_event_bus import load_events, validate_event  # noqa: E402
from artifact_writer import build_decision_artifact, load_provenance_rules  # noqa: E402
from partition_resolver import IsolationEnvelope, resolve_partition_id  # noqa: E402
from rivereditor_shell_router import load_registry, parse_command, resolve_command  # noqa: E402
from rivereditor_handlers import HANDLER_REGISTRY  # noqa: E402
from rivereditor_l99_latency_monitor import build_report, load_records  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EVENTS_FEED_PATH = ROOT / "samples" / "events.ndjson"
TELEMETRY_SAMPLE_PATH = ROOT / "samples" / "rivereditor_style_chain_telemetry.sample.json"
REGISTRY_PATH = ROOT / "configs" / "rivereditor_command_registry.json"

L99_LATENCY_THRESHOLD_MS = 5000.0
ROLLBACK_RATE_THRESHOLD = 0.5
VALIDATION_FAILURE_RATE_THRESHOLD = 0.75

GateResult = tuple[bool, list[str]]


def _base_envelope(**overrides) -> dict:
    envelope = {
        "tenant_id": "tenant_alpha",
        "user_scope": "user_1",
        "authorization_scope": ["story:read"],
        "namespace": "story_state",
        "model_version": "model_1",
        "policy_version": "policy_1",
        "memory_schema_version": "1.0.0",
        "revocation_epoch": 8,
        "partition_version": "1",
    }
    envelope.update(overrides)
    return envelope


def gate_provenance() -> GateResult:
    reasons: list[str] = []
    rules = load_provenance_rules()
    for key in ("decision_order", "required_matches", "promotion_blockers", "required_audit_fields"):
        value = rules.get(key)
        if not value:
            reasons.append(f"policies/provenance_rules.json missing or empty required key: {key}")

    with tempfile.TemporaryDirectory() as scratch:
        clean = build_decision_artifact(
            candidate_entry_id="cache_gate_clean",
            producer_tenant_id="tenant_alpha",
            consumer_tenant_id="tenant_alpha",
            producer_user_scope="user_1",
            consumer_user_scope="user_1",
            producer_authorization_scope=["story:read"],
            consumer_authorization_scope=["story:read"],
            provenance_domain="story_state",
            producer_revocation_epoch=8,
            consumer_revocation_epoch=8,
            artifacts_dir=scratch,
        )
        if clean["final_action"] != "allow":
            reasons.append(f"clean decision input did not resolve to allow: got {clean['final_action']}")

        boundary_violation = build_decision_artifact(
            candidate_entry_id="cache_gate_violation",
            producer_tenant_id="tenant_alpha",
            consumer_tenant_id="tenant_beta",
            producer_user_scope="user_1",
            consumer_user_scope="user_1",
            producer_authorization_scope=["story:read"],
            consumer_authorization_scope=["story:read"],
            provenance_domain="story_state",
            producer_revocation_epoch=8,
            consumer_revocation_epoch=8,
            artifacts_dir=scratch,
        )
        if boundary_violation["final_action"] != "block":
            reasons.append(f"tenant-mismatched decision input did not resolve to block: got {boundary_violation['final_action']}")
        if not boundary_violation["incident_required"]:
            reasons.append("boundary-violating decision did not set incident_required")

    return (not reasons, reasons)


def gate_revocation() -> GateResult:
    reasons: list[str] = []
    older = IsolationEnvelope.from_mapping(_base_envelope(revocation_epoch=7))
    newer = IsolationEnvelope.from_mapping(_base_envelope(revocation_epoch=8))

    if resolve_partition_id(older) == resolve_partition_id(newer):
        reasons.append("partition_resolver produced the same partition id across different revocation epochs")

    return (not reasons, reasons)


def gate_partition_boundary() -> GateResult:
    reasons: list[str] = []
    base = IsolationEnvelope.from_mapping(_base_envelope())
    same = IsolationEnvelope.from_mapping(_base_envelope())
    if resolve_partition_id(base) != resolve_partition_id(same):
        reasons.append("identical isolation envelopes produced different partition ids")

    for field in ("tenant_id", "user_scope", "namespace", "model_version", "policy_version"):
        varied = IsolationEnvelope.from_mapping(_base_envelope(**{field: "different_value"}))
        if resolve_partition_id(base) == resolve_partition_id(varied):
            reasons.append(f"varying required field '{field}' did not change the partition id")

    return (not reasons, reasons)


def gate_event_schema() -> GateResult:
    reasons: list[str] = []
    events = load_events(EVENTS_FEED_PATH)
    if not events:
        reasons.append(f"no events found in {EVENTS_FEED_PATH}")
    for event in events:
        problems = validate_event(event)
        if problems:
            reasons.append(f"{event.get('event_id', '<unknown>')}: {'; '.join(problems)}")

    return (not reasons, reasons)


def gate_lindymode_drift() -> GateResult:
    reasons: list[str] = []
    events = load_events(EVENTS_FEED_PATH)
    for event in events:
        if event.get("event_type") != "lindymode.state_drift_detected":
            continue
        drift_score = event.get("drift_score")
        event_id = event.get("event_id", "<unknown>")
        if drift_score is None:
            reasons.append(f"{event_id}: state_drift_detected event is missing drift_score")
            continue
        if not (0 <= drift_score <= 1):
            reasons.append(f"{event_id}: drift_score {drift_score} is outside [0, 1]")
        expected_severity = "sev2" if drift_score >= 0.75 else "watch"
        actual_severity = event.get("severity")
        if actual_severity not in {expected_severity, "sev3"}:
            reasons.append(
                f"{event_id}: drift_score {drift_score} implies severity >= {expected_severity}, got {actual_severity}"
            )

    return (not reasons, reasons)


def _synthesize_command(pattern: str) -> str:
    tokens = pattern.split()
    return " ".join("sample_value" if token.startswith("<") and token.endswith(">") else token for token in tokens)


def gate_shell_command() -> GateResult:
    reasons: list[str] = []
    registry = load_registry(REGISTRY_PATH)
    seen: set[tuple[str, str]] = set()

    for entry in registry.get("commands", []):
        key = (entry.get("mode"), entry.get("command"))
        if key in seen:
            reasons.append(f"duplicate (mode, command) registry entry: {key}")
        seen.add(key)

        handler_name = entry.get("handler")
        if handler_name not in HANDLER_REGISTRY:
            reasons.append(f"command {entry.get('command')!r} references unregistered handler {handler_name!r}")

        synthesized = _synthesize_command(entry["command"])
        try:
            parse_command(synthesized)
            resolved = resolve_command(synthesized, registry)
        except Exception as error:  # noqa: BLE001
            reasons.append(f"command pattern {entry.get('command')!r} failed to round-trip: {error}")
            continue
        if resolved["handler"] != handler_name:
            reasons.append(f"command {entry.get('command')!r} resolved to handler {resolved['handler']!r}, expected {handler_name!r}")

    return (not reasons, reasons)


def gate_l99_latency() -> GateResult:
    reasons: list[str] = []
    records = load_records(TELEMETRY_SAMPLE_PATH)
    report = build_report(records)
    summary = report["summary"]

    if summary["l99_chain_latency_ms"] > L99_LATENCY_THRESHOLD_MS:
        reasons.append(f"L99 chain latency {summary['l99_chain_latency_ms']}ms exceeds threshold {L99_LATENCY_THRESHOLD_MS}ms")
    if summary["rollback_rate"] > ROLLBACK_RATE_THRESHOLD:
        reasons.append(f"rollback rate {summary['rollback_rate']} exceeds threshold {ROLLBACK_RATE_THRESHOLD}")
    if summary["validation_failure_rate"] > VALIDATION_FAILURE_RATE_THRESHOLD:
        reasons.append(f"validation failure rate {summary['validation_failure_rate']} exceeds threshold {VALIDATION_FAILURE_RATE_THRESHOLD}")

    return (not reasons, reasons)


GATES: dict[str, Callable[[], GateResult]] = {
    "provenance": gate_provenance,
    "revocation": gate_revocation,
    "partition_boundary": gate_partition_boundary,
    "event_schema": gate_event_schema,
    "lindymode_drift": gate_lindymode_drift,
    "shell_command": gate_shell_command,
    "l99_latency": gate_l99_latency,
}


def main() -> int:
    all_passed = True
    print("L99 promotion gates")
    print("=" * 40)
    for name, gate in GATES.items():
        passed, reasons = gate()
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {name}")
        for reason in reasons:
            print(f"    - {reason}")
        all_passed = all_passed and passed
    print("=" * 40)
    print("ALL GATES PASSED" if all_passed else "GATE FAILURES DETECTED")
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
