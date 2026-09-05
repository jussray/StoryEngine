import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET_CLASSES = Object.freeze({
  'stateful-container-durable-volume': Object.freeze({
    capabilities: Object.freeze([
      'container-process',
      'durable-mounted-filesystem',
      'sqlite-file-persistence',
      'exact-release-identity',
      'https-origin'
    ])
  }),
  'container-ephemeral-disk': Object.freeze({
    capabilities: Object.freeze([
      'container-process',
      'exact-release-identity',
      'https-origin'
    ])
  }),
  'stateless-worker': Object.freeze({
    capabilities: Object.freeze([
      'exact-release-identity',
      'https-origin'
    ])
  })
});

export function evaluateProviderAuthority(contract, targetClass) {
  const reasons = [];
  const target = TARGET_CLASSES[targetClass];

  if (!target) {
    reasons.push(`unknown deployment target class: ${targetClass}`);
  }

  if (contract?.runtime?.kind !== 'stateful-container') {
    reasons.push(`runtime.kind must remain stateful-container, got ${contract?.runtime?.kind ?? 'missing'}`);
  }

  if (contract?.state?.backend !== 'sqlite') {
    reasons.push(`state.backend must remain sqlite, got ${contract?.state?.backend ?? 'missing'}`);
  }

  if (contract?.state?.persistentMountRequired !== true) {
    reasons.push('state.persistentMountRequired must be true');
  }

  if (contract?.state?.ephemeralContainerDiskAccepted !== false) {
    reasons.push('state.ephemeralContainerDiskAccepted must be explicitly false');
  }

  const requiredCapabilities = contract?.providerCompatibility?.requiredCapabilities;
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.length === 0) {
    reasons.push('providerCompatibility.requiredCapabilities must be a non-empty array');
  } else if (target) {
    const available = new Set(target.capabilities);
    for (const capability of requiredCapabilities) {
      if (!available.has(capability)) reasons.push(`target ${targetClass} lacks required capability: ${capability}`);
    }
  }

  return Object.freeze({
    authority: reasons.length === 0 ? 'AUTHORIZED' : 'REJECTED',
    target_class: targetClass,
    reasons: Object.freeze(reasons)
  });
}

export function loadRuntimeContract() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, 'runtime-contract.json'), 'utf8'));
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  const targetClass = process.env.STORYENGINE_DEPLOYMENT_TARGET_CLASS || process.argv[2] || '';
  const decision = evaluateProviderAuthority(loadRuntimeContract(), targetClass);
  console.log(JSON.stringify(decision, null, 2));
  if (decision.authority !== 'AUTHORIZED') process.exit(1);
}
