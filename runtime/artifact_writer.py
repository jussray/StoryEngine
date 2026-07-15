# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""L99 machine-readable artifact writer.

This module preserves the general `ArtifactWriter` API and the repository's
legacy decision/revocation/incident helpers used by promotion gates,
RiverEditor, Lindymode, and rolling-window telemetry.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any, Iterable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from l99_event_bus import load_events  # noqa: E402

DEFAULT_ARTIFACT_ROOT = os.environ.get("L99_ARTIFACT_ROOT", "/tmp/l99_artifacts")
_TS_FMT = "%Y-%m-%dT%H-%M-%SZ"
ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = ROOT / "artifacts"
PROVENANCE_RULES_PATH = ROOT / "policies" / "provenance_rules.json"
_SAFE_PATH_COMPONENT = re.compile(r"^[A-Za-z0-9_.-]+$")
_rules_cache: dict[str, Any] | None = None


@dataclass
class WriteResult:
    """Returned by :meth:`ArtifactWriter.write`."""

    ref: str
    abs_path: Path
    size_bytes: int
    sha256: str
    written_at: str


class ArtifactWriter:
    """Writes validated, uniquely named artifacts to a configured root."""

    def __init__(
        self,
        root: str | Path = DEFAULT_ARTIFACT_ROOT,
        *,
        pretty: bool = True,
        overwrite: bool = False,
    ) -> None:
        self._root = Path(root).expanduser().resolve()
        self._pretty = pretty
        self._overwrite = overwrite

    def write(
        self,
        kind: str,
        payload: Any,
        *,
        date_prefix: str | None = None,
        suffix: str | None = None,
        raw: bool = False,
    ) -> WriteResult:
        _validate_kind(kind)
        ts = _utc_now()
        date_seg = date_prefix or ts[:10]
        ts_safe = datetime.now(timezone.utc).strftime(_TS_FMT)
        nonce = _short_nonce()
        name_parts = [kind, ts_safe, nonce]
        if suffix:
            name_parts.append(_slugify(suffix))
        ext = ".bin" if raw else ".json"
        filename = "_".join(name_parts) + ext

        rel_dir = Path(kind) / date_seg
        abs_dir = self._root / rel_dir
        abs_dir.mkdir(parents=True, exist_ok=True)
        abs_path = abs_dir / filename
        if abs_path.exists() and not self._overwrite:
            raise FileExistsError(f"Artifact already exists: {abs_path}")

        if raw:
            if not isinstance(payload, (bytes, bytearray)):
                raise TypeError(
                    f"raw=True requires bytes payload, got {type(payload).__name__}"
                )
            data_bytes = bytes(payload)
        else:
            data_bytes = _to_json_bytes(payload, pretty=self._pretty)

        abs_path.write_bytes(data_bytes)
        ref = str(rel_dir / filename)
        return WriteResult(
            ref=ref,
            abs_path=abs_path,
            size_bytes=len(data_bytes),
            sha256=hashlib.sha256(data_bytes).hexdigest(),
            written_at=ts,
        )

    def exists(self, ref: str) -> bool:
        return (self._root / ref).exists()

    def read_json(self, ref: str) -> Any:
        path = self._root / ref
        if not path.exists():
            raise FileNotFoundError(f"Artifact not found: {ref}")
        return json.loads(path.read_bytes())

    def delete(self, ref: str) -> bool:
        path = self._root / ref
        if path.exists():
            path.unlink()
            return True
        return False

    @property
    def root(self) -> Path:
        return self._root


def _validate_kind(kind: str) -> None:
    if not kind or not kind.replace("_", "").replace("-", "").isalnum():
        raise ValueError(
            "Artifact kind must be alphanumeric (underscores/hyphens ok), "
            f"got: {kind!r}"
        )


def _utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def _short_nonce(length: int = 6) -> str:
    import secrets

    return secrets.token_hex(length // 2 + 1)[:length]


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40]


def _to_json_bytes(obj: Any, *, pretty: bool) -> bytes:
    indent = 2 if pretty else None
    return json.dumps(
        obj,
        indent=indent,
        ensure_ascii=False,
        default=str,
    ).encode()


def _sanitize_path_component(value: str, label: str) -> str:
    """Reject path traversal and multi-component artifact identifiers."""
    if (
        value in {".", ".."}
        or "/" in value
        or "\\" in value
        or not _SAFE_PATH_COMPONENT.match(value)
    ):
        raise ValueError(f"unsafe {label}: {value!r}")
    return value


def write_artifact(
    category: str,
    artifact_id: str,
    payload: dict[str, Any],
    artifacts_dir: str | Path = ARTIFACTS_DIR,
) -> str:
    """Write one stable-id JSON artifact and return its reference."""
    category = _sanitize_path_component(category, "category")
    artifact_id = _sanitize_path_component(artifact_id, "artifact_id")
    directory = Path(artifacts_dir) / category
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{artifact_id}.json"
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_provenance_rules(
    path: str | Path = PROVENANCE_RULES_PATH,
) -> dict[str, Any]:
    global _rules_cache
    if _rules_cache is None:
        with Path(path).open("r", encoding="utf-8") as handle:
            _rules_cache = json.load(handle)
    return _rules_cache


def evaluate_decision(
    *,
    producer_tenant_id: str,
    consumer_tenant_id: str,
    producer_user_scope: str,
    consumer_user_scope: str,
    producer_authorization_scope: Iterable[str],
    consumer_authorization_scope: Iterable[str],
    provenance_domain_match: bool,
    producer_revocation_epoch: int,
    consumer_revocation_epoch: int,
    ttl_valid: bool,
    integrity_valid: bool,
    confidence_score: float | None = None,
    confidence_threshold: float = 0.0,
    rules: dict[str, Any] | None = None,
) -> tuple[str, str, bool, bool]:
    rules = rules or load_provenance_rules()
    if not rules.get("decision_order"):
        raise ValueError("provenance decision_order is missing")

    if producer_tenant_id != consumer_tenant_id:
        return "block", "tenant_mismatch", False, True
    if producer_user_scope != consumer_user_scope:
        return "block", "user_scope_mismatch", False, True
    if set(producer_authorization_scope) != set(consumer_authorization_scope):
        return "block", "authorization_scope_mismatch", False, True
    if not provenance_domain_match:
        return "block", "provenance_domain_mismatch", False, True
    if consumer_revocation_epoch > producer_revocation_epoch:
        return "block", "stale_after_revocation", False, True
    if not ttl_valid:
        return "miss", "ttl_expired", False, False
    if not integrity_valid:
        return "block", "integrity_hash_mismatch", False, False
    if confidence_score is not None and confidence_score < confidence_threshold:
        return "miss", "low_confidence", False, False
    return "allow", "structural_checks_passed", True, False


def build_decision_artifact(
    *,
    request_id: str | None = None,
    candidate_entry_id: str,
    producer_tenant_id: str,
    consumer_tenant_id: str,
    producer_user_scope: str,
    consumer_user_scope: str,
    producer_authorization_scope: Iterable[str],
    consumer_authorization_scope: Iterable[str],
    provenance_domain: str,
    provenance_domain_match: bool = True,
    producer_revocation_epoch: int,
    consumer_revocation_epoch: int,
    ttl_valid: bool = True,
    integrity_valid: bool = True,
    confidence_score: float | None = None,
    confidence_threshold: float = 0.0,
    artifacts_dir: str | Path = ARTIFACTS_DIR,
) -> dict[str, Any]:
    request_id = request_id or f"req_{uuid4().hex}"
    action, reason_code, similarity_evaluated, incident_required = evaluate_decision(
        producer_tenant_id=producer_tenant_id,
        consumer_tenant_id=consumer_tenant_id,
        producer_user_scope=producer_user_scope,
        consumer_user_scope=consumer_user_scope,
        producer_authorization_scope=producer_authorization_scope,
        consumer_authorization_scope=consumer_authorization_scope,
        provenance_domain_match=provenance_domain_match,
        producer_revocation_epoch=producer_revocation_epoch,
        consumer_revocation_epoch=consumer_revocation_epoch,
        ttl_valid=ttl_valid,
        integrity_valid=integrity_valid,
        confidence_score=confidence_score,
        confidence_threshold=confidence_threshold,
    )
    artifact = {
        "request_id": request_id,
        "candidate_entry_id": candidate_entry_id,
        "producer_tenant_id": producer_tenant_id,
        "consumer_tenant_id": consumer_tenant_id,
        "producer_user_scope": producer_user_scope,
        "consumer_user_scope": consumer_user_scope,
        "producer_authorization_scope": sorted(producer_authorization_scope),
        "consumer_authorization_scope": sorted(consumer_authorization_scope),
        "provenance_domain": provenance_domain,
        "revocation_epoch": consumer_revocation_epoch,
        "ttl_decision": "valid" if ttl_valid else "expired",
        "integrity_decision": "valid" if integrity_valid else "mismatch",
        "final_action": action,
        "reason_code": reason_code,
        "semantic_similarity_evaluated": similarity_evaluated,
        "incident_required": incident_required,
        "created_at": datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }
    write_artifact("decisions", request_id, artifact, artifacts_dir)
    return artifact


def build_revocation_artifact(
    *,
    event_id: str | None = None,
    reason: str,
    tenant_id: str,
    user_scope: str,
    authorization_scope: Iterable[str],
    namespace: str,
    previous_revocation_epoch: int,
    new_revocation_epoch: int,
    affected_partitions: Iterable[str],
    invalidation_action: str,
    promotion_blocked: bool = True,
    artifacts_dir: str | Path = ARTIFACTS_DIR,
) -> dict[str, Any]:
    event_id = event_id or f"rev_{uuid4().hex}"
    artifact = {
        "event_id": event_id,
        "reason": reason,
        "tenant_id": tenant_id,
        "user_scope": user_scope,
        "authorization_scope": sorted(authorization_scope),
        "namespace": namespace,
        "previous_revocation_epoch": previous_revocation_epoch,
        "new_revocation_epoch": new_revocation_epoch,
        "affected_partitions": sorted(affected_partitions),
        "invalidation_action": invalidation_action,
        "promotion_blocked": promotion_blocked,
        "created_at": datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }
    write_artifact("revocations", event_id, artifact, artifacts_dir)
    return artifact


CRITICAL_EVENT_TYPES = {"poisoning.suspected", "containment.started"}


def _is_critical(event: dict[str, Any]) -> bool:
    return (
        event.get("severity") == "sev3"
        or event.get("status") in {"blocked", "failed"}
        or event.get("event_type") in CRITICAL_EVENT_TYPES
    )


def build_incident_artifact(
    correlation_id: str,
    events: Iterable[dict[str, Any]],
    artifacts_dir: str | Path = ARTIFACTS_DIR,
) -> dict[str, Any]:
    correlation_id = _sanitize_path_component(correlation_id, "correlation_id")
    chain = sorted(
        (
            event
            for event in events
            if event.get("correlation_id") == correlation_id
        ),
        key=lambda event: event.get("timestamp_utc", ""),
    )
    critical_count = sum(1 for event in chain if _is_critical(event))
    artifact = {
        "correlation_id": correlation_id,
        "event_count": len(chain),
        "critical_event_count": critical_count,
        "is_critical": critical_count > 0,
        "tenant_ids": sorted(
            {
                event.get("tenant_id")
                for event in chain
                if event.get("tenant_id")
            }
        ),
        "first_event_at": chain[0].get("timestamp_utc") if chain else None,
        "last_event_at": chain[-1].get("timestamp_utc") if chain else None,
        "chain": [
            {
                "event_id": event.get("event_id"),
                "parent_event_id": event.get("parent_event_id"),
                "event_type": event.get("event_type"),
                "timestamp_utc": event.get("timestamp_utc"),
                "severity": event.get("severity"),
                "status": event.get("status"),
                "reason": event.get("reason"),
                "is_critical": _is_critical(event),
            }
            for event in chain
        ],
    }
    write_artifact("incidents", correlation_id, artifact, artifacts_dir)
    return artifact


def build_incident_artifact_from_feed(
    correlation_id: str,
    feed_path: str | Path,
    artifacts_dir: str | Path = ARTIFACTS_DIR,
) -> dict[str, Any]:
    return build_incident_artifact(
        correlation_id,
        load_events(feed_path),
        artifacts_dir,
    )
