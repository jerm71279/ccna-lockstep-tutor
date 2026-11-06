window.SK_FLOORS=[['The Access Vaults','Switching & first hops'],['The Routed Deep','Routing, services & filtering'],['The Core Signal','Resilience & programmability']];
'use strict';
/** DOM-only controller. Game rules and lesson data are separate modules. */
const SK_APP=(()=>{
 const $=s=>document.querySelector(s),root=$('#app');
 const safe=window.localStorage;
 let all=[],cases={},engine=null,view='menu',error=null,toastTimer;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const domains=window.SK_DOMAINS||[],objectives=window.SK_OBJECTIVES||{};
 function init(scenarios,encounters){all=scenarios;cases=encounters;engine=new SignalEngine(all,cases,safe);bind();render();}
 const byObjective=(list,filter)=>filter==='mixed'?list:list.filter(s=>filter.startsWith('d')?s.domain===Number(filter.slice(1)):s.objective===filter);
 const floorName=n=>(SK_FLOORS||[['The Access Vaults'],['The Routed Deep'],['The Core Signal']])[n]?.[0];
 function toast(msg){let el=$('#toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';el.setAttribute('role','status');document.body.appendChild(el);}el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),2400);}
 function call(fn){try{fn();error=null;}catch(e){error=e.message;}render();}
 function header(){
  const r=engine.run;if(!r)return'';
  const hints=r.lens>r.lensUsed?`<span>◉ hint ready</span>`:'';
  return`<section class="hud" aria-label="Run status"><div class="hud-row"><span>${r.kind==='drill'?'Blueprints drill':`Floor ${r.floor+1}/3 · ${r.status==='reward'?'guardian cleared':`Room ${Math.min(5,(engine.run.index||0)+1)}/5`}`}</span><span class="lives" aria-label="${r.lives} lives remaining">${'♥'.repeat(r.lives)}${'♡'.repeat(Math.max(0,3-r.lives))}</span><span>${r.score} pts</span></div><div class="hp-track" role="meter" aria-label="Integrity" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.hp}"><div class="hp-fill ${r.hp<=35?'low':''}" style="width:${r.hp}%"></div></div><div class="hp-caption"><span>INTEGRITY ${r.hp}/100</span><span>${r.ward?'◇ Ward · ':''}${hints}</span></div>${r.kind==='run'?`<div class="map" aria-label="Room progress">${[1,2,3,4,5].map((_,i)=>`<span class="map-node ${i===4?'boss ':''}${i<engine.run.index?'done ':''}${i===Math.min(engine.run.index,4)&&r.status!=='reward'?'current':''}"></span>`).join('')}</div>`:''}</section>`;
 }
 function menu(){
  const has=!!engine.savedRun();
  const domainButtons=domains.map((d,i)=>`<button class="domain-btn" data-filter="d${i+1}"><b>${i+1}.0 ${esc(d)}</b><span>${all.filter(s=>s.domain===i+1).length} rooms · ${countObj(i+1)} objectives</span></button>`).join('');
  return`<section class="panel hero"><p class="eyebrow">An original CCNA troubleshooting roguelite</p><h1>SIGNAL <span>KEEP</span></h1><p>Fix broken networks. Defeat your nemeses.</p><div class="keep-scape" aria-hidden="true"><i class="node n1"></i><i class="node n2"></i><i class="node n3"></i><i class="node n4"></i><div class="tower"></div></div><div class="actions">${has?'<button class="btn" data-action="resume">Resume descent</button><button class="btn secondary" data-action="new-confirm">New mixed descent</button>':'<button class="btn" data-action="start">Begin mixed descent · 3 floors</button>'}<button class="btn secondary" data-action="nemesis">Nemesis drill <small>(${engine.profile.nemeses.length})</small></button></div><p class="save-note">100 HP · 3 lives · 5 rooms per floor · Bosses & rewards<br>Your run and study progress stay on this phone.</p></section><section class="panel"><div class="stats"><div class="stat"><b>${all.length}</b><span>fault rooms</span></div><div class="stat"><b>${uniqueObj().size}</b><span>objectives</span></div><div class="stat"><b>${engine.profile.wins}</b><span>keeps restored</span></div></div><h2>Choose your study route</h2><p class="tiny">Mixed pulls from all available cases. Prefer a blueprint domain?</p><div class="filter-grid">${domainButtons}</div><label class="sr-only" for="objective-select">Practice objective</label><select id="objective-select" class="objective-select" aria-label="Practice objective"><option value="">Or choose a specific exam objective…</option>${all.filter((s,i)=>i===all.findIndex(x=>x.objective===s.objective)).sort((a,b)=>a.objective.localeCompare(b.objective,undefined,{numeric:true})).map(s=>`<option value="${s.objective}">${s.objective} · ${esc(objectives[s.objective]||s.topic)} (${all.filter(x=>x.objective===s.objective).length})</option>`).join('')}</select><details><summary>Current blueprint coverage</summary><div><p>${coverage()}</p><p>CCNA 200-301 v1.1 is broader than this original bank. Covered objectives link below or start through the selector. More rooms can be added independently in each objective file.</p></div></details></section><section class="panel"><h2>Field library</h2><p class="tiny">Original evidence, repairs, command cards, and concept mnemonics. No Dungineer content or assets.</p><div class="actions"><button class="btn secondary" data-action="library">Lessons & command cards</button><button class="btn secondary" data-action="ledger">Mastery & nemesis ledger</button></div><a class="bookmark-link" href="/game/">Bookmark Signal Keep</a><p class="save-note">On iPhone: Safari → Share → Add to Home Screen.</p></section>`;
 }
 function countObj(d){return new Set(all.filter(s=>s.domain===d).map(s=>s.objective)).size;}
 function uniqueObj(){return new Set(all.map(s=>s.objective));}
 function objective3(n){return String(n).padStart(2,'0');}
 function coverage(){let text='';for(let d=1;d<=6;d++){const o=[...new Set(all.filter(s=>s.domain===d).map(s=>s.objective))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));text+=`<strong>${d}.0</strong> ${o.map(x=>`<button class="inline-objective" data-filter="${x}">${x}</button>`).join(' ')}<br>`;}return text;}
 function practice(filter){if(hasSavedNeedsConfirm())return;if(filter==='nemesis'){call(()=>engine.startDrill(engine.profile.nemeses));return;}const list=byObjective(all,filter);call(()=>filter==='mixed'?engine.start():engine.startDrill(list.map(s=>s.id)));}
 function hasSavedNeedsConfirm(){if(engine.savedRun()&&!confirm('Replace your saved descent with this practice drill? Topic mastery stays saved.'))return true;return false;}
 function room(){
  const s=engine.current(),c=cases[s.id],r=engine.result;
  const correctHint=engine.run.lens>engine.run.lensUsed&&!r;
  return header()+`<section class="panel"><div class="room-head"><div><span class="caps">${esc(s.domain)}.0 · ${esc(s.objective)}</span><h2 class="room-name">${esc(s.title)}</h2></div><span class="threat">${engine.avenger()?'NEMESIS':engine.run.index===4?'GUARDIAN':'FAULT'}</span></div>${engine.avenger()?'<div class="nemesis-banner">This missed fault returns with 40 HP of pressure. Repair it to clear this nemesis.</div>':''}<p class="objective">${esc(c.objective)}</p><div class="terminal"><div class="term-bar"><span>READOUT · ${esc(s.id)}</span><span>SIMULATED IOS</span></div><pre>${esc(c.evidence)}</pre></div><h3>Select your repair</h3><div class="options" role="group" aria-label="Repair choices">${c.choices.map((x,i)=>`<button class="option ${r?(i===c.answer?'correct':i===r.choice?'wrong':''):(!r&&engine.run.lens>engine.run.lensUsed&&i===(c.answer+1)%4?'eliminated':'')}" data-answer="${i}" ${r?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span>${esc(x)}</button>`).join('')}</div>${correctHint?'<p class="save-note" style="color:var(--gold)">Tracer Lens: crossed-out options are ruled incorrect.</p>':''}${r?feedback(s,c,r):''}<div class="actions room-actions"><button class="inline-link" data-action="library">Lesson library</button><button class="inline-link" data-action="menu">Save & title</button></div></section>`;
 }
 function feedback(s,c,r){
  const next=engine.run.queue.length===1?(engine.run.kind==='drill'?'Complete drill':'Resolve floor'):'Face next fault';
  return`<section class="feedback ${r.correct?'good':'bad'}" id="feedback" tabindex="-1"><h3>${r.correct?'✓ REPAIR VERIFIED':'× SIGNAL DEGRADED'}</h3><p>${r.lifeLost?'Life lost. Integrity rebuilt if a life remains. ':''}${r.wardUsed?'Spanning Ward absorbed the fault. ':''}${r.correct?'The evidence supports this change.':'That repair missed the actual discrepancy.'}</p><p><strong>Correct action:</strong> ${esc(c.choices[c.answer])}</p><details open><summary>Why this repair works</summary><div><p>${esc(s.lesson)}</p><p><strong>Common traps:</strong> ${esc(c.analysis)}</p><p><strong>Fault:</strong> ${esc(s.fault)}</p><p><strong>Verify:</strong> Re-read the altered table/interface and test return traffic where applicable.</p></div></details><details><summary>Command & memory card</summary><div class="command-table">${s.commands.map(x=>`<code>${esc(x)}</code>`).join('')}</div><ul>${s.mnemonics.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></details><div class="actions"><button class="btn" data-action="next">${next}</button></div></section>`;
 }
 function floor(){
  const n=engine.run.floor;
  return header()+`<section class="panel floor-card"><div class="glyph">${['⌁','⇄','◆'][n]}</div><p class="eyebrow">Floor ${n+1} of 3</p><h2>${esc(floorName(n))}</h2><p>Five rooms stand between you and the guardian.<br>Any miss becomes a nemesis and follows you.</p><div class="stats"><div class="stat"><b>${engine.run.hp}</b><span>integrity</span></div><div class="stat"><b>${engine.run.lives}</b><span>lives</span></div><div class="stat"><b>${engine.run.score}</b><span>score</span></div></div><div class="actions"><button class="btn" data-action="enter-floor">Enter floor ${n+1}</button><button class="btn secondary" data-action="menu">Save & title</button></div></section>`;
 }
 function reward(){
  return header()+`<section class="panel"><p class="eyebrow">Guardian defeated</p><h2>Choose one field upgrade</h2><p>Carry your remaining HP and lives forward. Your next floor has different faults.</p><div class="actions">${Object.entries(engine.state().perks).map(([k,p])=>`<button class="btn secondary" data-perk="${k}">${p.icon} ${esc(p.name)}<br><small>${esc(p.desc)}</small></button>`).join('')}</div></section>`;
 }
 function ending(){
  const r=engine.run,title=r.status==='victory'?'KEEP RESTORED':r.status==='drill-complete'?'DRILL COMPLETE':'RUN ENDED';
  return`<section class="panel floor-card"><div class="glyph">${r.status==='victory'?'♜':'⌁'}</div><p class="eyebrow">${r.status==='defeat'?'Study the field notes and try again':'Repair log secured'}</p><h2>${title}</h2><p>${r.status==='defeat'?'Missed faults are now nemeses. Your library has every lesson.':'Stronger signal. Stronger troubleshooting instincts.'}</p><div class="stats"><div class="stat"><b>${r.score}</b><span>score</span></div><div class="stat"><b>${r.clears}</b><span>repairs</span></div><div class="stat"><b>${r.bosses}</b><span>guardians</span></div></div><div class="actions"><button class="btn" data-action="menu">Return to keep</button>${engine.profile.nemeses.length?'<button class="btn secondary" data-action="nemesis">Review nemeses</button>':''}<button class="btn secondary" data-action="library">Open field library</button></div></section>`;
 }
 function manual(){
  return`<section class="panel"><p class="eyebrow">Field manual</p><h2>Read. Compare. Repair.</h2><ul class="feature-list"><li>Use evidence: find what differs from the intended design.</li><li>Pick the smallest accurate fix, then verify both directions.</li><li>A regular miss costs 25 HP; a boss costs 35; a nemesis costs 40.</li><li>A new miss returns as a stronger nemesis at the end of its room group. It follows at the end of the current room group.</li><li>At zero HP you lose a life and recover to 100 if a life remains.</li></ul></section><section class="panel"><h2>Practice & blueprint</h2><p>Mixed descent is three five-room floors. Domain and objective drills use all cases for your selection, preserving HP, lives, and nemeses. Choose upgrades between the three floors of a mixed descent. The fifth room of each mixed floor is the boss.</p><p>Correctly repairing a nemesis clears that exact fault from the persistent ledger. Misses are also scheduled in future mixed runs. Use the mastery ledger to review accuracy and weak spots.</p><p class="tiny">Progress uses browser local storage, not the tutor's Supabase account. Content is an original teaching simulation, not live IOS or copied Dungineer material.</p><button class="btn secondary" data-action="menu">Back to title</button></section>`;
 }
 function library(){
  return`<section class="panel"><p class="eyebrow">Field library · ${all.length} original lessons</p><h2>Blueprint repair cards</h2><p class="tiny">Select an objective card to reveal its repair, commands, and mnemonics. Actual readouts and answer analysis stay in each encounter.</p></section><div class="study-grid">${[...all].sort((a,b)=>a.objective.localeCompare(b.objective,undefined,{numeric:true})||a.id.localeCompare(b.id)).map(s=>`<details class="lesson-card"><summary><strong>${esc(s.objective)}</strong> ${esc(s.title)}<br><span class="tiny">${domains[s.domain-1]} · ${esc(s.topic)} ${engine.profile.nemeses.includes(s.id)?'· ◆ Nemesis':''}</span></summary><div><p><strong>${esc(s.summary)}</strong></p><p>${esc(s.lesson)}</p><p class="neutral"><strong>Repair idea:</strong> ${esc(s.correct)}</p><div class="command-table">${s.commands.map(x=>`<code>${esc(x)}</code>`).join('')}</div><ul>${s.mnemonics.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></details>`).join('')}</div><div class="actions"><button class="btn secondary" data-action="menu">Back to keep</button></div>`;
 }
 function ledger(){
  const stats=Object.values(engine.profile.topics).reduce((a,x)=>({t:a.t+x.t,c:a.c+x.c}),{t:0,c:0});
  return`<section class="panel"><p class="eyebrow">Persistent field record</p><h2>Mastery & nemeses</h2><div class="stats"><div class="stat"><b>${stats.t?Math.round(stats.c/stats.t*100):0}%</b><span>accuracy</span></div><div class="stat"><b>${engine.profile.nemeses.length}</b><span>active nemeses</span></div><div class="stat"><b>${engine.profile.bestScore}</b><span>best score</span></div></div></section><section class="panel"><h2>Fault ledger</h2>${all.map(s=>{const st=engine.profile.topics[s.id]||{t:0,c:0},p=st.t?Math.round(st.c/st.t*100):0;return`<div class="topic-row"><div class="topic-line"><span>${engine.profile.nemeses.includes(s.id)?'◆ ':''}<strong>${esc(s.objective)}</strong> ${esc(s.title)}<br><span class="tiny">${st.c}/${st.t} repairs · ${esc(s.topic)}</span></span><span>${st.t?p+'%':'New'}</span></div><div class="progress-track"><i style="width:${p}%"></i></div></div>`;}).join('')}<div class="reset-area"><p class="tiny">Resets only Signal Keep on this device. It does not alter the CCNA tutor or its Supabase study planner.</p><button class="inline-link" data-action="reset">Reset game progress</button></div><div class="actions"><button class="btn secondary" data-action="menu">Back to keep</button></div></section>`;
 }
 function render(){
  if(!engine){root.innerHTML='<section class="panel"><h1>Signal Keep</h1><p>Restoring study modules…</p></section>';return;}
  if(error){root.innerHTML=`<section class="panel"><h2>Local game error</h2><p>${esc(error)}</p><button class="btn" data-action="menu">Return to title</button></section>`;}
  else if(view==='library')root.innerHTML=library();
  else if(view==='ledger')root.innerHTML=ledger();
  else if(view==='manual')root.innerHTML=manual();
  else if(engine.done())root.innerHTML=ending();
  else if(engine.run?.status==='floor')root.innerHTML=floor();
  else if(engine.run?.status==='reward')root.innerHTML=reward();
  else if(engine.run&&engine.result)root.innerHTML=room();
  else if(engine.run?.status==='playing')root.innerHTML=room();
  else root.innerHTML=menu();
  scrollTo({top:0,behavior:'instant'});
 }
 function bind(){
  root.addEventListener('click',e=>{
   const a=e.target.closest('[data-answer]');if(a){call(()=>engine.answer(Number(a.dataset.answer)));requestAnimationFrame(()=>$('#feedback')?.scrollIntoView({behavior:'smooth',block:'start'}));return;}
   const perk=e.target.closest('[data-perk]');if(perk){call(()=>engine.perk(perk.dataset.perk));return;}
   const filter=e.target.closest('[data-filter]');if(filter){practice(filter.dataset.filter);return;}
   const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
   if(action==='start'||action==='mixed')practice('mixed');
   else if(action==='new-confirm'){if(confirm('Replace your saved descent? Topic mastery stays saved.'))call(()=>engine.start());}
   else if(action==='resume')call(()=>engine.resume());
   else if(action==='menu'){view='menu';render();}
   else if(action==='manual'){view='manual';render();}
   else if(action==='library'){view='library';render();}
   else if(action==='ledger'){view='ledger';render();}
   else if(action==='enter-floor')call(()=>engine.enterFloor());
   else if(action==='next')call(()=>engine.next());
      else if(action==='nemesis'){if(!engine.profile.nemeses.length)toast('No nemeses yet. Try a mixed descent.');else practice('nemesis');}
   else if(action==='reset'){if(b.dataset.confirmed!=='yes'){b.dataset.confirmed='yes';b.textContent='Tap again to permanently reset game data';return;}call(()=>engine.reset());view='menu';render();}
  });
  root.addEventListener('change',e=>{if(e.target.id==='objective-select'&&e.target.value)practice(e.target.value);});
  $('#manual-btn').onclick=()=>{view=view==='manual'?'menu':'manual';render();};
  document.addEventListener('keydown',e=>{if(!e.target.closest('input,textarea,select')&&engine?.run?.status==='playing'&&!engine.result&&/^[1-4]$/.test(e.key))root.querySelector(`[data-answer="${Number(e.key)-1}"]`)?.click();});
 }
 return{init,render,debug:()=>({engine,view,all,cases})};
})();
window.SignalPerks={patch:{name:'Clean Patch',icon:'✚',desc:'Restore 45 HP, up to 100.'},ward:{name:'Spanning Ward',icon:'◇',desc:'Negate the next HP loss.'},lens:{name:'Tracer Lens',icon:'◉',desc:'Cross out one wrong choice on two encounters.'},battery:{name:'Reserve Cell',icon:'♥',desc:'Gain a life (max 5) and restore 15 HP.'}};
