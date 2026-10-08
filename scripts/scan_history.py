#!/usr/bin/env python3
"""scan_history.py — committed-secret scan across a repository's FULL git history.

Scans every blob reachable from every local ref (all branches, tags, and any
fetched PR refs), including files that were later deleted. Findings are printed
REDACTED; full secret values are never written anywhere.

Portable by design: Python 3.9+ standard library and the `git` CLI only. No
network access, no third-party packages, no AI- or vendor-specific tooling.

Usage
  python3 scripts/scan_history.py [REPO]            scan (REPO defaults to .)
  python3 scripts/scan_history.py --self-test       prove the scanner on a canary repo
  options: --allow FILE    allowlist of reviewed fingerprints (default: REPO/.secret-scan-allow)
           --receipt FILE  write a JSON receipt (redacted findings + fingerprints)

Exit codes
  0  no unallowed BLOCK findings (REVIEW findings are reported, never fatal)
  1  at least one unallowed BLOCK finding
  2  usage or git error

Allowlist (.secret-scan-allow)
  One fingerprint per line, a reason is required after `#`:
    fp:0123456789abcdef  # public Stripe publishable key, not a secret
  A fingerprint is a truncated SHA-256 of (rule, value). It identifies a finding
  without revealing the value. Never allowlist a live credential: rotate it.

Note: removing a secret from history does not un-leak it. Any real BLOCK hit
means rotate the credential first, then decide whether history rewrite is worth it.
"""
import argparse, hashlib, json, math, os, re, subprocess, sys, tempfile
from collections import defaultdict

VERSION = "1.2.0"
MAX_BLOB = 3_000_000

# BLOCK: high-confidence credential formats. REVIEW: plausible, often public-by-design or noisy.
RULES = {
    "stripe_live_secret":   ("BLOCK",  r"\b(?:sk|rk)_live_[0-9A-Za-z]{20,}"),
    "stripe_test_secret":   ("BLOCK",  r"\b(?:sk|rk)_test_[0-9A-Za-z]{20,}"),
    "stripe_webhook":       ("BLOCK",  r"\bwhsec_[0-9A-Za-z]{24,}"),
    "shopify_token":        ("BLOCK",  r"\bshp(?:at|ss|ca|pa)_[0-9a-fA-F]{32}\b"),
    "github_token":         ("BLOCK",  r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})"),
    "aws_access_key":       ("BLOCK",  r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "private_key_block":    ("BLOCK",  r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY"),
    "slack_token":          ("BLOCK",  r"\bxox[abprs]-[0-9A-Za-z-]{10,}"),
    "openai_key":           ("BLOCK",  r"\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{40,}"),
    "anthropic_key":        ("BLOCK",  r"\bsk-ant-[A-Za-z0-9_-]{30,}"),
    "sendgrid_key":         ("BLOCK",  r"\bSG\.[\w-]{22}\.[\w-]{43}\b"),
    "twilio_api_key":       ("BLOCK",  r"\bSK[0-9a-f]{32}\b"),
    "resend_key":           ("BLOCK",  r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}"),
    "cloudflare_token_assignment": ("BLOCK", r"(?i)\bCLOUDFLARE_(?:API_TOKEN|API_KEY|GLOBAL_API_KEY)\b\s*[:=]\s*['\"]?[A-Za-z0-9_-]{37,}"),
    "db_url_with_password": ("BLOCK",  r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?)://[^\s:/@'\"]+:[^\s@'\"$<{]{6,}@(?P<host>[^\s/:'\"?]+)"),
    "jwt":                  ("REVIEW", r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}"),
    "google_api_key":       ("REVIEW", r"\bAIza[0-9A-Za-z_-]{35}\b"),
}
GENERIC = re.compile(r"(?i)\b([A-Za-z0-9_]*(?:secret|token|api[_-]?key|password|passwd|private[_-]?key)[A-Za-z0-9_]*)\s*[:=]\s*['\"]([^'\"\s]{20,})['\"]")
PLACEHOLDER = re.compile(r"(?i)example|placeholder|dummy|fake|redact|xxxx|your[_-]|changeme|<[^>]*>|\$\{|process\.env|env\.|secrets\.|test|mock|sample|0000|1234|abcd|stub|fixture|not[-_]a")
SENSITIVE_PATH = re.compile(r"(?i)(?:^|/)(?:\.env(?:\.[^/]*)?|\.dev\.vars(?:\.[^/]*)?|id_[rd]sa|id_ed25519|[^/]*\.pem|[^/]*\.p12|[^/]*\.pfx|[^/]*\.keystore|credentials\.json|service[-_]account[^/]*\.json|\.netrc)$")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal", "db", "postgres", "mysql", "redis", "mongo"}
# Prefixes whose values are bundled into client code by the framework, i.e. public by construction.
PUBLIC_ENV_KEY = re.compile(r"^(?:EXPO_PUBLIC_|NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_|GATSBY_)")
SAFE_SUFFIX = re.compile(r"(?i)\.(?:example|sample|template|dist|defaults?)$")
COMPILED = {name: (sev, re.compile(rx)) for name, (sev, rx) in RULES.items()}


def die(msg):
    """Usage/config error: exit 2 so callers can tell it apart from a BLOCK finding (exit 1)."""
    print(f"scan_history: {msg}", file=sys.stderr)
    raise SystemExit(2)


def git(repo, *args):
    # Argument-vector exec (no shell). `repo` is an operator-chosen local path validated by
    # cli_dir(); args are fixed git subcommands. No shell interpolation is possible.
    # bearer:disable python_lang_os_command_injection
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True).stdout


def cli_dir(path):
    """Resolve an operator-supplied repository path; it must be an existing local directory."""
    resolved = os.path.realpath(path)
    if not os.path.isdir(resolved):
        die(f"repository path is not a directory: {path}")
    return resolved


def cli_output(path):
    """Resolve an operator-supplied output path; its parent directory must already exist."""
    resolved = os.path.realpath(path)
    if not os.path.isdir(os.path.dirname(resolved)):
        die(f"receipt directory does not exist: {path}")
    return resolved


def entropy(s):
    counts = defaultdict(int)
    for ch in s:
        counts[ch] += 1
    return -sum(n / len(s) * math.log2(n / len(s)) for n in counts.values())


SECRET_JWT_ROLES = {"service_role", "supabase_admin"}


def jwt_role(token):
    """Return the `role` claim of a JWT payload (claims are not secret), or None."""
    import base64
    try:
        part = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return claims.get("role") if isinstance(claims, dict) else None
    except (IndexError, ValueError):
        return None


def redact(s):
    return s if len(s) <= 10 else f"{s[:6]}…{s[-4:]} (len {len(s)})"


def fingerprint(rule, value):
    return "fp:" + hashlib.sha256(f"{rule}\0{value}".encode()).hexdigest()[:16]


def load_allow(path):
    allowed = {}
    if path and os.path.isfile(path):
        # Read-only open of the repository's own allowlist file (operator-chosen local path).
        # bearer:disable python_lang_path_traversal
        for raw in open(path, encoding="utf-8"):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            fp, _, reason = line.partition("#")
            fp, reason = fp.strip(), reason.strip()
            if not re.fullmatch(r"fp:[0-9a-f]{16}", fp) or not reason:
                die(f"invalid allowlist line (need 'fp:<16 hex>  # reason'): {line}")
            allowed[fp] = reason
    return allowed


def env_file_severity(path, data):
    """A committed env file is BLOCK unless every assignment is a framework client-public key
    (bundled into shipped client code anyway). Key files/certs are always BLOCK."""
    if data is None or not re.search(r"(?i)(?:^|/)\.(?:env|dev\.vars)", path):
        return "BLOCK"
    keys = [l.split("=", 1)[0].strip().removeprefix("export ").strip()
            for l in data.decode(errors="replace").splitlines() if "=" in l and not l.lstrip().startswith("#")]
    return "REVIEW" if keys and all(PUBLIC_ENV_KEY.match(k) for k in keys) else "BLOCK"


def scan(repo, allow_path=None):
    allowed = load_allow(allow_path)
    paths = defaultdict(set)
    for line in git(repo, "rev-list", "--all", "--objects").decode(errors="replace").splitlines():
        sha, _, p = line.partition(" ")
        if p:
            paths[sha].add(p)
    findings, seen, blobs, scanned, skipped = [], set(), 0, 0, []

    def add(sev, rule, value, sha, path, line_no, key=None):
        # `key` overrides what the fingerprint hashes: blob-bound for committed files (each
        # version is judged and allowlisted on its own content) and for DB URLs (no offline
        # guessing oracle for weak passwords).
        fp = fingerprint(rule, value if key is None else key)
        if fp in seen:
            return
        seen.add(fp)
        findings.append({"severity": sev, "rule": rule, "redacted": redact(value), "fingerprint": fp,
                         "blob": sha[:12], "path": path, "line": line_no,
                         "allowed": fp in allowed, "allowReason": allowed.get(fp)})

    # Argument-vector exec (no shell) of `git cat-file --batch` against the validated repo path.
    # bearer:disable python_lang_os_command_injection
    batch = subprocess.Popen(["git", "-C", repo, "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    for sha, ps in paths.items():
        path = sorted(ps)[0]
        batch.stdin.write(sha.encode() + b"\n")
        batch.stdin.flush()
        header = batch.stdout.readline().split()
        if len(header) < 3:
            continue
        typ, size = header[1], int(header[2])
        data = batch.stdout.read(size)
        batch.stdout.read(1)
        if typ != b"blob":
            continue
        blobs += 1
        binary = size > MAX_BLOB or b"\0" in data[:8000]
        for p in ps:
            if SENSITIVE_PATH.search(p) and not SAFE_SUFFIX.search(p):
                add(env_file_severity(p, None if binary else data), "sensitive_file_committed", p, sha, p, 0,
                    key=f"{p}@{sha}")
        if binary:
            skipped.append({"path": path, "blob": sha[:12], "bytes": size,
                            "reason": "over size limit" if size > MAX_BLOB else "binary or UTF-16"})
            continue
        scanned += 1
        text = data.decode(errors="replace")
        for rule, (sev, rx) in COMPILED.items():
            for m in rx.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                if "host" in rx.groupindex:
                    if (m.group("host") or "").lower() in LOCAL_HOSTS:
                        continue  # local-development database default, not a deployable credential
                    add(sev, rule, m.group(0), sha, path, line_no, key=f"{sha}:{line_no}")
                elif rule == "jwt" and jwt_role(m.group(0)) in SECRET_JWT_ROLES:
                    add("BLOCK", "supabase_service_role_jwt", m.group(0), sha, path, line_no)
                else:
                    add(sev, rule, m.group(0), sha, path, line_no)
        for m in GENERIC.finditer(text):
            value = m.group(2)
            if PLACEHOLDER.search(value) or entropy(value) < 3.5:
                continue
            add("REVIEW", f"generic:{m.group(1)}", value, sha, path, text.count("\n", 0, m.start()) + 1)
    batch.stdin.close()
    if batch.wait() != 0:
        die(f"git cat-file exited {batch.returncode}; object store unreadable")
    return {"blobs": blobs, "textBlobsScanned": scanned, "skipped": skipped, "findings": findings,
            "allowlistEntries": len(allowed)}


def head_identity(repo):
    def safe(*a):
        try:
            return git(repo, *a).decode().strip()
        except subprocess.CalledProcessError:
            return None
    return {"head": safe("rev-parse", "HEAD"), "refs": len((safe("for-each-ref", "--format=%(refname)") or "").splitlines()),
            "commits": int(safe("rev-list", "--all", "--count") or 0)}


def receipt(repo, result, verdict):
    tool_hash = hashlib.sha256(open(os.path.abspath(__file__), "rb").read()).hexdigest()
    ident = head_identity(repo)
    body = {"tool": "scan_history.py", "version": VERSION, "repository": os.environ.get("GITHUB_REPOSITORY") or os.path.abspath(repo),
            **ident, **result, "verdict": verdict,
            "proofCookie": "sha256:" + tool_hash,
            "note": "Values are redacted; fingerprints identify findings without revealing them. A green scan is evidence about committed history only, not about secrets stored elsewhere."}
    body["fingerprint"] = "sha256:" + hashlib.sha256(json.dumps(
        {k: body[k] for k in ("repository", "head", "refs", "commits", "verdict", "proofCookie")}, sort_keys=True).encode()).hexdigest()
    return body


def report(repo, result):
    blocking = [f for f in result["findings"] if f["severity"] == "BLOCK" and not f["allowed"]]
    print(f"scan_history {VERSION}: blobs={result['blobs']} text_scanned={result['textBlobsScanned']} "
          f"findings={len(result['findings'])} blocking={len(blocking)} allowlisted={sum(f['allowed'] for f in result['findings'])}")
    if result["skipped"]:
        print(f"  NOT SCANNED {len(result['skipped'])} blob(s) (binary, UTF-16 or over {MAX_BLOB} bytes):")
        for sk in result["skipped"][:20]:
            print(f"    {sk['path']} ({sk['bytes']} bytes, {sk['reason']}, blob {sk['blob']})")
    for f in sorted(result["findings"], key=lambda f: (f["severity"] != "BLOCK", f["rule"], f["path"])):
        tag = "ALLOWED" if f["allowed"] else f["severity"]
        print(f"  {tag:7} {f['rule']:28} {f['redacted']:30} {f['fingerprint']}  {f['path']}:{f['line']} (blob {f['blob']})")
    return "BLOCKED" if blocking else "CLEAN"


def self_test():
    import secrets as rnd
    alnum = lambda n: "".join(rnd.choice("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789") for _ in range(n))
    with tempfile.TemporaryDirectory() as tmp:
        run = lambda *a: subprocess.run(["git", "-C", tmp, *a], check=True, capture_output=True)
        run("init", "-q")
        run("config", "user.email", "canary@example.invalid")
        run("config", "user.name", "canary")
        planted = {
            "stripe_live_secret": "sk_" + "live_" + alnum(28),
            "shopify_token": "shp" + "at_" + rnd.token_hex(16),
            "github_token": "gh" + "p_" + alnum(36),
            "aws_access_key": "AK" + "IA" + "".join(rnd.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567") for _ in range(16)),
            "cloudflare_token_assignment": "CLOUDFLARE_" + "API_TOKEN=" + alnum(40),
        }
        with open(os.path.join(tmp, "config.js"), "w") as fh:
            fh.write("\n".join(planted.values()) + "\n")
        with open(os.path.join(tmp, ".env"), "w") as fh:
            fh.write("X=1\n")
        with open(os.path.join(tmp, ".env.example"), "w") as fh:
            fh.write("STRIPE_SECRET_KEY=your_key_here\n")
        with open(os.path.join(tmp, "safe.js"), "w") as fh:
            fh.write('const apiToken = "placeholder-token-value-here";\nconst x = process.env.SECRET_TOKEN;\n'
                     "const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';\n")
        os.makedirs(os.path.join(tmp, "app"))
        with open(os.path.join(tmp, "app", ".env.production"), "w") as fh:
            fh.write("EXPO_PUBLIC_SUPABASE_URL=https://example.invalid\nEXPO_PUBLIC_PUBLISHABLE_KEY=" + alnum(30) + "\n")
        remote_db = "postgres://admin:" + alnum(18) + "@db.prod.example.invalid:5432/app"
        with open(os.path.join(tmp, "deploy.sh"), "w") as fh:
            fh.write(f"DATABASE_URL='{remote_db}'\n")
        planted["db_url_with_password"] = remote_db
        run("add", "-A")
        run("commit", "-qm", "plant")
        run("rm", "-q", "config.js", ".env")
        run("commit", "-qm", "delete planted secrets (must still be found in history)")
        # An OLDER version of an env file holds a server secret; the newest version is public-only.
        b64 = lambda o: __import__("base64").urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
        service_jwt = b64({"alg": "HS256", "typ": "JWT"}) + "." + b64({"iss": "supabase", "role": "service_role"}) + "." + alnum(43)
        with open(os.path.join(tmp, "app", ".env.local"), "w") as fh:
            fh.write(f"SUPABASE_SERVICE_ROLE_KEY={service_jwt}\n")
        run("add", "-A")
        run("commit", "-qm", "server secret in env file")
        with open(os.path.join(tmp, "app", ".env.local"), "w") as fh:
            fh.write("EXPO_PUBLIC_URL=https://example.invalid\n")
        run("commit", "-qam", "env file now public-only")
        planted["supabase_service_role_jwt"] = service_jwt
        # A secret that exists ONLY on a side branch must still be found.
        run("checkout", "-qb", "side")
        side_secret = "xox" + "b-" + "-".join(alnum(12) for _ in range(3))
        with open(os.path.join(tmp, "side.txt"), "w") as fh:
            fh.write(side_secret + "\n")
        run("add", "-A")
        run("commit", "-qm", "side-branch only")
        run("checkout", "-q", "-")
        planted["slack_token"] = side_secret
        result = scan(tmp)
        found = {f["rule"] for f in result["findings"]}
        failures = [f"missed {r}" for r in planted if r not in found]
        if "sensitive_file_committed" not in found:
            failures.append("missed committed .env")
        bad = [f for f in result["findings"] if f["path"] in (".env.example", "safe.js")]
        failures += [f"false positive {f['rule']} in {f['path']}" for f in bad]
        sev = {f["path"]: f["severity"] for f in result["findings"] if f["rule"] == "sensitive_file_committed"}
        if sev.get(".env") != "BLOCK":
            failures.append("non-public .env not BLOCK")
        if sev.get("app/.env.production") != "REVIEW":
            failures.append("client-public-only .env.production not downgraded to REVIEW")
        env_local = [f["severity"] for f in result["findings"]
                     if f["rule"] == "sensitive_file_committed" and f["path"] == "app/.env.local"]
        if sorted(env_local) != ["BLOCK", "REVIEW"]:
            failures.append(f"each .env.local version must be judged on its own content, got {env_local}")
        # Exit-code contract through main(): dirty history -> 1, clean history -> 0, bad path -> 2.
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()):
            if main([tmp]) != 1:
                failures.append("main() did not exit 1 on BLOCK findings")
            with tempfile.TemporaryDirectory() as clean:
                subprocess.run(["git", "-C", clean, "init", "-q"], check=True)
                with open(os.path.join(clean, "README.md"), "w") as fh:
                    fh.write("nothing secret\n")
                subprocess.run(["git", "-C", clean, "add", "-A"], check=True)
                subprocess.run(["git", "-C", clean, "-c", "user.email=c@example.invalid", "-c", "user.name=c",
                                "commit", "-qm", "clean"], check=True)
                if main([clean]) != 0:
                    failures.append("main() did not exit 0 on a clean history")
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                main([os.path.join(tmp, "does-not-exist")])
                failures.append("main() accepted a missing repository path")
            except SystemExit as e:
                if e.code != 2:
                    failures.append(f"usage error exited {e.code}, expected 2")
        leaked = [f for f in result["findings"] if any(v in f["redacted"] for v in planted.values())]
        failures += ["unredacted value in output"] if leaked else []
        # allowlist suppresses exactly the listed fingerprint
        target = next(f for f in result["findings"] if f["rule"] == "aws_access_key")
        allow = os.path.join(tmp, ".secret-scan-allow")
        with open(allow, "w") as fh:
            fh.write(f"{target['fingerprint']}  # self-test allowlist entry\n")
        allowed_result = scan(tmp, allow)
        states = {f["rule"]: f["allowed"] for f in allowed_result["findings"]}
        if not states.get("aws_access_key") or states.get("stripe_live_secret"):
            failures.append("allowlist did not suppress exactly one fingerprint")
    if failures:
        print("scan_history self-test FAILED: " + "; ".join(failures))
        return 1
    print(f"scan_history self-test PASSED: {len(planted)} planted secrets (incl. side-branch-only and service-role JWT) "
          "+ committed .env found in deleted history; each env-file version judged on its own content; "
          "no false positives on .env.example/placeholders/local DB URL; client-public env downgraded to REVIEW; "
          "output redacted; allowlist scoped to one fingerprint; exit codes 1/0/2 via main()")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("repo", nargs="?", default=".")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--allow")
    ap.add_argument("--receipt")
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    repo = cli_dir(a.repo)
    try:
        git(repo, "rev-parse", "--git-dir")
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"scan_history: not a git repository or git missing: {a.repo} ({e})", file=sys.stderr)
        return 2
    # Allowlist/receipt paths are operator-chosen local CLI arguments, resolved by cli_*().
    # bearer:disable python_lang_path_traversal
    allow = os.path.realpath(a.allow) if a.allow is not None else os.path.join(repo, ".secret-scan-allow")
    # bearer:disable python_lang_path_traversal
    try:
        result = scan(repo, allow)
    except (subprocess.CalledProcessError, UnicodeDecodeError, OSError) as e:
        die(f"scan failed (git/IO/encoding error, not a finding): {e}")
    verdict = report(repo, result)
    if a.receipt:
        out = cli_output(a.receipt)
        # bearer:disable python_lang_path_traversal
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(receipt(repo, result, verdict), fh, indent=2)
    print(f"verdict: {verdict}")
    return 1 if verdict == "BLOCKED" else 0


if __name__ == "__main__":
    sys.exit(main())
