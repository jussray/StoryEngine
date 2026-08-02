#!/usr/bin/env python3
"""Validate L99's proof-first capability contract without external packages."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = Path(os.environ.get("CAPABILITY_CONTRACT", ROOT / ".control" / "capability.json"))
EXPECTED_REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "jussray/l99-StoryEngine")
EXPECTED_SHA = os.environ.get("GITHUB_SHA")

ALLOWED_STATUS = {"verified", "partial", "unverified", "blocked", "not_applicable"}
ALLOWED_HEALTH = {"green", "yellow", "red", "unknown", "not_applicable"}
ALLOWED_PROOF_KIND = {"workflow", "artifact", "commit", "deployment", "test_report", "runtime_check", "manual_review"}
ALLOWED_PROOF_STATUS = {"verified", "stale", "missing", "failed"}
REQUIRED_CAPABILITIES = {
    "BUILD", "TEST", "VERIFY", "DEPLOY", "ROLLBACK", "HEALTH", "AUTH",
    "DATABASE", "API", "AI", "MCP", "AUTOMATION", "ANALYTICS",
    "NOTIFICATIONS", "OBSERVABILITY", "SECURITY", "EVIDENCE",
}
REQUIRED = {
    "schema_version", "name", "version", "mission", "repository",
    "capabilities", "verification", "health", "proof", "rollback",
    "dependencies", "last_verified", "blockers", "next_gate",
}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
IMMUTABLE_SOURCE_RE = re.compile(r"/(actions/runs/\d+|commit/[0-9a-f]{40}|deployments/\d+|artifacts/\d+)(?:$|[/?#])")


def fail(message: str) -> None:
    raise SystemExit(f"capability contract invalid: {message}")


def parse_time(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        fail(f"{field} must be a non-empty date-time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail(f"{field} must be ISO-8601 date-time")
    if parsed.tzinfo is None:
        fail(f"{field} must include timezone")
    return parsed.astimezone(timezone.utc)


def validate_source(source: object, proof_id: str) -> None:
    if not isinstance(source, str) or not source:
        fail(f"proof {proof_id} source must be non-empty")
    parsed = urlparse(source)
    if parsed.scheme not in {"https"} or not parsed.netloc:
        fail(f"proof {proof_id} source must be an HTTPS URL")
    if not IMMUTABLE_SOURCE_RE.search(parsed.path):
        fail(f"proof {proof_id} source must reference an immutable run, commit, deployment, or artifact")


def main() -> None:
    data = json.loads(CONTRACT.read_text(encoding="utf-8"))

    missing = sorted(REQUIRED - data.keys())
    if missing:
        fail(f"missing required fields: {', '.join(missing)}")
    if data["schema_version"] != "1.0":
        fail("schema_version must be 1.0")
    if data["repository"] != EXPECTED_REPOSITORY:
        fail(f"repository identity mismatch: expected {EXPECTED_REPOSITORY}")

    proof_ids: set[str] = set()
    verified_proof_ids: set[str] = set()
    for proof in data["proof"]:
        proof_id = proof.get("id")
        if not isinstance(proof_id, str) or not proof_id or proof_id in proof_ids:
            fail("proof IDs must be non-empty and unique")
        proof_ids.add(proof_id)
        if proof.get("kind") not in ALLOWED_PROOF_KIND:
            fail(f"unsupported proof kind for {proof_id}: {proof.get('kind')}")
        if proof.get("status") not in ALLOWED_PROOF_STATUS:
            fail(f"unsupported proof status for {proof_id}: {proof.get('status')}")
        validate_source(proof.get("source"), proof_id)
        commit_sha = proof.get("commit_sha")
        if not isinstance(commit_sha, str) or not SHA_RE.fullmatch(commit_sha):
            fail(f"proof {proof_id} requires a full 40-character commit_sha")
        if EXPECTED_SHA and commit_sha != EXPECTED_SHA:
            fail(f"proof {proof_id} is bound to {commit_sha}, not exact head {EXPECTED_SHA}")
        verified_at = parse_time(proof.get("verified_at"), f"proof {proof_id} verified_at")
        if verified_at > datetime.now(timezone.utc):
            fail(f"proof {proof_id} verified_at cannot be in the future")
        scope = proof.get("scope")
        if not isinstance(scope, list) or not scope or not all(isinstance(item, str) and item for item in scope):
            fail(f"proof {proof_id} scope must be a non-empty string array")
        if proof.get("status") == "verified":
            verified_proof_ids.add(proof_id)

    capability_ids: set[str] = set()
    capability_status: dict[str, str] = {}
    for capability in data["capabilities"]:
        capability_id = capability.get("id")
        status = capability.get("status")
        if capability_id not in REQUIRED_CAPABILITIES:
            fail(f"unsupported capability ID: {capability_id}")
        if capability_id in capability_ids:
            fail(f"duplicate capability ID: {capability_id}")
        capability_ids.add(capability_id)
        capability_status[capability_id] = status
        if status not in ALLOWED_STATUS:
            fail(f"unsupported status for {capability_id}: {status}")
        refs = capability.get("evidence_ids", [])
        if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
            fail(f"{capability_id} evidence_ids must be a string array")
        unknown = sorted(set(refs) - proof_ids)
        if unknown:
            fail(f"{capability_id} references missing evidence: {', '.join(unknown)}")
        if status in {"verified", "partial"} and not refs:
            fail(f"{capability_id} cannot be {status} without evidence")
        if status in {"verified", "partial"} and not set(refs) <= verified_proof_ids:
            fail(f"{capability_id} {status} status requires verified evidence")

    omitted = sorted(REQUIRED_CAPABILITIES - capability_ids)
    if omitted:
        fail(f"required capabilities omitted: {', '.join(omitted)}")

    health = data["health"]
    for key in ("overall", "build", "tests", "deploy", "runtime", "proof"):
        if health.get(key) not in ALLOWED_HEALTH:
            fail(f"unsupported health state for {key}: {health.get(key)}")

    blockers = data["blockers"]
    if not isinstance(blockers, list) or not all(isinstance(item, str) and item for item in blockers):
        fail("blockers must be a string array")
    if blockers and health.get("overall") == "green":
        fail("overall health cannot be green while blockers exist")
    blocker_text = " ".join(blockers).lower()
    if any(term in blocker_text for term in ("auth", "session", "authorization", "api-key")) and capability_status["AUTH"] == "verified":
        fail("AUTH cannot be verified while authentication or authorization blockers exist")
    if any(term in blocker_text for term in ("security", "stripe", "csp", "signature")) and capability_status["SECURITY"] == "verified":
        fail("SECURITY cannot be verified while security blockers exist")

    rollback = data["rollback"]
    if rollback.get("verified") and rollback.get("evidence_id") not in verified_proof_ids:
        fail("verified rollback requires matching verified evidence")
    if rollback.get("scope") not in {"code_only", "application", "full_operational"}:
        fail("rollback scope must be code_only, application, or full_operational")

    last_verified = data["last_verified"]
    if last_verified is not None:
        parse_time(last_verified, "last_verified")
        if not verified_proof_ids:
            fail("last_verified requires at least one verified proof record")

    print(f"capability contract valid: {len(capability_ids)} capabilities, {len(proof_ids)} proof records")


if __name__ == "__main__":
    main()
