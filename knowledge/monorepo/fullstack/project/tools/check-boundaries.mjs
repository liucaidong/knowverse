import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePaths = ['packages/contracts','packages/domain','apps/api','apps/web','apps/mobile'];
const rules = {
  '@kv/contracts': new Set(),
  '@kv/domain': new Set(['@kv/contracts']),
  '@kv/api': new Set(['@kv/contracts','@kv/domain']),
  '@kv/web': new Set(['@kv/contracts','@kv/domain']),
  '@kv/mobile': new Set(['@kv/contracts','@kv/domain']),
};
export function inspect() {
  const errors=[]; const nodes=[];
  for(const sub of packagePaths){
    const pkg=JSON.parse(fs.readFileSync(path.join(root,sub,'package.json')));
    nodes.push(pkg.name);
    const declared={...(pkg.dependencies||{}),...(pkg.devDependencies||{})};
    for(const [dep,range] of Object.entries(declared)) {
      if(dep.startsWith('@kv/')) {
        if(!rules[pkg.name]?.has(dep)) errors.push(`${pkg.name} -> ${dep} forbidden dependency`);
        if(range!=='workspace:*') errors.push(`${pkg.name} -> ${dep} must use workspace:*`);
      }
    }
    const src=path.join(root,sub,'src');
    if(!fs.existsSync(src))continue;
    const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const f=path.join(dir,entry.name);if(entry.isDirectory())walk(f);
      else if(/\.[cm]?[jt]sx?$/.test(entry.name)){
        const body=fs.readFileSync(f,'utf8');
        for(const m of body.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
          const dep=m[1];const name=dep.startsWith('@kv/')?dep.split('/').slice(0,2).join('/'):null;
          if(name){if(!rules[pkg.name]?.has(name))errors.push(`${sub}/${entry.name} illegal import ${name}`);
            if(!declared[name])errors.push(`${sub}/${entry.name} undeclared import ${name}`);}
          if(sub.startsWith('packages/') && (/^(node:|react-native|@nestjs\/|expo($|\/))/.test(dep)))errors.push(`${sub}/${entry.name} cannot import ${dep}`);
        }
      }
    }};walk(src);
  }
  return { errors, nodes, checked:packagePaths.length };
}
const result=inspect();
if(result.errors.length){console.error(result.errors.join('\n'));process.exitCode=1}
else console.log(`OK: ${result.checked} packages; platform/runtime boundaries respected`);
