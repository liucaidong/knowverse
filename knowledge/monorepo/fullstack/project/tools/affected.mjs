import { execFileSync } from 'node:child_process';
const changed=process.argv.slice(2).filter(x=>!x.startsWith('--'));
const files=changed.length?changed:execFileSync('git',['diff','--name-only','HEAD~1','HEAD'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const deps={contracts:[],domain:['contracts'],api:['domain','contracts'],web:['domain','contracts'],mobile:['domain','contracts']};
const targets=new Set();
for(const file of files){
 if(/^(pnpm-workspace.yaml|package.json|pnpm-lock.yaml|tsconfig.base.json)/.test(file)){Object.keys(deps).forEach(x=>targets.add(x));continue}
 const m=/^(packages|apps)\/([^/]+)\//.exec(file);if(m)targets.add(m[2]);
}
let changedCount=0;do{changedCount=targets.size;for(const [node,needs] of Object.entries(deps))if(needs.some(x=>targets.has(x)))targets.add(node)}while(targets.size!==changedCount);
console.log(JSON.stringify({files,affected:[...targets].sort()},null,2));
