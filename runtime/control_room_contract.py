# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Verify the canonical Founder Control Room federation boundary."""

from __future__ import annotations

import json
from pathlib import Path

FEDERATED_MANIFEST = ".control-room/repository.manifest.json"
LEGACY_MANIFEST = "control-room.manifest.json"
LEGACY_WORKFLOW = ".github/workflows/publish-control-room-status.yml"
PROMOTION_WORKFLOW = ".github/workflows/l99-promotion-gates.yml"
EXPECTED_REPOSITORY = "jussray/l99-StoryEngine"
EXPECTED_PROJECT = "l99"
EXPECTED_PROMOTION_COMMAND = "python runtime/promotion_gates_all.py"
REQUIRED_COOKIE_EVIDENCE = {
    ".security/cookies.json",
    "runtime/cookie_contract.py",
    "runtime/promotion_gates_all.py",
    "story-engine/public/l99_auth.js",
    "story-engine/lib/securityContext.js",
    "story-engine/test/securityContext.test.js",
}
FORBIDDEN_LEGACY_AUTHORITY = (
    "id-token: write",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "FOUNDER_CONTROL_ROOM_URL",
    "ingest-l99-status",
    "curl ",
)


def _load_json(root: Path, relative_path: str) -> dict:
    path = root / relative_path
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"unable_to_read_{relative_path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{relative_path}_must_be_object")
    return value


def _capability(manifest: dict, capability_id: str) -> dict | None:
    capabilities = manifest.get("capabilities")
    if not isinstance(capabilities, list):
        return None
    for capability in capabilities:
        if isinstance(capability, dict) and capability.get("id") == capability_id:
            return capability
    return None


def _usage_assertion(capability: dict, assertion_id: str) -> dict | None:
    assertions = capability.get("usageAssertions")
    if not isinstance(assertions, list):
        return None
    for assertion in assertions:
        if isinstance(assertion, dict) and assertion.get("id") == assertion_id:
            return assertion
    return None


def verify_control_room_contract(root: Path) -> list[str]:
    errors: list[str] = []

    try:
        manifest = _load_json(root, FEDERATED_MANIFEST)
    except ValueError as error:
        return [str(error)]

    repository = manifest.get("repository")
    if manifest.get("schemaVersion") != "1.0":
        errors.append("federated manifest schemaVersion must be 1.0")
    if manifest.get("projectId") != EXPECTED_PROJECT:
        errors.append("federated manifest projectId must remain l99")
    if not isinstance(repository, dict):
        errors.append("federated manifest repository must be an object")
    else:
        if repository.get("provider") != "github":
            errors.append("federated manifest provider must be github")
        if repository.get("identifier") != EXPECTED_REPOSITORY:
            errors.append("federated manifest repository identity is stale")
        if repository.get("defaultBranch") != "main":
            errors.append("federated manifest default branch must be main")

    verification = manifest.get("verification")
    required_signals = verification.get("requiredSignals") if isinstance(verification, dict) else None
    signal_ids = {
        item.get("id")
        for item in required_signals
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    } if isinstance(required_signals, list) else set()
    if "promotion-gates" not in signal_ids:
        errors.append("federated manifest must require promotion-gates")

    promotion_capability = _capability(manifest, "tail-latency-and-promotion-controls")
    if promotion_capability is None:
        errors.append("promotion capability is missing")
    else:
        assertion = _usage_assertion(
            promotion_capability,
            "workflow-executes-promotion-gates",
        )
        if assertion is None:
            errors.append("promotion workflow usage assertion is missing")
        else:
            if assertion.get("path") != PROMOTION_WORKFLOW:
                errors.append("promotion workflow usage assertion path is wrong")
            if assertion.get("marker") != EXPECTED_PROMOTION_COMMAND:
                errors.append("promotion workflow usage assertion is stale")

    cookie_capability = _capability(manifest, "cookie-free-auth-transport")
    if cookie_capability is None:
        errors.append("cookie-free-auth-transport capability is missing")
    else:
        evidence_paths = cookie_capability.get("evidencePaths")
        evidence = set(evidence_paths) if isinstance(evidence_paths, list) else set()
        missing = sorted(REQUIRED_COOKIE_EVIDENCE - evidence)
        if missing:
            errors.append(
                "cookie capability is missing evidence paths: " + ", ".join(missing)
            )
        required = cookie_capability.get("requiredSignals")
        if not isinstance(required, list) or "promotion-gates" not in required:
            errors.append("cookie capability must require promotion-gates")

    promotion_workflow = (root / PROMOTION_WORKFLOW).read_text(
        encoding="utf-8",
        errors="replace",
    )
    if EXPECTED_PROMOTION_COMMAND not in promotion_workflow:
        errors.append("promotion workflow does not execute the full gate registry")

    legacy_workflow = (root / LEGACY_WORKFLOW).read_text(
        encoding="utf-8",
        errors="replace",
    )
    if "Legacy L99 Direct Status Bridge (Retired)" not in legacy_workflow:
        errors.append("legacy direct observer is not visibly retired")
    if "if: false" not in legacy_workflow:
        errors.append("legacy direct observer can still allocate a runner")
    for forbidden in FORBIDDEN_LEGACY_AUTHORITY:
        if forbidden in legacy_workflow:
            errors.append(f"legacy direct observer retains authority: {forbidden}")

    try:
        legacy_manifest = _load_json(root, LEGACY_MANIFEST)
    except ValueError as error:
        errors.append(str(error))
    else:
        if legacy_manifest.get("repository") != EXPECTED_REPOSITORY:
            errors.append("legacy manifest repository identity is stale")
        authority = legacy_manifest.get("authority")
        if not isinstance(authority, dict):
            errors.append("legacy manifest authority must be an object")
        else:
            if authority.get("portfolioMode") != "retired-direct-observer":
                errors.append("legacy manifest does not mark the direct observer retired")
            if authority.get("canonicalIntegration") != FEDERATED_MANIFEST:
                errors.append("legacy manifest does not point to the federated contract")

    return errors
