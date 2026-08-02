import { readFile, writeFile, rm } from 'node:fs/promises';

const target = 'story-engine/lib/storyEngineOrchestrator.js';
let source = await readFile(target, 'utf8');

function replaceExactlyOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected fragment not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: fragment occurs more than once`);
  }
  source = source.replace(before, after);
}

replaceExactlyOnce(
  'lindymode duplicate state',
  `    detector_report: ghostPlan.detector_report || null\n    ghost_draft_status: ghostPlan.draft?.status || null\n`,
  `    detector_report: ghostPlan.detector_report || null\n`,
);

replaceExactlyOnce(
  'duplicate ghost task wording',
  `      'Run Ghost humanize and Blader before Lindymode validation.',\n      'Validate continuity, audience fit, detector score, and operator constraints.',\n      'Run the Ghost human-voice post-pass before Lindymode validation.',\n      'Validate continuity, audience fit, and operator constraints.',\n`,
  `      'Run Ghost humanize and Blader before Lindymode validation.',\n      'Validate continuity, audience fit, detector score, and operator constraints.',\n`,
);

replaceExactlyOnce(
  'duplicate ghost stage event',
  `    setStage(db, runId, workspaceId, 'ghost', 'completed', 'Ghost drafted, Blader revised, and detector scoring completed.', { ...ghostPlan, draft: { ...ghostPlan.draft, draft_unit: '[stored in ghost_plan_json]' } });\n    setStage(db, runId, workspaceId, 'ghost', 'completed', 'Ghost created the voice fingerprint and drafted the first review unit.', { ...ghostPlan, draft: { ...ghostPlan.draft, draft_unit: '[stored in ghost_plan_json]' } });\n`,
  `    setStage(db, runId, workspaceId, 'ghost', 'completed', 'Ghost drafted, Blader revised, and detector scoring completed.', { ...ghostPlan, draft: { ...ghostPlan.draft, draft_unit: '[stored in ghost_plan_json]' } });\n`,
);

replaceExactlyOnce(
  'duplicate brain snapshot command',
  `    ghost_commands: ghostCommandOptions(),\n    blader_health: bladerHealthSnapshot(db)\n    ghost_commands: ghostCommandOptions()\n`,
  `    ghost_commands: ghostCommandOptions(),\n    blader_health: bladerHealthSnapshot(db)\n`,
);

await writeFile(target, source, 'utf8');

await rm('scripts/repair-story-engine-orchestrator.mjs');
await rm('.github/workflows/one-time-story-engine-repair.yml');
