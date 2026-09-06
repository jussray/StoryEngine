#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from quality_gate_extended import run_manifest, verify_prose_quality_contract  # noqa: E402
from trope_detector import evaluate_text, load_policy  # noqa: E402

POLICY = ROOT / 'policies' / 'phase-thresholds.redteam.json'


class ProseQualityGateTests(unittest.TestCase):
    def test_redteam_pattern_limit_is_the_real_authority(self):
        policy, fingerprint = load_policy(POLICY)
        text = 'love truth pain loyalty journey survival emotion love truth pain loyalty journey survival'
        default = evaluate_text(text, policy=policy, policy_fingerprint=fingerprint, mode='lindymode_default', phase='retreat')
        strict = evaluate_text(text, policy=policy, policy_fingerprint=fingerprint, mode='redteam_strict', phase='retreat')
        self.assertEqual(default['report']['total_pattern_score'], 21)
        self.assertEqual(default['gate']['max_pattern_score'], 24)
        self.assertEqual(default['gate']['status'], 'pass')
        self.assertEqual(strict['gate']['max_pattern_score'], 18)
        self.assertEqual(strict['gate']['status'], 'fail')

    def test_boolean_numeric_threshold_fails_closed(self):
        payload = json.loads(POLICY.read_text(encoding='utf-8'))
        payload['modes']['redteam_strict']['retreat']['max_pattern_score'] = True
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / 'bad.json'
            path.write_text(json.dumps(payload), encoding='utf-8')
            with self.assertRaises(ValueError):
                load_policy(path)

    def test_cli_returns_nonzero_when_gate_fails(self):
        with tempfile.TemporaryDirectory() as scratch:
            chapter = Path(scratch) / 'chapter.md'
            out = Path(scratch) / 'report.json'
            chapter.write_text('In conclusion, this meaningful tapestry will delve into love and truth.', encoding='utf-8')
            proc = subprocess.run([sys.executable, str(HERE / 'quality_gate_extended.py'), '--chapter', str(chapter), '--phase', 'aftermath', '--mode', 'redteam_strict', '--thresholds', str(POLICY), '--out', str(out)], check=False, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 1, proc.stderr)
            self.assertEqual(json.loads(out.read_text(encoding='utf-8'))['status'], 'fail')

    def test_batch_writes_one_report_per_chapter_and_fails_summary(self):
        policy, fingerprint = load_policy(POLICY)
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / 'clean.md').write_text("I can't leave the phone on the kitchen table, but I promised I'd come back.", encoding='utf-8')
            (root / 'bad.md').write_text('In conclusion, this meaningful tapestry will delve into love and truth.', encoding='utf-8')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'default_mode': 'redteam_strict', 'chapters': [{'id': 'clean', 'path': 'clean.md', 'phase': 'retreat'}, {'id': 'bad', 'path': 'bad.md', 'phase': 'aftermath'}]}), encoding='utf-8')
            out_dir = root / 'reports'
            summary = run_manifest(manifest, policy=policy, policy_fingerprint=fingerprint, root=root, out_dir=out_dir)
            self.assertEqual(summary['chapter_count'], 2)
            self.assertGreaterEqual(summary['failed_count'], 1)
            self.assertEqual(summary['status'], 'fail')
            self.assertTrue((out_dir / 'clean.json').exists())
            self.assertTrue((out_dir / 'bad.json').exists())

    def test_contract_verifier_is_green(self):
        self.assertEqual(verify_prose_quality_contract(ROOT), [])


if __name__ == '__main__':
    unittest.main()
