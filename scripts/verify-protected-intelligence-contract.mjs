import {readFile} from 'node:fs/promises';

const EXPECTED_PROJECT = 'jussray/StoryEngine';
const REQUIRED_SUBJECTS = [
  'creation','save_edit_publish_integrity','creator_ownership','transaction_integrity','publishing',
  'monetization','provenance','creative_workflow','rollback','production_proof',
];
const REQUIRED_FORMS = ['code','internal_modules','policies','evaluators','workflow_engines','tests','receipts'];
const REQUIRED_INTERNAL = ['internal_orchestration','hidden_prompts','private_reasoning','evaluator_notes','private_learning_records','proprietary_lineage'];
const REQUIRED_LIVE = ['source_head','deployment_identity','runtime_path','playwright_evidence','successor_fingerprint'];
const c = JSON.parse(await readFile('.control-room/council-residency.contract.json', 'utf8'));
const errors = [];
const yes = (label, value) => value === true || errors.push(`${label}: expected true`);
const has = (label, values, value) => Array.isArray(values) && values.includes(value) || errors.push(`${label}: missing ${value}`);
if (c.contract !== 'juss/founder-council-residency@v1') errors.push('wrong contract id');
if (c.project !== EXPECTED_PROJECT) errors.push(`wrong project: ${c.project}`);
yes('same Court/Council kernel', c.jurisdiction?.sameCourtCouncilKernel);
yes('repo/product/production scope', c.jurisdiction?.repoProductProductionScoped);
REQUIRED_SUBJECTS.forEach((v) => has('StoryEngine subject', c.jurisdiction?.subjects, v));
if (c.intelligenceBoundary?.principle !== 'learn_encode_verify_compound_expose_value_protect_machinery') errors.push('intelligence principle drifted');
yes('durable reusable intelligence', c.intelligenceBoundary?.reusableIntelligenceMustBecomeDurableCapability);
yes('not founder-memory dependent', c.intelligenceBoundary?.intelligenceMustNotDependOnFounderMemory);
yes('users own data and outputs', c.intelligenceBoundary?.usersOwnTheirDataAndOutputs);
yes('external providers replaceable', c.intelligenceBoundary?.externalProvidersReplaceable);
REQUIRED_FORMS.forEach((v) => has('durable form', c.intelligenceBoundary?.durableForms, v));
REQUIRED_INTERNAL.forEach((v) => has('internal-only intelligence', c.intelligenceBoundary?.internalOnly, v));
yes('live end-to-end required', c.completion?.affectedLiveProjectsRequireEndToEndRuntimeProof);
yes('done requires runtime verification', c.completion?.doneWordsRequireRuntimeVerificationWhenLiveGoal);
yes('earlier stage not live', c.completion?.earlierStagesDoNotSatisfyLive);
REQUIRED_LIVE.forEach((v) => has('live proof', c.completion?.requiredLiveProof, v));
if (c.domainCourt?.storyEngineCreativeCourt?.contract !== 'juss/storyengine-three-council-court@v1') errors.push('StoryEngine domain Court drifted');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(JSON.stringify({project:c.project,status:'passed',subjects:REQUIRED_SUBJECTS,liveProof:REQUIRED_LIVE}));
