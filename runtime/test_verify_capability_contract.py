#!/usr/bin/env python3
"""Adversarial tests for the proof-first capability contract validator."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "runtime" / "verify_capability_contract.py"
BASE = json.loads((ROOT / ".control" / "capability.json").read_text(encoding="utf-8"))
REPOSITORY = "jussray/l99-StoryEngine"
SHA = "a" * 40


def run_case(data: dict, *, should_pass: bool, name: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "capability.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        env = {
            **os.environ,
            "CAPABILITY_CONTRACT": str(path),
            "GITHUB_REPOSITORY": REPOSITORY,
            "GITHUB_SHA": SHA,
        }
        result = subprocess.run(
            ["python", str(VALIDATOR)],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        passed = result.returncode == 0
        if passed != should_pass:
            raise AssertionError(
                f"{name}: expected pass={should_pass}, got {passed}\nstdout={result.stdout}\nstderr={result.stderr}"
            )


def proof() -> dict:
    return {
        "id": "exact-head-test",
        "kind": "workflow",
        "status": "verified",
        "source": f"https://github.com/{REPOSITORY}/actions/runs/123456",
        "commit_sha": SHA,
        "scope": ["TEST"],
        "verified_at": "2026-07-25T20:00:00Z",
    }


def main() -> None:
    run_case(copy.deepcopy(BASE), should_pass=True, name="conservative baseline")

    partial_without_proof = copy.deepcopy(BASE)
    partial_without_proof["capabilities"][0]["status"] = "partial"
    run_case(partial_without_proof, should_pass=False, name="partial without proof")

    fake_mutable_source = copy.deepcopy(BASE)
    fake_mutable_source["proof"] = [{**proof(), "source": f"https://github.com/{REPOSITORY}/tree/main"}]
    fake_mutable_source["capabilities"][1].update(status="verified", evidence_ids=["exact-head-test"])
    run_case(fake_mutable_source, should_pass=False, name="mutable source")

    cross_commit = copy.deepcopy(BASE)
    cross_commit["proof"] = [{**proof(), "commit_sha": "b" * 40}]
    cross_commit["capabilities"][1].update(status="verified", evidence_ids=["exact-head-test"])
    run_case(cross_commit, should_pass=False, name="cross commit proof")

    unknown_capability = copy.deepcopy(BASE)
    unknown_capability["capabilities"][0]["id"] = "MAGIC"
    run_case(unknown_capability, should_pass=False, name="unknown capability")

    omitted_capability = copy.deepcopy(BASE)
    omitted_capability["capabilities"] = omitted_capability["capabilities"][:-1]
    run_case(omitted_capability, should_pass=False, name="omitted capability")

    contradictory_green = copy.deepcopy(BASE)
    contradictory_green["health"]["overall"] = "green"
    run_case(contradictory_green, should_pass=False, name="green with blockers")

    verified_security_with_blocker = copy.deepcopy(BASE)
    verified_security_with_blocker["proof"] = [proof()]
    security = next(item for item in verified_security_with_blocker["capabilities"] if item["id"] == "SECURITY")
    security.update(status="verified", evidence_ids=["exact-head-test"])
    run_case(verified_security_with_blocker, should_pass=False, name="security blocker contradiction")

    invalid_rollback_scope = copy.deepcopy(BASE)
    invalid_rollback_scope["rollback"]["scope"] = "everything"
    run_case(invalid_rollback_scope, should_pass=False, name="invalid rollback scope")

    print("capability contract adversarial tests passed: 8 rejection cases + conservative baseline")


if __name__ == "__main__":
    main()
