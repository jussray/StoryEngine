from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

# The production promotion runner imports this module before evaluating the
# federation contract. Standalone contract tests must load the same extended
# registry so cookie and federation gates are judged against production truth.
import promotion_gates_all  # noqa: F401

from control_room_contract import (
    FEDERATED_MANIFEST,
    LEGACY_MANIFEST,
    LEGACY_WORKFLOW,
    REQUIRED_COOKIE_EVIDENCE,
    REQUIRED_FEDERATION_EVIDENCE,
    verify_control_room_contract,
)

ROOT = Path(__file__).resolve().parent.parent
REQUIRED_FILES = REQUIRED_COOKIE_EVIDENCE | REQUIRED_FEDERATION_EVIDENCE
STALE_REPOSITORY = "jussray/l99-StoryEngine"


def copy_contract_tree(destination: Path) -> None:
    for relative_path in REQUIRED_FILES:
        source = ROOT / relative_path
        target = destination / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


class ControlRoomContractTests(unittest.TestCase):
    def test_current_repository_contract_passes(self) -> None:
        self.assertEqual(verify_control_room_contract(ROOT), [])

    def test_stale_promotion_entrypoint_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copy_contract_tree(root)
            path = root / FEDERATED_MANIFEST
            manifest = json.loads(path.read_text(encoding="utf-8"))
            capability = next(
                item
                for item in manifest["capabilities"]
                if item["id"] == "tail-latency-and-promotion-controls"
            )
            assertion = next(
                item
                for item in capability["usageAssertions"]
                if item["id"] == "workflow-executes-promotion-gates"
            )
            assertion["marker"] = "python runtime/promotion_gates.py"
            path.write_text(json.dumps(manifest), encoding="utf-8")

            errors = verify_control_room_contract(root)
            self.assertIn("promotion workflow usage assertion is stale", errors)

    def test_restored_oidc_authority_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copy_contract_tree(root)
            path = root / LEGACY_WORKFLOW
            path.write_text(
                path.read_text(encoding="utf-8") + "\n# id-token: write\n",
                encoding="utf-8",
            )

            errors = verify_control_room_contract(root)
            self.assertIn(
                "legacy direct observer retains authority: id-token: write",
                errors,
            )

    def test_stale_federated_repository_identity_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copy_contract_tree(root)
            path = root / FEDERATED_MANIFEST
            manifest = json.loads(path.read_text(encoding="utf-8"))
            manifest["repository"]["identifier"] = STALE_REPOSITORY
            path.write_text(json.dumps(manifest), encoding="utf-8")

            errors = verify_control_room_contract(root)
            self.assertIn("federated manifest repository identity is stale", errors)

    def test_stale_legacy_repository_identity_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            copy_contract_tree(root)
            path = root / LEGACY_MANIFEST
            manifest = json.loads(path.read_text(encoding="utf-8"))
            manifest["repository"] = STALE_REPOSITORY
            path.write_text(json.dumps(manifest), encoding="utf-8")

            errors = verify_control_room_contract(root)
            self.assertIn("legacy manifest repository identity is stale", errors)


if __name__ == "__main__":
    unittest.main()
