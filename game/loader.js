'use strict';
// New objective files register themselves; no script contents are evaluated in this loader.
window.SK_MODULES=[];window.SK_CASES={};
window.registerScenarios=m=>window.SK_MODULES.push(m);
window.registerEncounters=entries=>{
 for(const [id,encounter] of Object.entries(entries)){
  if(window.SK_CASES[id])throw Error('Duplicate encounter '+id);
  window.SK_CASES[id]=encounter;
 }
};
window.loadGameModules=async()=>{
 for(const path of window.SK_MANIFEST){
  await loadScript('scenarios/'+path);
  await loadScript('encounters/'+path);
 }
 const ids=new Set(),objectives=new Set(),scenarios=[];
 for(const m of window.SK_MODULES){
  if(objectives.has(m.objective))throw Error('Multiple modules for '+m.objective);
  objectives.add(m.objective);
  for(const s of m.entries){
   if(s.objective!==m.objective||s.domain!==m.domain||ids.has(s.id))throw Error('Invalid metadata '+s.id);
   if(!window.SK_CASES[s.id])throw Error('Missing encounter '+s.id);
   ids.add(s.id);scenarios.push(s);
  }
 }
 if(scenarios.length<40)throw Error('The completed bank is short of 40 scenarios');
 return scenarios;
};
function loadScript(src){
 return new Promise((resolve,reject)=>{
  const tag=document.createElement('script');tag.src=src;
  tag.onload=resolve;tag.onerror=()=>reject(Error('Cannot load '+src));
  document.head.appendChild(tag);
 });
}
