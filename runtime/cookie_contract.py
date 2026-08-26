# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""Verify the declared opaque browser-session cookie contract in L99."""

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
PUBLIC_ROOT = "story-engine/public"
SERVER_AUTH_PATH = "story-engine/lib/securityContext.js"
SESSION_ROUTE_PATH = "story-engine/routes/authSession.js"
EXPECTED_COOKIE = "l99_session"
LEGACY_BROWSER_AUTH_MARKERS = ("l99_api_key", "L99_API_KEY", "x-api-key")


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

    if len(cookies) != 1:
        errors.append("exactly one declared browser cookie is allowed")
    else:
        cookie = cookies[0]
        if not isinstance(cookie, dict):
            errors.append("declared cookie must be an object")
        else:
            if cookie.get("name") != EXPECTED_COOKIE:
                errors.append(f"only {EXPECTED_COOKIE} may be declared")
            if cookie.get("writer") != SESSION_ROUTE_PATH:
                errors.append("session cookie writer must be authSession route")
            if cookie.get("generator") != SERVER_AUTH_PATH:
                errors.append("session cookie generator must be securityContext")
            if cookie.get("httpOnly") is not True:
                errors.append("session cookie must be HttpOnly")
            if cookie.get("sameSite") != "Strict":
                errors.append("session cookie must use SameSite=Strict")
            if cookie.get("secureInProduction") is not True:
                errors.append("session cookie must be Secure in production")

    allowed = {str(path).replace("\\", "/") for path in writers}
    if allowed != {SESSION_ROUTE_PATH}:
        errors.append("only the authSession route may write browser cookies")

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
            if any(pattern.search(source) for pattern in WRITER_PATTERNS) and repo_path not in allowed:
                errors.append(f"undeclared cookie operation detected: {repo_path}")

    browser_auth = (root / BROWSER_AUTH_PATH).read_text(encoding="utf-8", errors="replace")
    if "document.cookie" in browser_auth:
        errors.append(f"browser auth touches document.cookie: {BROWSER_AUTH_PATH}")
    for required in ("sessionStorage", "x-api-key", "/api/auth/session", "clearBootstrapKey"):
        if required not in browser_auth:
            errors.append(f"browser auth missing bootstrap/session marker: {required}")
    if "headers.set('x-api-key'" in browser_auth or 'headers.set("x-api-key"' in browser_auth:
        errors.append("browser auth must not inject API keys into ordinary application fetches")

    # The auth bootstrap client is the only browser asset allowed to know the
    # transitional explicit credential exists. All ordinary presentation code
    # must rely on same-origin HttpOnly session transport.
    public_root = root / PUBLIC_ROOT
    for path in public_root.rglob("*"):
        if not path.is_file() or path.suffix not in {".js", ".html"}:
            continue
        repo_path = path.relative_to(root).as_posix()
        if repo_path == BROWSER_AUTH_PATH:
            continue
        source = path.read_text(encoding="utf-8", errors="replace")
        for marker in LEGACY_BROWSER_AUTH_MARKERS:
            if marker in source:
                errors.append(f"ordinary browser asset contains legacy auth marker {marker}: {repo_path}")

    server_auth = (root / SERVER_AUTH_PATH).read_text(encoding="utf-8", errors="replace")
    for required in (
        "x-api-key",
        "Bearer",
        "requestSessionToken",
        "issueSession",
        "HttpOnly",
        "SameSite=Strict",
        "randomBytes(32).toString('base64url')",
    ):
        if required not in server_auth:
            errors.append(f"server auth missing session marker: {required}")
    for forbidden in ("l99_api_key", "document.cookie"):
        if forbidden in server_auth:
            errors.append(f"server auth contains forbidden legacy cookie path: {forbidden}")

    session_route = (root / SESSION_ROUTE_PATH).read_text(encoding="utf-8", errors="replace")
    for required in ("Set-Cookie", "sessionCookie", "clearSessionCookie", "revokeSession"):
        if required not in session_route:
            errors.append(f"session route missing required marker: {required}")
    if "x-api-key" in session_route or "Bearer" in session_route:
        errors.append("session route must consume resolved identity, not parse bootstrap credentials itself")

    return errors
