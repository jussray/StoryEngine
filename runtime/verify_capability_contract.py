#!/usr/bin/env python3
"""Validate L99's proof-first capability contract without external packages."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / ".control" / "capability.json"
ALLOWED_STATUS = {"verified", "partial", "unverified", "blocked", "not_applicable"}
ALLOWED_HEALTH = {"green", "yellow", "red", "unknown", "not_applicable"}
REQUIRED = {
    "schema_version", "name", "version", "mission", "repository",
    "capabilities", "verification", "health", "proof", "rollback",
    "dependencies", "last_verified", "blockers", "next_gate",
}


def fail(message: str) -> None:
    raise SystemExit(f"capability contract invalid: {message}")


def main() -> None:
    data = json.loads(CONTRACT.read_text(encoding="utf-8"))

    missing = sorted(REQUIRED - data.keys())
    if missing:
        fail(f"missing required fields: {', '.join(missing)}")
    if data["schema_version"] != "1.0":
        fail("schema_version must be 1.0")
    if data["repository"] != "jussray/l99-StoryEngine":
        fail("repository identity does not match authenticated source")

    proof_ids = set()
    for proof in data["proof"]:
        proof_id = proof.get("id")
        if not proof_id or proof_id in proof_ids:
            fail("proof IDs must be non-empty and unique")
        proof_ids.add(proof_id)

    capability_ids = set()
    for capability in data["capabilities"]:
        capability_id = capability.get("id")
        status = capability.get("status")
        if not capability_id or capability_id in capability_ids:
            fail("capability IDs must be non-empty and unique")
        capability_ids.add(capability_id)
        if status not in ALLOWED_STATUS:
            fail(f"unsupported status for {capability_id}: {status}")
        refs = capability.get("evidence_ids", [])
        unknown = sorted(set(refs) - proof_ids)
        if unknown:
            fail(f"{capability_id} references missing evidence: {', '.join(unknown)}")
        if status == "verified" and not refs:
            fail(f"{capability_id} cannot be verified without evidence")

    health = data["health"]
    for key in ("overall", "build", "tests", "deploy", "runtime", "proof"):
        if health.get(key) not in ALLOWED_HEALTH:
            fail(f"unsupported health state for {key}: {health.get(key)}")

    rollback = data["rollback"]
    if rollback.get("verified") and rollback.get("evidence_id") not in proof_ids:
        fail("verified rollback requires matching evidence")

    print(f"capability contract valid: {len(capability_ids)} capabilities, {len(proof_ids)} proof records")


if __name__ == "__main__":
    main()
