/* Character poses are mapped to real run stages, never elapsed-time progress. */
(() => {
  const root=document.createElement('span');root.className='amethyst-companion';root.hidden=true;
  const sprite=document.createElement('span');sprite.className='amethyst-state-sprite';sprite.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.setAttribute('role','status');label.setAttribute('aria-live','polite');root.append(sprite,label);
  function pose(stage){if(['intent_parser','creative_profile','story_memory','learning_engine'].includes(stage))return 'sparkle';if(['ghost','lindymode','runtime','artifacts'].includes(stage))return 'craft';if(['ooda','redteam_pre_runtime','playwright_validation','redteam_pre_release','release_gate','approval'].includes(stage))return 'review';return 'idle';}
  window.storyCompanion=Object.freeze({setActive(active,anchor,stage,stageId){if(!active||!anchor){root.hidden=true;return;}if(root.previousElementSibling!==anchor)anchor.after(root);root.dataset.pose=pose(stageId);root.hidden=false;label.textContent='Amethyst · '+String(stage||'Working…');}});
})();
