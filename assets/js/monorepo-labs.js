(()=>{'use strict';
const host=document.querySelector('[data-lab]');if(!host)return;
const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if(host.dataset.lab==='graph'){
 const nodes=[{id:'contracts',name:'contracts',x:325,y:75,deps:[]},{id:'domain',name:'domain',x:325,y:205,deps:['contracts']},{id:'ui',name:'ui-adapter',x:530,y:205,deps:['contracts']},{id:'web',name:'web',x:520,y:340,deps:['domain','ui']},{id:'mobile',name:'mobile',x:120,y:340,deps:['contracts','ui']},{id:'api',name:'api',x:325,y:340,deps:['domain']}];
 const selected=()=> $('package').value;
 function closure(start){const out=new Set([start]);let changed=true;while(changed){changed=false;for(const n of nodes)if(!out.has(n.id)&&n.deps.some(d=>out.has(d))){out.add(n.id);changed=true;}}return out}
 function calculate(){const kind=$('change-kind').value,mode=$('affected-mode').value,source=selected();const direct=kind==='root'?new Set(nodes.map(n=>n.id)):new Set([source]);const affected=kind==='root'?direct:closure(source);
 const tasks=[];for(const n of nodes){if(!affected.has(n.id))continue;
  const kindTask=mode==='project'?['build','test','lint']:kind==='test'?['test']:kind==='source'?['build','test','lint']:['build','test','lint'];
  for(const task of kindTask)tasks.push(n.id+':'+task);
 }
 const reason=kind==='root'?'全局配置：保守选择所有项目':kind==='test'?'测试文件不改变生产产物；示例 task 模式只选择 test':'生产源码变化：沿反向依赖边传播';
 return {kind,mode,source,affected:[...affected],tasks,reason,direct:[...direct]};}
 function svg(info){const ids=new Set(info.affected);const lines=nodes.flatMap(n=>n.deps.map(dep=>{const d=nodes.find(q=>q.id===dep);const active=ids.has(n.id)&&ids.has(dep);return `<path d="M${n.x} ${n.y-24} C${n.x} ${n.y-64} ${d.x} ${d.y+64} ${d.x} ${d.y+24}" fill="none" stroke="${active?'#8cf0d5':'#406979'}" stroke-width="${active?3:1.7}" marker-end="url(#arr)" opacity="${active?1:.62}"/>`;})).join('');const ns=nodes.map(n=>{const active=ids.has(n.id),self=info.source===n.id;return `<g role="button" tabindex="0" data-node="${n.id}" class="node" aria-label="选择 ${n.name} 包"><circle cx="${n.x}" cy="${n.y}" r="43" fill="${self?'#0d877e':active?'#255c5c':'#193f4c'}" stroke="${active?'#a8f7d6':'#5f8795'}"/><text x="${n.x}" y="${n.y+5}" text-anchor="middle" font-family="system-ui" font-size="14" font-weight="700" fill="#f2fffc">${n.name}</text></g>`}).join('');return `<svg viewBox="0 0 650 430" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="消费者指向提供者的依赖图；选中节点与受影响项目高亮"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#88dec9" stroke-width="1.4"/></marker></defs><text x="18" y="26" fill="#b4d7dc" font-size="12">箭头：消费者 → 提供者；高亮：受影响集合</text>${lines}${ns}</svg>`}
 let evidence=null;function render(){evidence=calculate();$('graph').innerHTML=svg(evidence);$('result-projects').textContent=`直接变化：${evidence.direct.join(', ')}\n受影响项目：${evidence.affected.join(', ')}\n\n原因：${evidence.reason}`;$('result-tasks').textContent=evidence.tasks.join('\n')+'\n\n合计 '+evidence.tasks.length+' 个任务';$('graph').querySelectorAll('[data-node]').forEach(el=>{const choose=()=>{$('package').value=el.dataset.node;render()};el.addEventListener('click',choose);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}})});}
 ['package','change-kind','affected-mode'].forEach(id=>$(id).addEventListener('change',render));$('copy-evidence').onclick=()=>{const content=JSON.stringify(evidence,null,2);if(navigator.clipboard?.writeText){navigator.clipboard.writeText(content).then(()=>{$('copy-evidence').textContent='已复制证据 ✓'}).catch(()=>{$('copy-evidence').textContent='复制受限，请查看下方结果'})}else{$('copy-evidence').textContent='当前浏览器无法直接复制';} };render();
}
if(host.dataset.lab==='cache'){
 const cache=new Map(),s=$('source-ver'),env=$('env-mode'),include=$('include-env');
 // A deterministic teaching hash, not secure and not fit for production cache keys.
 function hash(str){let v=2166136261;for(let i=0;i<str.length;i++){v=Math.imul(v^str.charCodeAt(i),16777619)}return (v>>>0).toString(16).padStart(8,'0')}
 function run(){const inputs={source:s.value,task:'build',toolchain:'teaching-v1'};if(include.checked)inputs.MODE=env.value;const key=hash(JSON.stringify(inputs));let record=cache.get(key),status=record?'HIT':'MISS';if(!record){record={artifact:`artifact(${s.value}, MODE=${env.value})`,mode:env.value,source:s.value};cache.set(key,record)}const expected=`artifact(${s.value}, MODE=${env.value})`;const ok=record.artifact===expected;
 $('cache-inputs').textContent=JSON.stringify(inputs,null,2)+`\nKEY=${key}\nCACHE SIZE=${cache.size}`;
 $('cache-result').textContent=`缓存：${status}\n恢复产物：${record.artifact}\n正确应为：${expected}\n结论：${ok?'✅ 产物与当前输入匹配':'❌ 错误命中：环境输入被遗漏'}`;}
 $('run-cache').onclick=run;$('clear-cache').onclick=()=>{cache.clear();$('cache-inputs').textContent='缓存已清空';$('cache-result').textContent='缓存为空。重新运行 build。'};
 $('cache-inputs').textContent='勾选 MODE 纳入缓存键，执行 alpha；取消勾选后清空缓存，再执行 alpha → beta，观察错误命中。';
}
if(host.dataset.lab==='build'){
 const steps=[['Step 0 · 源码与引用','三个项目：contracts、domain、api；api 引用 domain，domain 引用 contracts。','未生成任何产物。'],['Step 1 · 编译 contracts','启用 composite + declaration，写出 contracts/dist/index.d.ts 和 index.js。','contracts:build → dist/index.d.ts + dist/index.js'],['Step 2 · 编译 domain','domain 消费 contracts 的声明产物，TS 会检查导入类型；再写出 domain 的声明和 JS。','domain:build → 读取 contracts 类型 → dist/index.d.ts'],['Step 3 · 编译 api','api 消费 domain 的公开包入口；若 domain 声明不兼容，应该在这里失败。','api:build → 读取 domain 类型 → dist/index.js'],['Step 4 · 运行入口','Node 根据包 exports 加载 JS，而不是读取 .d.ts；这是与 TypeScript 检查不同的合同。','node apps/api/dist/index.js → api adapter demo: average = 90'],['Step 5 · 变化检验','修改 contracts 的类型后，再执行 tsc -b。图中的所有下游项目都可能需要重新检查。','tsc -b --verbose → contracts → domain → api；按需跳过未变产物']];let pos=0;
 function render(){ $('build-steps').innerHTML=steps.map((s,i)=>`<div class="lab-step ${i===pos?'current':''}" ${i>pos?'style="opacity:.35"':''}><strong>${escape(s[0])}</strong>${i<=pos?`<p>${escape(s[1])}</p>`:''}</div>`).join('');$('build-evidence').textContent=steps[pos][2];$('build-next').disabled=pos===steps.length-1;}
 $('build-next').onclick=()=>{if(pos<steps.length-1)pos++;render()};$('build-reset').onclick=()=>{pos=0;render()};render();
}
})();
