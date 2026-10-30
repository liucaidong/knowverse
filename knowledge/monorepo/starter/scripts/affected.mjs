import { readdirSync, readFileSync } from 'node:fs';
const dirs=['packages','apps'];const nodes=dirs.flatMap(dir=>readdirSync(new URL('../'+dir+'/',import.meta.url),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>{const folder=dir+'/'+x.name;const pkg=JSON.parse(readFileSync(new URL('../'+folder+'/package.json',import.meta.url)));return {folder,name:pkg.name,deps:Object.keys(pkg.dependencies||{})}}));
const changed=process.argv.slice(2);if(!changed.length){console.error('Usage: node scripts/affected.mjs packages/contracts/src/index.ts');process.exitCode=2}else{
const owners=new Set(changed.flatMap(f=>nodes.filter(n=>f===n.folder||f.startsWith(n.folder+'/')).map(n=>n.name)));
if(changed.some(f=>!nodes.some(n=>f.startsWith(n.folder+'/'))))for(const n of nodes)owners.add(n.name); // safe fallback for root config changes
const affected=new Set(owners);let advanced=true;while(advanced){advanced=false;for(const n of nodes)if(!affected.has(n.name)&&n.deps.some(d=>affected.has(d))){affected.add(n.name);advanced=true}}
console.log(JSON.stringify({changed,owners:[...owners].sort(),affected:[...affected].sort()},null,2));
}
