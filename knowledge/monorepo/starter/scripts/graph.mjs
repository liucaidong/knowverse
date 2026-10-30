import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dirs = ['packages','apps'];
const entries = dirs.flatMap(dir => readdirSync(new URL('../'+dir+'/',import.meta.url),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>dir+'/'+x.name));
const nodes = entries.map(p=>{const data=JSON.parse(readFileSync(new URL('../'+p+'/package.json',import.meta.url)));return {path:p,name:data.name,depends:Object.keys(data.dependencies||{})}});
for (const node of nodes) for(const dep of node.depends) if(!nodes.some(n=>n.name===dep)) throw Error('Unknown local dependency: '+dep);
console.log('Dependency graph — consumer → dependency');
for(const node of nodes)console.log(node.name.padEnd(23), '→', node.depends.join(', ')||'(none)');
// fail-fast on cycles; a cycle cannot be topologically built
const done = new Set(), visiting = new Set(), order=[];
function visit(name){if(visiting.has(name))throw Error('Dependency cycle at '+name);if(done.has(name))return;visiting.add(name);const n=nodes.find(x=>x.name===name);for(const dep of n.depends)visit(dep);visiting.delete(name);done.add(name);order.push(name)}
for(const n of nodes)visit(n.name);
console.log('Build order:',order.join(' → '));
