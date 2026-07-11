"""L99 machine-readable artifact writer.

Events on the shared event bus reference an `artifact_ref` path (e.g.
`artifacts/revocation_0001.json`), but until now nothing in code actually wrote
those files. This module is the single place that formats and persists
decision, revocation, incident, Lindymode, and shell artifacts under
`artifacts/<category>/<artifact_id>.json`.

`build_decision_artifact` applies `policies/provenance_rules.json`'s decision
order and required matches to produce an auditable decision record matching
the contract in `docs/provenance_engine.md`. It only formats and validates a
decision from explicit inputs — it does not implement live cache-candidate
evaluation (that is the still-unbuilt Provenance Engine itself).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any, Iterable
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent))
from l99_event_bus import load_events  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS_DIR = ROOT / "artifacts"
PROVENANCE_RULES_PATH = ROOT / "policies" / "provenance_rules.json"

_rules_cache: dict[str, Any] | None = None


def load_provenance_rules(path: str | Path = PROVENANCE_RULES_PATH) -> dict[str, Any]:
    global _rules_cache
    if _rules_cache is None:
        with Path(path).open("r", encoding="utf-8") as handle:
            _rules_cache = json.load(handle)
    return _rules_cache


_SAFE_PATH_COMPONENT = re.compile(r"^[A-Za-z0-9_.-]+$")


def _sanitize_path_component(value: str, label: str) -> str:
    """Reject anything that isn't a safe single filesystem path component.

    `artifact_id` (and, defensively, `category`) can originate from
    attacker-influenced input — e.g. `:open episode <correlation_id>` feeds
    a shell argument straight into `build_incident_artifact`'s artifact_id.
    Without this check, a value like `../../policies/provenance_rules`
    would escape `artifacts/<category>/` entirely.
    """
    if value in {".", ".."} or "/" in value or "\\" in value or not _SAFE_PATH_COMPONENT.match(value):
        raise ValueError(f"unsafe {label}: {value!r}")
    return value


def write_artifact(category: str, artifact_id: str, payload: dict[str, Any], artifacts_dir: str | Path = ARTIFACTS_DIR) -> str:
    """Write one JSON artifact and return its path relative to the repo root."""
    category = _sanitize_path_component(category, "category")
    artifact_id = _sanitize_path_component(artifact_id, "artifact_id")
    directory = Path(artifacts_dir) / category
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{artifact_id}.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


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
    """Apply the provenance decision order and return
    (final_action, reason_code, semantic_similarity_evaluated, incident_required).
    """
    rules = rules or load_provenance_rules()

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
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
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
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
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
    """Aggregate every event sharing a correlation_id into one incident episode."""
    chain = sorted(
        (event for event in events if event.get("correlation_id") == correlation_id),
        key=lambda event: event.get("timestamp_utc", ""),
    )
    critical_count = sum(1 for event in chain if _is_critical(event))

    artifact = {
        "correlation_id": correlation_id,
        "event_count": len(chain),
        "critical_event_count": critical_count,
        "is_critical": critical_count > 0,
        "tenant_ids": sorted({event.get("tenant_id") for event in chain if event.get("tenant_id")}),
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
    return build_incident_artifact(correlation_id, load_events(feed_path), artifacts_dir)


if __name__ == "__main__":
    decision = build_decision_artifact(
        candidate_entry_id="cache_456",
        producer_tenant_id="tenant_alpha",
        consumer_tenant_id="tenant_alpha",
        producer_user_scope="user_1",
        consumer_user_scope="user_1",
        producer_authorization_scope=["story:read"],
        consumer_authorization_scope=["story:read"],
        provenance_domain="story_state",
        producer_revocation_epoch=8,
        consumer_revocation_epoch=8,
    )
    print("decision:", decision["final_action"], decision["reason_code"])

    revocation = build_revocation_artifact(
        reason="permission_revoked",
        tenant_id="tenant_alpha",
        user_scope="user_1",
        authorization_scope=["project:read"],
        namespace="story_state",
        previous_revocation_epoch=7,
        new_revocation_epoch=8,
        affected_partitions=["l99_partition_alpha_story_state"],
        invalidation_action="invalidate_scope",
    )
    print("revocation:", revocation["event_id"])

    incident = build_incident_artifact_from_feed(
        "inc_20260707_alpha_001",
        Path(__file__).resolve().parent.parent / "samples" / "events.ndjson",
    )
    print("incident:", incident["correlation_id"], incident["event_count"], "events")
