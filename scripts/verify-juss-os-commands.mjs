import {readFileSync} from 'node:fs';

const failures = [];
const agents = readFileSync('AGENTS.md', 'utf8');
const entrypoint = readFileSync('AGENTS_FOUNDER_INTELLIGENCE.md', 'utf8');
const constitution = readFileSync('docs/FOUNDER_INTELLIGENCE_CONSTITUTION.md', 'utf8');

function requireIncludes(label, source, value) {
  if (!source.includes(value)) failures.push(`${label} missing ${JSON.stringify(value)}`);
}

requireIncludes('AGENTS.md', agents, 'AGENTS_FOUNDER_INTELLIGENCE.md');
requireIncludes('AGENTS.md', agents, 'docs/FOUNDER_INTELLIGENCE_CONSTITUTION.md');
requireIncludes('Founder Intelligence entrypoint', entrypoint, 'docs/FOUNDER_INTELLIGENCE_CONSTITUTION.md');

const commands = [
  '/goalfix',
  '/ultrathink',
  '/truthmode',
  '/confess',
  '/redteam',
  '/lindymode',
  '/ooda',
  '/visualize',
];

for (const command of commands) {
  requireIncludes('Founder Intelligence entrypoint', entrypoint, command);
}

const challengeStack = [
  'ULTRATHINK',
  'Red Team 1 — premise',
  'Lindy mode',
  'L99',
  'Red Team 2 — implementation',
  'OODA',
  'Proof',
  'Rollback / Next Gate',
];

let previousIndex = -1;
for (const step of challengeStack) {
  const index = entrypoint.indexOf(step);
  if (index < 0) failures.push(`Founder Intelligence entrypoint missing challenge step ${JSON.stringify(step)}`);
  if (index <= previousIndex) failures.push(`Founder Intelligence challenge stack out of order at ${JSON.stringify(step)}`);
  if (index >= 0) previousIndex = index;
}

for (const boundary of [
  'reasoning and planning modes only',
  'Repository-local authorship, provenance, tenant isolation, privacy, promotion, approval, rollback, evidence, compatibility, and non-deletion rules remain stricter and always win.',
  'These commands never create tool access',
  'A generated visual is not proof of authorship, provenance, tenant safety, runtime behavior, or release state.',
]) {
  requireIncludes('Founder Intelligence entrypoint', entrypoint, boundary);
}

for (const safetyTerm of ['authorship', 'provenance', 'privacy', 'rollback', 'evidence']) {
  if (!constitution.toLowerCase().includes(safetyTerm)) {
    failures.push(`Founder Intelligence constitution missing local safety term: ${safetyTerm}`);
  }
}

if (failures.length) {
  console.error('Juss OS command contract failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('Juss OS command contract passed.');
