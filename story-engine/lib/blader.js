// lib/blader.js

import { ghostHumanizePass } from './ghostWriter.js';
import { compareHumanScores, scoreHumanLikeness } from './detectorEnsemble.js';

const SUBSTITUTIONS = [
  [/\bimportant\b/gi, 'worth keeping'],
  [/\bbig\b/gi, 'sharp'],
  [/\bvery\s+/gi, ''],
  [/\breally\s+/gi, ''],
  [/\bstarted to\b/gi, 'began to'],
  [/\bwas able to\b/gi, 'could'],
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bwith a sense of\b/gi, 'with']
];

function sentences(text = '') {
  return String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(item => item.trim()).filter(Boolean) || [];
}

function words(text = '') {
  return String(text || '').match(/[a-z0-9’'-]+/gi) || [];
}

function splitLongSentence(sentence, maxWords = 24) {
  const tokenList = words(sentence);
  if (tokenList.length <= maxWords) return [sentence];
  const commaIndex = sentence.indexOf(',');
  if (commaIndex > 24 && commaIndex < sentence.length - 12) {
    const first = sentence.slice(0, commaIndex).trim();
    const second = sentence.slice(commaIndex + 1).trim();
    return [punctuate(first), punctuate(capitalize(second))];
  }
  const parts = sentence.split(/\s+(and|but|because|while|when|so)\s+/i);
  if (parts.length >= 3) {
    const first = `${parts[0].trim()}.`;
    const rest = parts.slice(1).join(' ').trim();
    return [first, punctuate(capitalize(rest))];
  }
  return [sentence];
}

function punctuate(value) {
  const clean = String(value || '').trim();
  if (!clean) return clean;
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function capitalize(value) {
  const clean = String(value || '').trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
}

function varyCadence(text, fingerprint = {}) {
  const maxWords = ['eli5', 'child', 'baby'].includes(String(fingerprint.audience || '').toLowerCase()) ? 15 : 24;
  const out = [];
  for (const sentence of sentences(text)) {
    out.push(...splitLongSentence(sentence, maxWords));
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function lexicalPass(text) {
  let output = String(text || '');
  for (const [pattern, replacement] of SUBSTITUTIONS) output = output.replace(pattern, replacement);
  return output.replace(/\s+([,.!?;:])/g, '$1').replace(/ {2,}/g, ' ').trim();
}

export function runBlader(text = '', fingerprint = {}, options = {}) {
  const original = String(text || '').trim();
  const baseline = scoreHumanLikeness(original, fingerprint);
  let current = ghostHumanizePass(original);
  current = lexicalPass(current);
  current = varyCadence(current, fingerprint);
  current = ghostHumanizePass(current);

  const comparison = compareHumanScores(original, current, fingerprint);
  const accepted = options.force ? true : comparison.after.score >= baseline.score;
  const finalText = accepted ? current : ghostHumanizePass(original);
  const finalReport = scoreHumanLikeness(finalText, fingerprint);

  return {
    text: finalText,
    blader_score: finalReport.score,
    detector_report: finalReport,
    comparison,
    passes: [
      'ghost_humanize_base',
      'lexical_substitution',
      'sentence_fragmentation',
      'cadence_variation',
      'final_ghost_cleanup'
    ],
    accepted,
    threshold: finalReport.threshold,
    passed: finalReport.passed
  };
}
