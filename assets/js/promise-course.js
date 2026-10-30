(()=>{'use strict';
const source=document.getElementById('sample-source');
for(const b of document.querySelectorAll('.copy-snippet'))b.addEventListener('click',async()=>{
 const code=b.parentElement.querySelector('code')?.textContent||'';
 try{await navigator.clipboard.writeText(code);b.textContent='已复制';setTimeout(()=>b.textContent='复制代码',1200)}catch(e){b.textContent='请手动选择复制'}
});
if(!source)return;
const q=id=>document.getElementById(id);
const cases={
 chain:{code:`console.log('start');
Promise.resolve()
  .then(() => console.log('one'))
  .then(() => console.log('two'));
queueMicrotask(() => console.log('M'));
console.log('end');`,expected:['start','end','one','M','two'],steps:[
 ['同步输出 start',[],['start']],
 ['Promise 已兑现，then(one) 的 Job 入队',['Reaction: one'],['start']],
 ['下游 then(two) 注册在 pending Promise',['Reaction: one'],['start']],
 ['queueMicrotask(M) 入队',['Reaction: one','Microtask: M'],['start']],
 ['同步输出 end',['Reaction: one','Microtask: M'],['start','end']],
 ['执行 one；下游兑现并把 two 入队',['Microtask: M','Reaction: two'],['start','end','one']],
 ['执行 M',['Reaction: two'],['start','end','one','M']],
 ['执行 two：队列清空',[],['start','end','one','M','two']]
 ],run:log=>{log('start');Promise.resolve().then(()=>log('one')).then(()=>log('two'));queueMicrotask(()=>log('M'));log('end')}} ,
 thenable:{code:`const t = {
  get then() {
    console.log('get');
    return resolve => {
      console.log('call');
      resolve(42);
    };
  }
};
console.log('start');
Promise.resolve(t).then(v => console.log('value',v));
console.log('end');`,expected:['start','get','end','call','value 42'],steps:[
 ['同步输出 start',[],['start']],
 ['同步读取 getter → get；入队 ResolveThenableJob',['ResolveThenableJob'],['start','get']],
 ['then(value) 注册；源 Promise 尚未落定',['ResolveThenableJob'],['start','get']],
 ['同步输出 end',['ResolveThenableJob'],['start','get','end']],
 ['执行 thenable Job：call → resolve(42) → 反应入队',['Reaction: value'],['start','get','end','call']],
 ['执行 value 反应，清空队列',[],['start','get','end','call','value 42']]
 ],run:log=>{const t={get then(){log('get');return resolve=>{log('call');resolve(42)}}};log('start');Promise.resolve(t).then(v=>log('value '+v));log('end')}} ,
 queue:{code:`console.log('A');
Promise.resolve().then(() => {
  console.log('B');
  queueMicrotask(() => console.log('D'));
});
queueMicrotask(() => console.log('C'));
console.log('E');`,expected:['A','E','B','C','D'],steps:[
 ['同步输出 A',[],['A']],
 ['then(B) 的 Job 入队',['Reaction: B'],['A']],
 ['queueMicrotask(C) 入队',['Reaction: B','Microtask: C'],['A']],
 ['同步输出 E',['Reaction: B','Microtask: C'],['A','E']],
 ['执行 B，此时才将 D 入队',['Microtask: C','Microtask: D'],['A','E','B']],
 ['执行 C',['Microtask: D'],['A','E','B','C']],
 ['执行 D：队列清空',[],['A','E','B','C','D']]
 ],run:log=>{log('A');Promise.resolve().then(()=>{log('B');queueMicrotask(()=>log('D'))});queueMicrotask(()=>log('C'));log('E')}}
};
let selected='chain',frame=-1,runNumber=0;
const select=q('scenario'),code=q('sample-source'),label=q('frame'),event=q('event'),jobs=q('jobs'),logs=q('logs'),result=q('native-output');
function show(){const c=cases[selected];code.textContent=c.code;const x=frame<0?['点击「单步下一帧」开始',[],[]]:c.steps[frame];label.textContent='FRAME '+String(frame+1).padStart(2,'0')+' / '+String(c.steps.length).padStart(2,'0');event.textContent=x[0];jobs.textContent='';if(x[1].length)x[1].forEach(v=>{let span=document.createElement('span');span.textContent=v;jobs.append(span)});else jobs.textContent='队列为空';logs.textContent=x[2].join(' → ')||'尚无输出';q('step').disabled=frame>=c.steps.length-1;}
function reset(){frame=-1;result.textContent='先尝试预测，再使用原生执行校验。';show()}
select.addEventListener('change',()=>{selected=select.value;runNumber++;reset()});q('step').onclick=()=>{if(frame<cases[selected].steps.length-1)frame++;show()};q('restart').onclick=reset;
q('native').onclick=()=>{const n=++runNumber,record=[],c=cases[selected];result.textContent='正在使用浏览器原生 Promise 执行…';try{c.run(x=>record.push(x));setTimeout(()=>{if(n!==runNumber)return;const ok=JSON.stringify(record)===JSON.stringify(c.expected);result.textContent='实际输出：'+record.join(' → ')+'\n预期输出：'+c.expected.join(' → ')+'\n'+(ok?'✓ 原生结果与逐帧模型一致':'✕ 与预期不一致，请检查浏览器环境');},0)}catch(e){result.textContent='原生执行异常：'+e.message}};
reset();
})();
