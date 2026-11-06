'use strict';
/** Rules only: encounter queue, damage, rewards, persistence. UI lives in ui.js. */
const SK_PERKS={patch:{name:'Clean Patch',icon:'✚',desc:'Restore 45 HP, up to 100.'},ward:{name:'Spanning Ward',icon:'◇',desc:'Negate the next HP loss.'},lens:{name:'Tracer Lens',icon:'◉',desc:'Cross out one wrong choice on two encounters.'},battery:{name:'Reserve Cell',icon:'♥',desc:'Gain a life (max 5) and restore 15 HP.'}};
const SK_FLOORS=[['The Access Vaults','Switching & first hops'],['The Routed Deep','Routing, services & filtering'],['The Core Signal','Resilience & programmability']];
class SignalEngine {
 constructor(scenarios,cases,storage,random=Math.random){this.s=scenarios;this.cases=cases;this.storage=storage;this.random=random;this.key='signal-keep-v1';this.profile={...this.blank(),...(this.read('')||{})};this.profile.nemeses=(Array.isArray(this.profile.nemeses)?this.profile.nemeses:[]).filter(id=>this.byId(id));this.profile.seen=Array.isArray(this.profile.seen)?this.profile.seen.filter(id=>this.byId(id)):[];this.profile.topics=this.profile.topics&&typeof this.profile.topics==='object'?this.profile.topics:{};this.run=null;this.result=null;}
 blank(){return{topics:{},seen:[],nemeses:[],runs:0,wins:0,bosses:0,bestFloor:0,bestScore:0};}
 read(s=''){try{const x=JSON.parse(this.storage.getItem(this.key+s)||'null');return x&&typeof x==='object'?x:null;}catch{return null;}}
 saveProfile(){try{this.storage.setItem(this.key,JSON.stringify(this.profile));}catch{}}
 saveRun(){if(this.run){const r={run:this.run,result:this.result};try{this.storage.setItem(this.key+':run',JSON.stringify(r));}catch{}}}
 savedRun(){
  const snap=this.read(':run');if(!snap||!snap.run)return null;const r=snap.run;
  if(r.version!==1||!['floor','playing','reward'].includes(r.status)||!['run','drill'].includes(r.kind)||!Number.isInteger(r.floor)||r.floor<0||r.floor>2||!Array.isArray(r.floors)||r.floors.length!==3||r.floors.some(f=>!Array.isArray(f)||!f.length||(r.kind==='run'&&f.length!==5)||f.some(id=>!this.byId(id)))||!Number.isInteger(r.index)||r.index<0||r.index>4||!Number.isInteger(r.hp)||r.hp<1||r.hp>100||!Number.isInteger(r.lives)||r.lives<1||r.lives>5||!Array.isArray(r.queue)||!r.queue.length||!r.queue.every(e=>e&&typeof e==='object'&&typeof e.id==='string'&&!!this.byId(e.id)&&typeof e.revenge==='boolean')||!Array.isArray(r.recovered)||!r.recovered.every(id=>this.byId(id)))return null;
  const x=snap.result;if(x&&(typeof x.correct!=='boolean'||x.id!==r.queue[0].id||!Number.isInteger(x.choice)||x.choice<0||x.choice>3||!Number.isInteger(x.hpAfter)||typeof x.avenger!=='boolean'||x.avenger!==r.queue[0].revenge))return null;
  this.run=r;this.result=x||null;return snap;
 }

 byId(id){return this.s.find(s=>s.id===id);}
 isNemesis(id){return this.profile.nemeses.includes(id);}
 clearSaved(){try{this.storage.removeItem(this.key+':run');}catch{}}
 shuffle(a){a=[...a];for(let i=a.length-1;i;i--){const j=Math.floor(this.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 rank(){return this.shuffle(this.s).sort((a,b)=>+this.isNemesis(b.id)-+this.isNemesis(a.id)||+this.profile.seen.includes(a.id)-+this.profile.seen.includes(b.id));}
 entry(id,revenge=false){return{id,revenge};}
 start(){const floor=this.rank();if(floor.length<15)throw Error('Fifteen scenarios required');this.newRun('run',[0,1,2].map(n=>floor.slice(n*5,n*5+5).map(s=>s.id)),'floor');this.run.queue=this.run.floors[0].map(id=>this.entry(id));this.schedule();this.saveRun();return this.state();}
 startDrill(ids){const chosen=this.shuffle([...new Set(ids)]).map(id=>this.byId(id)).filter(Boolean);if(!chosen.length)throw Error('No matching scenarios');this.newRun('drill',[0,1,2].map(()=>chosen.map(s=>s.id)),'playing');this.run.queue=chosen.map(s=>this.entry(s.id));this.schedule();this.saveRun();return this.state();}
 newRun(kind,floors,status){this.run={version:1,kind,floors,floor:0,index:0,queue:[],hp:100,lives:3,score:0,clears:0,bosses:0,ward:0,lens:0,lensUsed:0,recovered:[],perksChosen:[],status};this.result=null;this.profile.runs++;this.saveProfile();}
 schedule(){const r=this.run;/* One rematch for each known weak case at the end of this group. */const ids=[...new Set(r.queue.map(x=>x.id))].filter(id=>this.isNemesis(id));for(const id of ids)if(!r.queue.some(x=>x.id===id&&x.revenge))r.queue.push(this.entry(id,true));}
 currentEntry(){return this.run?.queue[0]||null;}
 currentId(){return this.currentEntry()?.id||null;}
 current(){return this.byId(this.currentId());}
 avenger(){return!!this.currentEntry()?.revenge;}
 answer(choice){const r=this.run,item=this.currentEntry();if(!r||this.result||r.status!=='playing'||!item||!Number.isInteger(choice)||choice<0||choice>3)throw Error('Choose an available repair');const s=this.current(),correct=choice===this.cases[item.id].answer,before=r.hp;
  const st=this.profile.topics[s.id]||{t:0,c:0};st.t++;if(correct)st.c++;this.profile.topics[s.id]=st;if(!this.profile.seen.includes(s.id))this.profile.seen.push(s.id);
  let wardUsed=false,lifeLost=false;
  if(correct){if(item.revenge){this.profile.nemeses=this.profile.nemeses.filter(id=>id!==s.id);if(!r.recovered.includes(s.id))r.recovered.push(s.id);}r.clears++;r.score+=(item.revenge?80:0)+(r.kind==='run'&&r.index===4?240:100);}
  else{
   if(!this.isNemesis(s.id))this.profile.nemeses.push(s.id);
   if(!item.revenge)r.queue.push(this.entry(s.id,true));
   if(r.ward){r.ward--;wardUsed=true;}else{const damage=item.revenge?40:(r.kind==='run'&&r.index===4?35:25);r.hp=Math.max(0,r.hp-damage);if(!r.hp){r.lives--;lifeLost=true;if(r.lives)r.hp=100;}}
  }
  if(r.lens)r.lensUsed++;
  this.result={id:s.id,choice,correct,avenger:item.revenge,wardUsed,hpBefore:before,hpAfter:r.hp,livesAfter:r.lives,lifeLost};this.saveProfile();this.saveRun();return this.state();
 }
 next(){
  const r=this.run;if(!r||!this.result)throw Error('Read the current repair first');
  if(r.lives===0){r.status='defeat';this.profile.bestScore=Math.max(r.score,this.profile.bestScore);this.result=null;this.clearSaved();this.saveProfile();return this.state();}
  r.queue.shift();if(r.kind==='run'&&!this.result.avenger)r.index++;
  this.result=null;
  if(!r.queue.length){
   if(r.kind==='drill'){r.status='drill-complete';this.clearSaved();}
   else{
    r.bosses++;this.profile.bosses++;this.profile.bestFloor=Math.max(this.profile.bestFloor,r.floor+1);
    r.status=r.floor===2?'victory':'reward';
    if(r.status==='victory'){r.score+=r.hp*5+r.lives*250;this.profile.wins++;this.profile.bestFloor=3;this.profile.bestScore=Math.max(r.score,this.profile.bestScore);this.clearSaved();}
   }
  }
  this.saveProfile();this.saveRun();return this.state();
 }

 enterFloor(){if(this.run?.status==='floor'){this.run.status='playing';if(!this.run.queue.length){this.run.queue=this.run.floors[this.run.floor].map(id=>this.entry(id));this.schedule();}this.saveRun();}return this.state();}
 perk(key){const r=this.run;if(!r||r.status!=='reward'||!SK_PERKS[key])throw Error('Invalid reward');if(key==='patch')r.hp=Math.min(100,r.hp+45);if(key==='ward')r.ward++;if(key==='lens'){r.lens++;r.lensUsed=0;}if(key==='battery'){r.lives=Math.min(5,r.lives+1);r.hp=Math.min(100,r.hp+15);}r.perksChosen.push(key);r.floor++;r.index=0;r.recovered=[];r.queue=r.floors[r.floor].map(id=>this.entry(id));r.status='floor';this.schedule();this.saveProfile();this.saveRun();return this.state();}
 resume(){const r=this.savedRun();if(!r)throw Error('No saved run');this.run=r.run;this.result=r.result||null;return this.state();}
 done(){return['victory','defeat','drill-complete'].includes(this.run?.status);}
 reset(){this.profile=this.blank();this.run=null;this.result=null;this.clearSaved();this.saveProfile();return this.state();}
 state(){return structuredClone({profile:this.profile,run:this.run,result:this.result,current:this.current(),evidence:this.currentId()?this.cases[this.currentId()]:null,avenger:this.avenger(),currentId:this.currentId(),floors:SK_FLOORS,perks:SK_PERKS});}
}
class SignalMemoryStorage{constructor(){this.data=new Map();}getItem(k){return this.data.has(k)?this.data.get(k):null;}setItem(k,v){this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}}

if(typeof window!=='undefined'){window.SK_FLOORS=SK_FLOORS;window.SignalPerks=SK_PERKS;window.SignalEngine=SignalEngine;window.SignalMemoryStorage=SignalMemoryStorage;}
if(typeof module!=='undefined')module.exports={SignalEngine,SignalMemoryStorage};
