from __future__ import annotations

from copy import deepcopy
import unittest

from portfolio_status import PortfolioStatusError, build_status_envelope


COMMIT = "a" * 40
OBSERVED_AT = "2026-07-13T05:00:00Z"


def manifest_fixture() -> dict:
    return {
        "schemaVersion": "1.0",
        "repository": "jussray/l99-StoryEngine",
        "portfolioHub": "jussray/founder-control-room",
        "controlRoom": {"privateContentAllowed": False},
        "evidence": {
            "status": "at-risk",
            "proofRefs": ["GLOBAL_AI.md", "docs/GUARDRAILS.md"],
        },
        "risk": {
            "level": "high",
            "blockers": ["Tenant-safe authorization remains a release blocker"],
        },
        "nextGate": "Complete tenant-safe authorization before production release.",
    }


class PortfolioStatusTests(unittest.TestCase):
    def test_passed_gates_preserve_manifest_status(self) -> None:
        envelope = build_status_envelope(
            manifest_fixture(),
            commit=COMMIT,
            source_run_id="123",
            source_run_attempt=1,
            observed_at=OBSERVED_AT,
            gate_results=[
                {"gate": "provenance", "passed": True},
                {"gate": "revocation", "passed": True},
            ],
        )
        self.assertEqual(envelope["repository"], "jussray/l99-StoryEngine")
        self.assertEqual(envelope["gate_status"], "pass")
        self.assertEqual(envelope["status"], "at-risk")
        self.assertEqual(envelope["risk_level"], "high")
        self.assertIn("runtime/promotion_gates.py", envelope["proof_refs"])

    def test_failed_gate_blocks_status_without_downgrading_risk(self) -> None:
        envelope = build_status_envelope(
            manifest_fixture(),
            commit=COMMIT,
            source_run_id="124",
            source_run_attempt=2,
            observed_at=OBSERVED_AT,
            gate_results=[
                {"gate": "provenance", "passed": True},
                {"gate": "event_schema", "passed": False},
            ],
        )
        self.assertEqual(envelope["gate_status"], "fail")
        self.assertEqual(envelope["status"], "blocked")
        self.assertEqual(envelope["risk_level"], "high")
        self.assertIn("Promotion gates failed: event_schema", envelope["blockers"])
        self.assertIn("event_schema", envelope["next_gate"])

    def test_secret_like_material_is_rejected(self) -> None:
        manifest = deepcopy(manifest_fixture())
        manifest["risk"]["blockers"] = ["API_KEY=never-export-this"]
        with self.assertRaisesRegex(PortfolioStatusError, "contains_sensitive_material"):
            build_status_envelope(
                manifest,
                commit=COMMIT,
                source_run_id="125",
                source_run_attempt=1,
                observed_at=OBSERVED_AT,
                gate_results=[{"gate": "provenance", "passed": True}],
            )

    def test_unsafe_proof_reference_is_rejected(self) -> None:
        manifest = deepcopy(manifest_fixture())
        manifest["evidence"]["proofRefs"] = ["../private.env"]
        with self.assertRaisesRegex(PortfolioStatusError, "proof_refs_0_invalid"):
            build_status_envelope(
                manifest,
                commit=COMMIT,
                source_run_id="126",
                source_run_attempt=1,
                observed_at=OBSERVED_AT,
                gate_results=[{"gate": "provenance", "passed": True}],
            )

    def test_commit_must_be_exact_sha(self) -> None:
        with self.assertRaisesRegex(PortfolioStatusError, "commit_invalid"):
            build_status_envelope(
                manifest_fixture(),
                commit="main",
                source_run_id="127",
                source_run_attempt=1,
                observed_at=OBSERVED_AT,
                gate_results=[{"gate": "provenance", "passed": True}],
            )

    def test_old_repository_identity_is_rejected_by_manifest_loader_contract(self) -> None:
        manifest = manifest_fixture()
        manifest["repository"] = "jussray/l99-"
        self.assertNotEqual(manifest["repository"], "jussray/l99-StoryEngine")


if __name__ == "__main__":
    unittest.main()
