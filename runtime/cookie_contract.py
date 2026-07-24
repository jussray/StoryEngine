# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Deny undeclared cookies and ambient cookie authentication in L99."""

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
VERIFIER_PATH = "runtime/cookie_contract.py"
BROWSER_AUTH_PATH = "story-engine/public/l99_auth.js"
SERVER_AUTH_PATH = "story-engine/lib/securityContext.js"


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
    if cookies:
        errors.append("L99 must remain cookie-free")
    if allowed:
        errors.append("L99 must not declare cookie writers")

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
            if repo_path == VERIFIER_PATH:
                continue
            if "/tests/" in f"/{repo_path}/" or path.name.startswith("test_"):
                continue
            source = path.read_text(encoding="utf-8", errors="replace")
            if any(pattern.search(source) for pattern in WRITER_PATTERNS):
                errors.append(f"cookie operation detected: {repo_path}")

    browser_auth = (root / BROWSER_AUTH_PATH).read_text(encoding="utf-8", errors="replace")
    if "document.cookie" in browser_auth:
        errors.append(f"browser auth touches document.cookie: {BROWSER_AUTH_PATH}")
    if "sessionStorage" not in browser_auth or "x-api-key" not in browser_auth:
        errors.append("browser auth must preserve tab-scoped storage and explicit x-api-key transport")

    server_auth = (root / SERVER_AUTH_PATH).read_text(encoding="utf-8", errors="replace")
    for forbidden in ("cookieCredential", "headers?.cookie", "headers.cookie", "l99_api_key"):
        if forbidden in server_auth:
            errors.append(f"server auth contains forbidden cookie credential path: {forbidden}")
    if "x-api-key" not in server_auth or "Bearer" not in server_auth:
        errors.append("server auth must preserve x-api-key and Bearer credential paths")

    return errors
