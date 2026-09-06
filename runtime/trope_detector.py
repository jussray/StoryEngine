#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

PATTERNS = {
    'em_dash_overuse': {'description': 'Em dash density that feels generated rather than natural.', 'regex': r'—', 'weight': 8, 'threshold': 2},
    'not_x_but_y': {'description': 'The “not just X, but Y” or “it’s not X, it’s Y” flourish.', 'regex': r"(not just .*? but also|it'?s not just .*? it'?s|it'?s not .*? it'?s)", 'weight': 12, 'threshold': 0},
    'formal_filler': {'description': 'AI-style throat clearing and filler setup.', 'regex': r"(it is important to note|it'?s worth noting|in conclusion|at its core|in today'?s [^,.!?;:]+)", 'weight': 10, 'threshold': 0},
    'hype_words': {'description': 'Overused model-house-style words and hype terms.', 'regex': r"\b(delve|tapestry|underscore|foster|enhance|robust|leverage|meaningful|groundbreaking|seamless|ever-evolving|state-of-the-art)\b", 'weight': 9, 'threshold': 0},
    'rule_of_three': {'description': 'Repeated triadic phrasing that feels template-driven.', 'regex': r"\b\w+,\s+\w+,\s+and\s+\w+\b", 'weight': 6, 'threshold': 1},
    'rhetorical_result': {'description': 'Self-posed rhetorical punch like “The result?”', 'regex': r"\b(The result\?|What happens next\?|Why does this matter\?)", 'weight': 7, 'threshold': 0},
    'stacked_transitions': {'description': 'Formal transitions piled in for synthetic flow.', 'regex': r"\b(Moreover|Furthermore|Additionally|Consequently|Importantly)\b", 'weight': 5, 'threshold': 1},
    'grand_summary': {'description': 'Over-abstract emotional summary instead of scene evidence.', 'regex': r"\b(journey|complexity|survival|truth|emotion|pain|love|loyalty)\b", 'weight': 3, 'threshold': 6},
}

REQUIRED_NUMERIC = ('max_aiish_score', 'min_voice_grip', 'max_melodrama_score', 'max_pattern_score')
REQUIRED_BOOLEAN = ('require_concrete_detail', 'require_contradiction')


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode('utf-8'))


def load_policy(path: str | Path) -> tuple[dict[str, Any], str]:
    policy_path = Path(path)
    raw = policy_path.read_bytes()
    payload = json.loads(raw.decode('utf-8'))
    modes = payload.get('modes')
    if not isinstance(modes, dict) or not modes:
        raise ValueError('threshold policy must contain a non-empty modes object')
    for mode, phases in modes.items():
        if not isinstance(mode, str) or not isinstance(phases, dict) or not phases:
            raise ValueError('every threshold mode must contain a non-empty phase object')
        for phase, thresholds in phases.items():
            validate_thresholds(mode, phase, thresholds)
    return payload, sha256_bytes(raw)


def validate_thresholds(mode: str, phase: str, thresholds: Any) -> None:
    if not isinstance(thresholds, dict):
        raise ValueError(f'{mode}.{phase} thresholds must be an object')
    for key in REQUIRED_NUMERIC:
        value = thresholds.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f'{mode}.{phase}.{key} must be a number, not {type(value).__name__}')
        if value < 0 or value > 100:
            raise ValueError(f'{mode}.{phase}.{key} must be within 0..100')
    for key in REQUIRED_BOOLEAN:
        if not isinstance(thresholds.get(key), bool):
            raise ValueError(f'{mode}.{phase}.{key} must be boolean')
    for key, value in thresholds.items():
        if key.startswith('max_') and key not in REQUIRED_NUMERIC and key != 'max_pattern_score':
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f'{mode}.{phase}.{key} must be a non-negative integer')


def select_thresholds(policy: dict[str, Any], mode: str, phase: str) -> dict[str, Any]:
    modes = policy['modes']
    if mode not in modes:
        raise ValueError(f'unknown threshold mode: {mode}')
    if phase not in modes[mode]:
        raise ValueError(f'unknown phase for {mode}: {phase}')
    thresholds = modes[mode][phase]
    validate_thresholds(mode, phase, thresholds)
    return thresholds


def detect(text: str) -> dict[str, Any]:
    report: dict[str, Any] = {'total_pattern_score': 0, 'patterns': {}, 'flags': []}
    for name, rule in PATTERNS.items():
        hits = re.findall(rule['regex'], text, flags=re.I | re.S)
        count = len(hits)
        score = max(0, count - rule['threshold']) * rule['weight']
        report['patterns'][name] = {'count': count, 'weight': rule['weight'], 'threshold': rule['threshold'], 'score': score, 'description': rule['description']}
        report['total_pattern_score'] += score
    return report


def phase_gate(report: dict[str, Any], thresholds: dict[str, Any], *, mode: str, phase: str) -> dict[str, Any]:
    failures: list[str] = []
    limit = thresholds['max_pattern_score']
    if report['total_pattern_score'] > limit:
        failures.append(f"Pattern score {report['total_pattern_score']} exceeds {limit}")
    for key, value in thresholds.items():
        if not key.startswith('max_') or key in REQUIRED_NUMERIC or key == 'max_pattern_score':
            continue
        pattern_name = key.removeprefix('max_')
        count = report['patterns'].get(pattern_name, {}).get('count', 0)
        if count > value:
            failures.append(f'{pattern_name} count {count} exceeds {value}')
    return {'mode': mode, 'phase': phase, 'max_pattern_score': limit, 'status': 'pass' if not failures else 'fail', 'failures': failures}


def evaluate_text(text: str, *, policy: dict[str, Any], policy_fingerprint: str, mode: str, phase: str) -> dict[str, Any]:
    thresholds = select_thresholds(policy, mode, phase)
    report = detect(text)
    gate = phase_gate(report, thresholds, mode=mode, phase=phase)
    return {'schema_version': 'l99.trope-gate.v1', 'policy_fingerprint': policy_fingerprint, 'input_fingerprint': sha256_text(text), 'report': report, 'gate': gate}


def _write_json(path: str | Path, payload: dict[str, Any]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Detect common LLM writing tropes with policy-owned phase limits')
    parser.add_argument('--input', required=True)
    parser.add_argument('--phase', required=True)
    parser.add_argument('--mode', default='lindymode_default')
    parser.add_argument('--thresholds', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    try:
        policy, fingerprint = load_policy(args.thresholds)
        text = Path(args.input).read_text(encoding='utf-8')
        payload = evaluate_text(text, policy=policy, policy_fingerprint=fingerprint, mode=args.mode, phase=args.phase)
        _write_json(args.out, payload)
        return 0 if payload['gate']['status'] == 'pass' else 1
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f'trope gate configuration/input error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
