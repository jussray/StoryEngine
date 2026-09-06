#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from trope_detector import evaluate_text as evaluate_tropes
from trope_detector import load_policy, select_thresholds, sha256_text

AI_PATTERNS = ['it is important to note', 'in conclusion', 'it became clear', 'not just', 'but also', 'tapestry', 'underscore', 'foster', 'delve', 'enhance', 'meaningful', 'shared journey', 'at its core', 'honestly']
CONCRETE_HINTS = ['hood', 'block', 'car', 'cash', 'text', 'door', 'seat', 'phone', 'sirens', 'envelope', 'rent', 'chain', 'corner', 'steps', 'kitchen', 'hallway']


def analyze_text(text: str) -> dict[str, Any]:
    lower = text.lower()
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
    words = re.findall(r"\b[\w']+\b", text)
    avg_sentence = len(words) / max(len(sentences), 1)
    fragments = sum(1 for s in sentences if len(re.findall(r"\b[\w']+\b", s)) < 6)
    em_dash_count = text.count('—')
    pattern_hits = [p for p in AI_PATTERNS if p in lower]
    concrete_hits = [w for w in CONCRETE_HINTS if re.search(rf'\b{re.escape(w)}\b', lower)]
    contractions = len(re.findall(r"\b\w+'\w+\b", text))
    abstract_words = len(re.findall(r'\b(love|pain|complexity|journey|survival|truth|emotion|feeling|loyalty)\b', lower))
    contradiction = bool(re.search(r"\b(but|though|except|instead|lied|lying|swore|promised|turned|hid|hiding)\b", lower))
    aiish = min(100, len(pattern_hits) * 12 + max(0, fragments - 2) * 6 + max(0, em_dash_count - 1) * 8 + (12 if avg_sentence > 28 else 0) + (14 if not concrete_hits else 0))
    voice = max(0, min(100, 55 + min(len(concrete_hits) * 5, 20) + min(contractions * 3, 12) - len(pattern_hits) * 8 - max(0, fragments - 3) * 4))
    melodrama = min(100, abstract_words * 4 + max(0, fragments - 3) * 7 + em_dash_count * 5)
    return {'aiish_score': aiish, 'voice_grip': voice, 'melodrama_score': melodrama, 'concrete_hits': concrete_hits, 'has_contradiction': contradiction}


def evaluate_chapter(text: str, *, policy: dict[str, Any], policy_fingerprint: str, mode: str, phase: str) -> dict[str, Any]:
    thresholds = select_thresholds(policy, mode, phase)
    analysis = analyze_text(text)
    trope_payload = evaluate_tropes(text, policy=policy, policy_fingerprint=policy_fingerprint, mode=mode, phase=phase)
    failures: list[str] = []
    if analysis['aiish_score'] > thresholds['max_aiish_score']:
        failures.append('AI-ish score above threshold')
    if analysis['voice_grip'] < thresholds['min_voice_grip']:
        failures.append('Voice grip below threshold')
    if analysis['melodrama_score'] > thresholds['max_melodrama_score']:
        failures.append('Melodrama above threshold')
    if thresholds['require_concrete_detail'] and not analysis['concrete_hits']:
        failures.append('Missing concrete detail')
    if thresholds['require_contradiction'] and not analysis['has_contradiction']:
        failures.append('Missing contradiction signal')
    failures.extend(trope_payload['gate']['failures'])
    failures = list(dict.fromkeys(failures))
    return {
        'schema_version': 'l99.prose-quality-gate.v1',
        'phase': phase,
        'mode': mode,
        'policy_fingerprint': policy_fingerprint,
        'input_fingerprint': sha256_text(text),
        'status': 'pass' if not failures else 'fail',
        'failures': failures,
        'thresholds': thresholds,
        'analysis': analysis,
        'trope_gate': trope_payload['gate'],
        'trope_report': trope_payload['report'],
    }


def _write_json(path: str | Path, payload: dict[str, Any]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def evaluate_file(path: str | Path, *, policy: dict[str, Any], policy_fingerprint: str, mode: str, phase: str) -> dict[str, Any]:
    text = Path(path).read_text(encoding='utf-8')
    return evaluate_chapter(text, policy=policy, policy_fingerprint=policy_fingerprint, mode=mode, phase=phase)


def _safe_under(root: Path, candidate: Path) -> Path:
    root = root.resolve()
    candidate = candidate.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f'manifest chapter path escapes root: {candidate}') from error
    return candidate


def run_manifest(manifest_path: str | Path, *, policy: dict[str, Any], policy_fingerprint: str, root: str | Path, out_dir: str | Path, default_mode: str = 'redteam_strict') -> dict[str, Any]:
    manifest_file = Path(manifest_path)
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    chapters = manifest.get('chapters')
    if not isinstance(chapters, list) or not chapters:
        raise ValueError('manifest must contain a non-empty chapters array')
    root_path = Path(root)
    output_dir = Path(out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    reports: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(chapters, start=1):
        if not isinstance(item, dict):
            raise ValueError(f'manifest chapters[{index - 1}] must be an object')
        chapter_id = str(item.get('id') or f'chapter-{index}').strip()
        if not chapter_id or chapter_id in seen_ids:
            raise ValueError(f'chapter id must be non-empty and unique: {chapter_id!r}')
        seen_ids.add(chapter_id)
        rel = str(item.get('path') or '').strip()
        phase = str(item.get('phase') or '').strip()
        mode = str(item.get('mode') or manifest.get('default_mode') or default_mode).strip()
        if not rel or not phase or not mode:
            raise ValueError(f'{chapter_id}: path, phase, and mode are required')
        source = _safe_under(root_path, root_path / rel)
        result = evaluate_file(source, policy=policy, policy_fingerprint=policy_fingerprint, mode=mode, phase=phase)
        result.update({'chapter_id': chapter_id, 'source_path': rel})
        safe_id = re.sub(r'[^A-Za-z0-9._-]+', '-', chapter_id).strip('-') or f'chapter-{index}'
        report_path = output_dir / f'{safe_id}.json'
        _write_json(report_path, result)
        reports.append({'chapter_id': chapter_id, 'path': rel, 'phase': phase, 'mode': mode, 'status': result['status'], 'report': str(report_path)})
    failed = [item for item in reports if item['status'] != 'pass']
    return {'schema_version': 'l99.prose-quality-batch.v1', 'policy_fingerprint': policy_fingerprint, 'status': 'pass' if not failed else 'fail', 'chapter_count': len(reports), 'failed_count': len(failed), 'chapters': reports}


def verify_prose_quality_contract(root: str | Path) -> list[str]:
    root_path = Path(root)
    reasons: list[str] = []
    policy_path = root_path / 'policies' / 'phase-thresholds.redteam.json'
    try:
        policy, fingerprint = load_policy(policy_path)
        default = policy['modes'].get('lindymode_default', {})
        strict = policy['modes'].get('redteam_strict', {})
        if set(default) != set(strict):
            reasons.append('lindymode_default and redteam_strict must cover identical phases')
        for phase in sorted(set(default) & set(strict)):
            d, s = default[phase], strict[phase]
            if s['max_aiish_score'] > d['max_aiish_score']:
                reasons.append(f'{phase}: redteam max_aiish_score is looser than default')
            if s['max_pattern_score'] > d['max_pattern_score']:
                reasons.append(f'{phase}: redteam max_pattern_score is looser than default')
            if s['min_voice_grip'] < d['min_voice_grip']:
                reasons.append(f'{phase}: redteam min_voice_grip is looser than default')
        probe = 'love truth pain loyalty journey survival emotion love truth pain loyalty journey survival'
        default_probe = evaluate_tropes(probe, policy=policy, policy_fingerprint=fingerprint, mode='lindymode_default', phase='retreat')
        strict_probe = evaluate_tropes(probe, policy=policy, policy_fingerprint=fingerprint, mode='redteam_strict', phase='retreat')
        if default_probe['report']['total_pattern_score'] != 21:
            reasons.append('synthetic retreat probe no longer produces expected pattern score 21')
        if default_probe['gate']['status'] != 'pass':
            reasons.append('default retreat probe should pass at pattern score 21')
        if strict_probe['gate']['status'] != 'fail':
            reasons.append('redteam retreat probe must fail at pattern score 21 against max 18')
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as error:
        reasons.append(f'prose quality contract invalid: {error}')
    return reasons


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Extended phase-aware quality gate with one threshold authority')
    parser.add_argument('--chapter')
    parser.add_argument('--phase')
    parser.add_argument('--mode', default='lindymode_default')
    parser.add_argument('--thresholds', required=True)
    parser.add_argument('--trope-out')
    parser.add_argument('--out')
    parser.add_argument('--manifest')
    parser.add_argument('--root', default='.')
    parser.add_argument('--out-dir')
    args = parser.parse_args(argv)
    try:
        policy, fingerprint = load_policy(args.thresholds)
        if args.manifest:
            if not args.out or not args.out_dir:
                raise ValueError('--manifest requires --out and --out-dir')
            summary = run_manifest(args.manifest, policy=policy, policy_fingerprint=fingerprint, root=args.root, out_dir=args.out_dir, default_mode=args.mode)
            _write_json(args.out, summary)
            return 0 if summary['status'] == 'pass' else 1
        if not args.chapter or not args.phase or not args.out:
            raise ValueError('single chapter mode requires --chapter, --phase, and --out')
        payload = evaluate_file(args.chapter, policy=policy, policy_fingerprint=fingerprint, mode=args.mode, phase=args.phase)
        _write_json(args.out, payload)
        if args.trope_out:
            _write_json(args.trope_out, {'schema_version': 'l99.trope-gate.v1', 'policy_fingerprint': payload['policy_fingerprint'], 'input_fingerprint': payload['input_fingerprint'], 'report': payload['trope_report'], 'gate': payload['trope_gate']})
        return 0 if payload['status'] == 'pass' else 1
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as error:
        print(f'quality gate configuration/input error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
