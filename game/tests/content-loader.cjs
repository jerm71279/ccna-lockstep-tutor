const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const c={window:undefined};c.window=c;vm.createContext(c);
for(const f of ['objectives.js','manifest.js','loader.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),c);
for(const src of c.SK_MANIFEST){
 vm.runInContext(fs.readFileSync(path.join(root,'scenarios',src),'utf8'),c);
 vm.runInContext(fs.readFileSync(path.join(root,'encounters',src),'utf8'),c);
}
module.exports={scenarios:c.SK_MODULES.flatMap(m=>m.entries),cases:c.SK_CASES,...require(path.join(root,'engine.js'))};
