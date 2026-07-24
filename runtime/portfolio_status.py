# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Build the sanitized L99 portfolio status envelope.

The exporter is zero-dependency. It runs the repository-owned full promotion
registry and exports only bounded operational status. Story text, creator
content, credentials, raw events, and mutation authority never cross this
boundary.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from typing import Callable, Iterable, Mapping

import promotion_gates_all
from promotion_gates import GateResult

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST_PATH = ROOT / "control-room.manifest.json"
DEFAULT_OUTPUT_PATH = ROOT / "artifacts" / "control-room" / "l99-status.json"

CONTRACT_VERSION = "1.0"
REPOSITORY = "jussray/l99-StoryEngine"
GATES = promotion_gates_all.promotion_gates.GATES
ALLOWED_STATUSES = {
    "planned",
    "integrated",
    "verified",
    "released",
    "blocked",
    "at-risk",
    "demo",
}
ALLOWED_RISKS = {"low", "medium", "high", "critical"}
RISK_ORDER = {"low": 10, "medium": 20, "high": 30, "critical": 40}
SECRET_PATTERN = re.compile(
    r"service[_-]?role[_-]?key|api[_-]?key|secret\s*[:=]|"
    r"sk-[a-z0-9_-]{10,}|sb_secret_[a-z0-9_-]{10,}|"
    r"authorization\s*:\s*bearer",
    re.IGNORECASE,
)
COMMIT_PATTERN = re.compile(r"^[a-f0-9]{40}$")
SAFE_REF_PATTERN = re.compile(r"^(?!.*\.\.)(?!https?://)[A-Za-z0-9_./-]{1,220}$")


class PortfolioStatusError(ValueError):
    """The public status envelope violates its contract."""


def _string(value: object, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise PortfolioStatusError(f"{field}_must_be_string")
    cleaned = value.strip()
    if not cleaned or len(cleaned) > limit:
        raise PortfolioStatusError(f"{field}_invalid_length")
    if SECRET_PATTERN.search(cleaned):
        raise PortfolioStatusError(f"{field}_contains_sensitive_material")
    return cleaned


def _strings(
    value: object,
    field: str,
    max_items: int,
    max_length: int,
    *,
    safe_ref: bool = False,
) -> list[str]:
    if not isinstance(value, list) or len(value) > max_items:
        raise PortfolioStatusError(f"{field}_invalid_array")
    output: list[str] = []
    for index, item in enumerate(value):
        cleaned = _string(item, f"{field}_{index}", max_length)
        if safe_ref and not SAFE_REF_PATTERN.fullmatch(cleaned):
            raise PortfolioStatusError(f"{field}_{index}_invalid")
        output.append(cleaned)
    return output


def _unique(values: Iterable[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value not in seen:
            output.append(value)
            seen.add(value)
    return output


def load_manifest(path: Path = DEFAULT_MANIFEST_PATH) -> dict:
    raw = path.read_text(encoding="utf-8")
    if len(raw) > 32_768 or SECRET_PATTERN.search(raw):
        raise PortfolioStatusError("manifest_contains_sensitive_material")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise PortfolioStatusError("manifest_must_be_object")
    if parsed.get("schemaVersion") != CONTRACT_VERSION:
        raise PortfolioStatusError("manifest_schema_version_invalid")
    if parsed.get("repository") != REPOSITORY:
        raise PortfolioStatusError("manifest_repository_invalid")
    if parsed.get("portfolioHub") != "jussray/founder-control-room":
        raise PortfolioStatusError("manifest_portfolio_hub_invalid")
    control_room = parsed.get("controlRoom")
    if not isinstance(control_room, Mapping):
        raise PortfolioStatusError("manifest_control_room_invalid")
    if control_room.get("privateContentAllowed") is not False:
        raise PortfolioStatusError("manifest_private_content_must_be_denied")
    return parsed


def run_gates(
    gates: Mapping[str, Callable[[], GateResult]] = GATES,
) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for name, gate in gates.items():
        passed, _reasons = gate()
        results.append({"gate": name, "passed": bool(passed)})
    return results


def build_status_envelope(
    manifest: Mapping[str, object],
    *,
    commit: str,
    source_run_id: str,
    source_run_attempt: int,
    observed_at: str,
    gate_results: list[dict[str, object]],
) -> dict[str, object]:
    commit = _string(commit.lower(), "commit", 40)
    if not COMMIT_PATTERN.fullmatch(commit):
        raise PortfolioStatusError("commit_invalid")
    run_id = _string(source_run_id, "source_run_id", 64)
    if not isinstance(source_run_attempt, int) or source_run_attempt < 1:
        raise PortfolioStatusError("source_run_attempt_invalid")

    evidence = manifest.get("evidence")
    risk = manifest.get("risk")
    if not isinstance(evidence, Mapping) or not isinstance(risk, Mapping):
        raise PortfolioStatusError("manifest_evidence_or_risk_invalid")

    manifest_status = _string(evidence.get("status"), "status", 32)
    manifest_risk = _string(risk.get("level"), "risk_level", 16)
    if manifest_status not in ALLOWED_STATUSES:
        raise PortfolioStatusError("status_invalid")
    if manifest_risk not in ALLOWED_RISKS:
        raise PortfolioStatusError("risk_level_invalid")

    normalized: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, result in enumerate(gate_results):
        if not isinstance(result, Mapping):
            raise PortfolioStatusError(f"gate_results_{index}_invalid")
        name = _string(result.get("gate"), f"gate_results_{index}_gate", 80)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name) or name in seen:
            raise PortfolioStatusError(f"gate_results_{index}_gate_invalid")
        passed = result.get("passed")
        if not isinstance(passed, bool):
            raise PortfolioStatusError(f"gate_results_{index}_passed_invalid")
        seen.add(name)
        normalized.append({"gate": name, "passed": passed})

    gate_status = (
        "unknown"
        if not normalized
        else "pass"
        if all(bool(item["passed"]) for item in normalized)
        else "fail"
    )
    failed = [str(item["gate"]) for item in normalized if not item["passed"]]
    status = manifest_status if gate_status == "pass" else "blocked"
    risk_level = manifest_risk
    if gate_status == "fail" and RISK_ORDER[risk_level] < RISK_ORDER["high"]:
        risk_level = "high"

    proof_refs = _strings(
        evidence.get("proofRefs", []),
        "proof_refs",
        16,
        220,
        safe_ref=True,
    )
    proof_refs = _unique(
        [
            *proof_refs,
            "runtime/promotion_gates.py",
            "runtime/promotion_gates_all.py",
            "runtime/cookie_contract.py",
            "runtime/portfolio_status.py",
            ".github/workflows/publish-control-room-status.yml",
        ]
    )[:20]

    blockers = _strings(risk.get("blockers", []), "blockers", 19, 360)
    if failed:
        blockers = _unique(
            [*blockers, f"Promotion gates failed: {', '.join(failed)}"]
        )[:20]

    next_gate = _string(manifest.get("nextGate"), "next_gate", 700)
    if failed:
        next_gate = _string(
            f"Fix failed promotion gates ({', '.join(failed)}) before: {next_gate}",
            "next_gate",
            700,
        )

    try:
        timestamp = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise PortfolioStatusError("observed_at_invalid") from error
    if timestamp.tzinfo is None:
        raise PortfolioStatusError("observed_at_timezone_required")

    envelope: dict[str, object] = {
        "schema_version": CONTRACT_VERSION,
        "repository": REPOSITORY,
        "commit": commit,
        "observed_at": timestamp.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "status": status,
        "risk_level": risk_level,
        "gate_status": gate_status,
        "gate_results": normalized,
        "proof_refs": proof_refs,
        "blockers": blockers,
        "next_gate": next_gate,
        "source_run_id": run_id,
        "source_run_attempt": source_run_attempt,
    }
    serialized = json.dumps(envelope, separators=(",", ":"), sort_keys=True)
    if len(serialized) > 32_768 or SECRET_PATTERN.search(serialized):
        raise PortfolioStatusError("envelope_contains_sensitive_material")
    return envelope


def write_envelope(envelope: Mapping[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(envelope, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--commit", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID", "local"))
    parser.add_argument(
        "--run-attempt",
        type=int,
        default=int(os.environ.get("GITHUB_RUN_ATTEMPT", "1")),
    )
    parser.add_argument(
        "--observed-at",
        default=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    envelope = build_status_envelope(
        load_manifest(args.manifest),
        commit=args.commit,
        source_run_id=args.run_id,
        source_run_attempt=args.run_attempt,
        observed_at=args.observed_at,
        gate_results=run_gates(),
    )
    write_envelope(envelope, args.output)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "commit": envelope["commit"],
                "status": envelope["status"],
                "risk_level": envelope["risk_level"],
                "gate_status": envelope["gate_status"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
