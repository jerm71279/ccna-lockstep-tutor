'use strict';
(async()=>{try{const scenarios=await window.loadGameModules();SK_APP.init(scenarios,window.SK_CASES);}catch(e){document.querySelector('#app').textContent='Game module error: '+e.message;}})();
