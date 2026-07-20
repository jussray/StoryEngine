#!/usr/bin/env python3
"""Dependency-free verifier for L99's zero-cookie authority boundary."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / ".control-room/cookie-policy.json").read_text(encoding="utf-8"))
ERRORS: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        ERRORS.append(message)


require(POLICY.get("repository") == "jussray/l99-StoryEngine", "repository mismatch")
require(POLICY.get("firstPartyCookies") == [], "first-party cookie count must remain zero")
require(POLICY.get("platformManagedCookies") == [], "platform cookie count must remain zero")

PATTERNS = {
    "document.cookie": re.compile(r"\bdocument\.cookie\b"),
    "Cookie Store API": re.compile(r"\bcookieStore\b"),
    "Set-Cookie": re.compile(r"['\"`]Set-Cookie['\"`]", re.IGNORECASE),
}
ROOTS = ["runtime", "dashboards", "story-engine"]
EXTENSIONS = {".py", ".html", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}

for directory_name in ROOTS:
    directory = ROOT / directory_name
    if not directory.exists():
        continue
    for path in directory.rglob("*"):
        if not path.is_file() or path.suffix not in EXTENSIONS:
            continue
        if path.resolve() == Path(__file__).resolve():
            continue
        source = path.read_text(encoding="utf-8", errors="replace")
        for label, pattern in PATTERNS.items():
            if pattern.search(source):
                ERRORS.append(f"{path.relative_to(ROOT)}: forbidden {label}")

if ERRORS:
    print("L99 cookie contract failed:")
    for error in ERRORS:
        print(f"- {error}")
    raise SystemExit(1)

print("L99 cookie contract verified.")
print("Cookies: 0")
print("Operational authority: event/provenance/promotion system")
