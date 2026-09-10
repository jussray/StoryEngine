#!/usr/bin/env python3
"""Validate the repository-scoped MCP configuration without third-party dependencies."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = ["context7", "github", "playwright", "supabase"]
TOOLSETS = "repos,issues,pull_requests,actions,code_security,secret_protection"
PLAYWRIGHT = "@playwright/mcp@0.0.78"
STORYENGINE_PROJECT_REF = "tarnmxcjpvaxapnjnesf"
EXAMPLE_PROJECT_REF = "YOUR_STORYENGINE_PROJECT_REF"


def fail(message: str) -> None:
    raise SystemExit(f"[verify:mcp] {message}")


def load(relative: str) -> dict:
    try:
        return json.loads((ROOT / relative).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{relative} is missing or invalid JSON: {exc}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def validate_supabase(relative: str, server: dict, expected_project_ref: str) -> None:
    require(server.get("type") == "http", f"{relative}:supabase must use HTTP")
    parsed = urlparse(server.get("url", ""))
    require(parsed.scheme == "https" and parsed.netloc == "mcp.supabase.com", f"{relative}:supabase host drifted")
    require(parsed.path == "/mcp", f"{relative}:supabase path drifted")
    query = parse_qs(parsed.query, keep_blank_values=True)
    require(query.get("project_ref") == [expected_project_ref], f"{relative}:supabase project_ref drifted")
    require(query.get("read_only") == ["true"], f"{relative}:supabase must remain read-only")
    require(query.get("features") == ["database,docs"], f"{relative}:supabase features must stay bounded to database,docs")
    require("Authorization" not in server.get("headers", {}), f"{relative}:do not commit Supabase authorization headers")


def validate(relative: str, servers: dict, expected_project_ref: str, require_stdio: bool = False) -> None:
    require(sorted(servers) == EXPECTED, f"{relative} must contain exactly: {', '.join(EXPECTED)}")

    github = servers.get("github", {})
    require(github.get("type") == "http", f"{relative}:github must use HTTP")
    require(github.get("url") == "https://api.githubcopilot.com/mcp/", f"{relative}:github URL drifted")
    headers = github.get("headers", {})
    require(headers.get("X-MCP-Toolsets") == TOOLSETS, f"{relative}:github toolsets drifted")
    require(headers.get("X-MCP-Lockdown") == "true", f"{relative}:github lockdown must remain enabled while public")
    require("Authorization" not in headers, f"{relative}:do not commit GitHub authorization headers")
    require(headers.get("X-MCP-Insiders") != "true", f"{relative}:GitHub Insiders is private opt-in only")

    context7 = servers.get("context7", {})
    require(context7.get("type") == "http", f"{relative}:context7 must use HTTP")
    require(context7.get("url") == "https://mcp.context7.com/mcp", f"{relative}:context7 URL drifted")

    playwright = servers.get("playwright", {})
    if require_stdio:
        require(playwright.get("type") == "stdio", f"{relative}:playwright must use stdio")
    require(playwright.get("command") == "npx", f"{relative}:playwright command must be npx")
    args = playwright.get("args", [])
    require(PLAYWRIGHT in args, f"{relative}:playwright must stay pinned to {PLAYWRIGHT}")
    require(not any("@latest" in str(arg) for arg in args), f"{relative}:MCP packages cannot use @latest")
    require("--isolated" in args, f"{relative}:playwright must use an isolated profile")

    validate_supabase(relative, servers.get("supabase", {}), expected_project_ref)

    for forbidden in ("dbhub", "netdata-cloud", "cloudflare-builds", "cloudflare-observability"):
        require(forbidden not in servers, f"{relative}:{forbidden} is not justified in the current L99 runtime boundary")


def no_secrets(relative: str, parsed: dict) -> None:
    value = json.dumps(parsed)
    patterns = (
        r"github_pat_",
        r"ghp_[A-Za-z0-9]{20,}",
        r"Bearer\s+[A-Za-z0-9._-]{12,}",
        r"DATABASE_URL",
        r"CLOUDFLARE_API_TOKEN",
        r"SUPABASE_SERVICE_ROLE_KEY",
    )
    for pattern in patterns:
        require(re.search(pattern, value, re.IGNORECASE) is None, f"{relative} appears to contain a committed credential")


project = load(".mcp.json")
example = load(".mcp.example.json")
vscode = load(".vscode/mcp.json")
validate(".mcp.json", project.get("mcpServers", {}), STORYENGINE_PROJECT_REF)
validate(".mcp.example.json", example.get("mcpServers", {}), EXAMPLE_PROJECT_REF)
validate(".vscode/mcp.json", vscode.get("servers", {}), STORYENGINE_PROJECT_REF, require_stdio=True)
no_secrets(".mcp.json", project)
no_secrets(".mcp.example.json", example)
no_secrets(".vscode/mcp.json", vscode)
print("[verify:mcp] StoryEngine MCP configuration is project-scoped, read-only, pinned, and credential-free.")
