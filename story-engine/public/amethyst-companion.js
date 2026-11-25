/* Amethyst: approved user-supplied fairy reference, no synthetic task progress. */
(() => {
  const root=document.createElement('span');
  root.className='amethyst-companion';root.hidden=true;
  const image=document.createElement('img');image.src='/assets/front-door/amethyst-companion.webp';image.alt='';image.width=64;image.height=80;
  const label=document.createElement('span');label.setAttribute('role','status');label.setAttribute('aria-live','polite');
  image.addEventListener('error',()=>{image.hidden=true;});
  root.append(image,label);
  window.storyCompanion=Object.freeze({setActive(active,anchor,stage){
    if(!active||!anchor){root.hidden=true;return;}
    if(root.previousElementSibling!==anchor)anchor.after(root);
    root.hidden=false;label.textContent='Amethyst · '+String(stage||'Working…');
  }});
})();
