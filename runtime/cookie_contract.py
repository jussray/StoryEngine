# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Deny-undeclared cookie verification for the L99 runtime and dashboards."""

from __future__ import annotations

import json
import re
from pathlib import Path

WRITER_PATTERNS = (
    re.compile(r"document\.cookie\s*="),
    re.compile(r"Set-Cookie", re.IGNORECASE),
    re.compile(r"\bset_cookie\s*\("),
    re.compile(r"\bsetCookie\s*\("),
)
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".tsx", ".html"}
IGNORED_PARTS = {".git", "node_modules", "dist", "build", "coverage", "__pycache__"}


def verify_cookie_contract(root: Path) -> list[str]:
    errors: list[str] = []
    manifest_path = root / ".security" / "cookies.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"unable to read {manifest_path}: {error}"]

    if manifest.get("schemaVersion") != 1:
        errors.append("schemaVersion must be 1")
    if manifest.get("defaultPolicy") != "deny-undeclared":
        errors.append("defaultPolicy must be deny-undeclared")

    cookies = manifest.get("cookies")
    writers = manifest.get("allowedCookieWriters")
    scan_roots = manifest.get("scanRoots")
    if not isinstance(cookies, list):
        errors.append("cookies must be an array")
        cookies = []
    if not isinstance(writers, list):
        errors.append("allowedCookieWriters must be an array")
        writers = []
    if not isinstance(scan_roots, list):
        errors.append("scanRoots must be an array")
        scan_roots = []

    allowed = {str(path).replace("\\", "/") for path in writers}
    if not cookies and allowed:
        errors.append("cookie-free repositories cannot declare cookie writers")

    for declared in sorted(allowed):
        if not (root / declared).is_file():
            errors.append(f"declared cookie writer does not exist: {declared}")

    for scan_root in scan_roots:
        base = root / str(scan_root)
        if not base.exists():
            errors.append(f"scan root does not exist: {scan_root}")
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            if any(part in IGNORED_PARTS for part in path.parts):
                continue
            repo_path = path.relative_to(root).as_posix()
            if "/tests/" in f"/{repo_path}/" or path.name.startswith("test_"):
                continue
            source = path.read_text(encoding="utf-8", errors="replace")
            if any(pattern.search(source) for pattern in WRITER_PATTERNS) and repo_path not in allowed:
                errors.append(f"undeclared cookie writer: {repo_path}")

    return errors
