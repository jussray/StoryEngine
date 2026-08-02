# Copyright © 2026 Juss Ray. All rights reserved. Proprietary and confidential.
"""L99 partition resolver.

This module turns an isolation envelope into a deterministic semantic-cache
partition id. Semantic nearest-neighbor lookup must happen only inside the
partition returned here.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Iterable


@dataclass(frozen=True)
class IsolationEnvelope:
    tenant_id: str
    user_scope: str
    authorization_scope: tuple[str, ...]
    namespace: str
    model_version: str
    policy_version: str
    memory_schema_version: str
    revocation_epoch: int
    partition_version: str
    workflow_id: str | None = None
    region: str | None = None
    data_residency_zone: str | None = None
    shared_scope_policy: str = "private"

    @classmethod
    def from_mapping(cls, value: dict) -> "IsolationEnvelope":
        required = [
            "tenant_id",
            "user_scope",
            "authorization_scope",
            "namespace",
            "model_version",
            "policy_version",
            "memory_schema_version",
            "revocation_epoch",
            "partition_version",
        ]
        missing = [field for field in required if field not in value]
        if missing:
            raise ValueError(f"missing isolation envelope fields: {', '.join(missing)}")

        authorization_scope = value["authorization_scope"]
        if not isinstance(authorization_scope, Iterable) or isinstance(authorization_scope, str):
            raise ValueError("authorization_scope must be a list or tuple of strings")

        return cls(
            tenant_id=str(value["tenant_id"]),
            user_scope=str(value["user_scope"]),
            authorization_scope=tuple(sorted(str(item) for item in authorization_scope)),
            namespace=str(value["namespace"]),
            model_version=str(value["model_version"]),
            policy_version=str(value["policy_version"]),
            memory_schema_version=str(value["memory_schema_version"]),
            revocation_epoch=int(value["revocation_epoch"]),
            partition_version=str(value["partition_version"]),
            workflow_id=value.get("workflow_id"),
            region=value.get("region"),
            data_residency_zone=value.get("data_residency_zone"),
            shared_scope_policy=str(value.get("shared_scope_policy", "private")),
        )

    def canonical_payload(self) -> dict:
        """Return stable fields used for partition hashing."""
        return {
            "tenant_id": self.tenant_id,
            "user_scope": self.user_scope,
            "authorization_scope": list(self.authorization_scope),
            "namespace": self.namespace,
            "model_version": self.model_version,
            "policy_version": self.policy_version,
            "memory_schema_version": self.memory_schema_version,
            "revocation_epoch": self.revocation_epoch,
            "partition_version": self.partition_version,
            "workflow_id": self.workflow_id,
            "region": self.region,
            "data_residency_zone": self.data_residency_zone,
            "shared_scope_policy": self.shared_scope_policy,
        }


def resolve_partition_id(envelope: IsolationEnvelope) -> str:
    """Resolve a deterministic partition id from an isolation envelope."""
    payload = json.dumps(envelope.canonical_payload(), sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"l99_partition_{digest}"


def build_partition_audit(envelope: IsolationEnvelope) -> dict:
    """Return audit metadata for dashboards, CI gates, and incident artifacts."""
    return {
        "partition_id": resolve_partition_id(envelope),
        "tenant_id": envelope.tenant_id,
        "user_scope": envelope.user_scope,
        "authorization_scope": list(envelope.authorization_scope),
        "namespace": envelope.namespace,
        "model_version": envelope.model_version,
        "policy_version": envelope.policy_version,
        "memory_schema_version": envelope.memory_schema_version,
        "revocation_epoch": envelope.revocation_epoch,
        "partition_version": envelope.partition_version,
        "shared_scope_policy": envelope.shared_scope_policy,
    }


def resolve_from_mapping(value: dict) -> dict:
    """Convenience helper for JSON-style callers."""
    envelope = IsolationEnvelope.from_mapping(value)
    return build_partition_audit(envelope)
