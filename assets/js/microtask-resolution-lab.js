'use strict';
const frames = [
 {phase:'同步执行结束',task:'执行主脚本',detail:'执行 start、Promise.resolve(thenable) 读取 getter（输出 get）、注册各种回调，最后输出 end。此时微任务队列已有 T、F、M1；注册在 pending Promise 上的反应尚未排入队列。',queue:['T','F','M1'],log:['start','get','end'],states:{inner:'pending',p:'pending · 已 resolved(thenable)',q:'pending',r:'pending',race:'pending',all:'pending'}},
 {phase:'微任务 01',task:'T · 执行 thenable 的 then',detail:'输出 call。首先 resolve(inner)：锁定本轮解析，添加 A 任务；然后 reject(late) 被忽略，throw(thenable-throw) 也被捕获并尝试拒绝，但被忽略。',queue:['F','M1','A'],log:['call']},
 {phase:'微任务 02',task:'F · fast 兑现反应',detail:'Promise.resolve("fast") 的反应调用 race 的 resolve("fast")，于是 race 立刻 fulfilled。由于 race.then 事先注册，新的 H（race 日志回调）被排到队尾。此帧还没有输出 race fast。',queue:['M1','A','H'],states:{race:'fulfilled("fast")'}},
 {phase:'微任务 03',task:'M1 · 用户微任务',detail:'输出 M1。调用 finish(42)，inner 当场 fulfilled(42)；p 依旧 pending，因为负责接管 inner 的 A 任务尚未执行。此时再入队 M2。',queue:['A','H','M2'],log:['M1'],states:{inner:'fulfilled(42)'}},
 {phase:'微任务 04',task:'A · 接管 inner',detail:'执行 inner.then(resolveP, rejectP)。此时 inner 已 fulfilled，因而把 inner 的兑现反应 J 排到队尾；p 仍 pending。',queue:['H','M2','J']},
 {phase:'微任务 05',task:'H · race 的输出回调',detail:'输出 race fast。这是之前 F 帧 race fulfilled 后安排的后续 .then 回调，不是 race 在本帧才 fulfilled。',queue:['M2','J'],log:['race fast']},
 {phase:'微任务 06',task:'M2 · 嵌套微任务',detail:'输出 M2。此时负责把 42 交给 p 的 J 尚在队列中，p 仍 pending。',queue:['J'],log:['M2']},
 {phase:'微任务 07',task:'J · inner 的兑现反应',detail:'J 调用 resolveP(42)，p 终于变成 fulfilled(42)。依照先前注册顺序，先入队 P（用户 p.then），再入队 R（race 监听 p 的反应）。',queue:['P','R'],states:{p:'fulfilled(42)'}},
 {phase:'微任务 08',task:'P · p.then 回调',detail:'输出 p 42，然后 throw Error("chain")，因此 q 被 rejected。q 的 catch 反应 C 比 allSettled 的 q 反应 Q 更早注册，按顺序添加 C、Q。',queue:['R','C','Q'],log:['p 42'],states:{q:'rejected(Error("chain"))'}},
 {phase:'微任务 09',task:'R · race 再次尝试解析',detail:'监听 p 的 race 内部反应尝试以 42 来 resolve(race)，但 race 已经 fulfilled("fast")，所以这次调用没有效果，也没有新日志。',queue:['C','Q']},
 {phase:'微任务 10',task:'C · q.catch 回调',detail:'输出 catch chain，返回 "recovered"，所以 r 变成 fulfilled("recovered")。已注册的 allSettled 的 r 反应 Ar 入队。',queue:['Q','Ar'],log:['catch chain'],states:{r:'fulfilled("recovered")'}},
 {phase:'微任务 11',task:'Q · allSettled 记录 q',detail:'记录数组索引 0：q rejected，reason 是 Error("chain")。另一项 r 尚未由 allSettled 内部反应收集，因此 allSettled 仍 pending。',queue:['Ar']},
 {phase:'微任务 12',task:'Ar · allSettled 记录 r',detail:'记录数组索引 1：r fulfilled，value 为 "recovered"。两项齐全，allSettled 返回的 Promise fulfilled，排入用户输出回调 L。',queue:['L'],states:{all:'fulfilled([rejected, fulfilled])'}},
 {phase:'微任务 13',task:'L · allSettled 输出回调',detail:'输出 all rejected,fulfilled。数组结果依输入顺序 [q,r] 排列，而不是按谁先结算排序。',queue:[],log:['all rejected,fulfilled']},
 {phase:'宏任务',task:'timer · setTimeout 回调',detail:'全部微任务都处理完后，执行 setTimeout(..., 0) 回调，输出 timer。',queue:[],log:['timer']}
];
const expected=['start','get','end','call','M1','race fast','M2','p 42','catch chain','all rejected,fulfilled','timer'];
const labels={inner:'inner',p:'p',q:'q',r:'r',race:'race',all:'allSettled'};
let index=0,handle=null;
const el=id=>document.getElementById(id);
function paint(){
 const f=frames[index],status={},logs=[];
 for(let i=0;i<=index;i++){Object.assign(status,frames[i].states||{});logs.push(...(frames[i].log||[]));}
 el('number').textContent=`${String(index+1).padStart(2,'0')} / ${frames.length}`;
 el('phase').textContent=f.phase;el('task').textContent=f.task;el('detail').textContent=f.detail;
 el('bar').style.width=`${((index+1)/frames.length)*100}%`;
 el('range').value=index;
 el('queue').replaceChildren();
 if(!f.queue.length){const n=document.createElement('span');n.className='empty';n.textContent='队列为空';el('queue').append(n)}
 else for(const j of f.queue){const n=document.createElement('span');n.className='job';n.textContent=j;el('queue').append(n)}
 el('statuses').replaceChildren();
 for(const key of Object.keys(labels)){
   const card=document.createElement('div');card.className='status';
   const h=document.createElement('strong');h.textContent=labels[key];
   const s=document.createElement('span');s.textContent=status[key];s.className=(status[key]||'').startsWith('fulfilled')?'fulfilled':(status[key]||'').startsWith('rejected')?'rejected':'pending';
   card.append(h,s);el('statuses').append(card)
 }
 const out=el('output');out.replaceChildren();
 for(let i=0;i<logs.length;i++){
  const line=document.createElement('div');if(i===logs.length-1)line.className='latest';line.textContent=logs[i];out.append(line)
 }
 el('prev').disabled=index===0;el('next').disabled=index===frames.length-1;
}
function stop(){if(handle!==null){clearInterval(handle);handle=null;}el('auto').textContent='自动播放'}
function advance(step){index=Math.max(0,Math.min(frames.length-1,step));paint();if(index===frames.length-1)stop()}
el('prev').addEventListener('click',()=>{stop();advance(index-1)});
el('next').addEventListener('click',()=>{stop();advance(index+1)});
el('reset').addEventListener('click',()=>{stop();advance(0)});
el('range').addEventListener('input',e=>{stop();advance(+e.target.value)});
el('auto').addEventListener('click',()=>{
 if(handle!==null){stop();return;}if(index===frames.length-1)advance(0);
 el('auto').textContent='暂停';handle=setInterval(()=>advance(index+1),1350)
});
document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON')return;if(e.key==='ArrowRight'){stop();advance(index+1)}else if(e.key==='ArrowLeft'){stop();advance(index-1)}});
const originalCode=`(() => {
  let finish;
  const inner = new Promise(resolve => { finish = resolve; });
  const thenable = {
    get then() {
      console.log("get");
      return (resolve, reject) => {
        console.log("call");
        resolve(inner);
        reject(new Error("late"));
        throw new Error("thenable-throw");
      };
    }
  };
  console.log("start");
  const p = Promise.resolve(thenable);
  const q = p.then(value => {
    console.log("p", value);
    throw new Error("chain");
  });
  const r = q.catch(error => {
    console.log("catch", error.message);
    return "recovered";
  });
  Promise.race([p, Promise.resolve("fast")])
    .then(value => console.log("race", value));
  Promise.allSettled([q, r]).then(results => {
    console.log("all", results.map(x => x.status).join(","));
  });
  queueMicrotask(() => {
    console.log("M1");
    finish(42);
    queueMicrotask(() => console.log("M2"));
  });
  setTimeout(() => console.log("timer"), 0);
  console.log("end");
})();`;
el('source').textContent=originalCode;
// 实际运行对照：将日志输出器改成本地的 record，不改变 Promise/microtask/timer 控制流。
el('verify').addEventListener('click',()=>{
 const seen=[],record=(...args)=>seen.push(args.map(String).join(' '));
 el('validation').textContent='正在执行真实 Promise/queueMicrotask/setTimeout 回调…';
 (()=>{
  let finish;
  const inner=new Promise(resolve=>{finish=resolve});
  const thenable={get then(){record('get');return(resolve,reject)=>{record('call');resolve(inner);reject(new Error('late'));throw new Error('thenable-throw')}}};
  record('start');
  const p=Promise.resolve(thenable);
  const q=p.then(value=>{record('p',value);throw new Error('chain')});
  const r=q.catch(error=>{record('catch',error.message);return 'recovered'});
  Promise.race([p,Promise.resolve('fast')]).then(value=>record('race',value));
  Promise.allSettled([q,r]).then(results=>record('all',results.map(x=>x.status).join(',')));
  queueMicrotask(()=>{record('M1');finish(42);queueMicrotask(()=>record('M2'))});
  setTimeout(()=>{record('timer');
   const ok=seen.length===expected.length&&seen.every((x,i)=>x===expected[i]);
   el('validation').textContent=(ok?'✅ 实际执行与校正后的 11 行日志完全一致':'❌ 实际执行与预期不一致')+'\n'+seen.join('\n');
  },0);
  record('end');
 })();
});
paint();
