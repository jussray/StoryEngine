#!/usr/bin/env python3
"""Run the same proof gate locally or in CI without paid services or packages."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "founder-truth"

CHECKS = [
    ("capability-adversarial", [sys.executable, "runtime/test_verify_capability_contract.py"]),
    ("capability-contract", [sys.executable, "runtime/verify_capability_contract.py"]),
    ("control-room-federation", [sys.executable, "runtime/test_control_room_contract.py"]),
    ("runtime-promotion", [sys.executable, "runtime/promotion_gates_all.py"]),
    ("header-auth", ["node", "--test", "test/securityContext.test.js"], ROOT / "story-engine"),
]


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def run_check(name: str, command: list[str], cwd: Path = ROOT) -> dict:
    started = datetime.now(timezone.utc)
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    ended = datetime.now(timezone.utc)
    return {
        "name": name,
        "command": command,
        "cwd": str(cwd.relative_to(ROOT) or "."),
        "status": "passed" if completed.returncode == 0 else "failed",
        "return_code": completed.returncode,
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "stdout": completed.stdout[-12000:],
        "stderr": completed.stderr[-12000:],
    }


def main() -> int:
    expected_sha = os.environ.get("EXPECTED_HEAD_SHA") or os.environ.get("GITHUB_SHA")
    actual_sha = git("rev-parse", "HEAD")
    if expected_sha and expected_sha != actual_sha:
        print(f"truth gate invalid: expected {expected_sha}, checked out {actual_sha}", file=sys.stderr)
        return 2

    results = []
    for item in CHECKS:
        name, command, *cwd = item
        result = run_check(name, command, cwd[0] if cwd else ROOT)
        results.append(result)
        print(f"[{result['status'].upper()}] {name}")

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "schema_version": "1.0",
        "repository": "jussray/StoryEngine",
        "head_sha": actual_sha,
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "executor": "github-actions" if os.environ.get("GITHUB_ACTIONS") == "true" else "local",
        "overall": "passed" if all(r["status"] == "passed" for r in results) else "failed",
        "checks": results,
        "truth_boundary": "This artifact proves only the commands recorded here executed against this exact checkout.",
    }
    output = ARTIFACT_DIR / f"{actual_sha}.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"evidence: {output.relative_to(ROOT)}")
    return 0 if report["overall"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
