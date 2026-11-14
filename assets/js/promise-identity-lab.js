'use strict';
const lines = [
  '(() => {',
  '  const inner = Promise.resolve(42);',
  '',
  '  const a = Promise.resolve(inner);',
  '  const b = new Promise(resolve => resolve(inner));',
  '',
  '  console.log("same", a === inner, b === inner);',
  '',
  '  a.then(value => console.log("A", value));',
  '  b.then(value => console.log("B", value));',
  '',
  '  queueMicrotask(() => console.log("M"));',
  '})();'
];
const expected = ['same true false','A 42','M','B 42'];
// Frames describe the queue *after* each action. T = PromiseResolveThenableJob;
// J = PromiseReactionJob registered by the internal then(inner).
const frames = [
  {title:'准备执行：建立基准',phase:'sync',line:1,queue:[],inner:'none',a:'none',b:'none',logs:[],tags:['尚未创建 Promise','队列为空'],detail:'点击 <strong>下一步</strong>，从同步代码开始。注意：<strong>队列展示的是当前步骤执行完成以后，仍待执行的任务</strong>。'},
  {title:'inner 立即兑现为 42',phase:'sync',line:2,queue:[],inner:'ok',a:'none',b:'none',logs:[],tags:['同步执行','inner = fulfilled(42)'],detail:'<code>Promise.resolve(42)</code> 创建一个已经 <strong>fulfilled(42)</strong> 的原生 Promise。此时没有任何可执行的回调，所以微任务队列仍为空。'},
  {title:'a 直接复用 inner 的身份',phase:'sync',line:4,queue:[],inner:'ok',a:'ok',b:'none',logs:[],tags:['同步执行','a === inner 为 true'],detail:'<code>Promise.resolve(inner)</code> 发现 <code>inner</code> 本身就是构造器匹配的原生 Promise，因此直接返回原对象：<strong>a 与 inner 是同一个对象</strong>。不存在额外的采纳任务。'},
  {title:'b 新建 Promise，开始采纳 inner',phase:'sync',line:5,queue:['T'],inner:'ok',a:'ok',b:'wait',logs:[],tags:['同步执行','入队 T','b 仍是 pending'],detail:'<code>new Promise</code> 创建了另一份对象。执行器中的 <code>resolve(inner)</code> <strong>同步调用</strong>，将 b 的命运锁定为跟随 inner，读取 inner 的 then 并安排<strong>采纳任务 T</strong>。注意：<strong>b 还没有 fulfilled</strong>。'},
  {title:'先输出身份比较结果',phase:'sync',line:7,queue:['T'],inner:'ok',a:'ok',b:'wait',logs:['same true false'],tags:['同步 console.log','b !== inner'],detail:'<code>a === inner</code> 是 <strong>true</strong>；<code>b === inner</code> 是 <strong>false</strong>，因为 b 是新建的 Promise。同步日志先出现，微任务 T 仍在等待。'},
  {title:'a.then 使 A 立即入队',phase:'sync',line:9,queue:['T','A'],inner:'ok',a:'ok',b:'wait',logs:['same true false'],tags:['同步注册 then','入队 A'],detail:'a 就是已兑现的 inner。因此对 <code>a.then(...)</code> 注册反应时，<strong>A 反应任务当场入队</strong>，排在更早的 T 后面。注意：回调此时还没有运行。'},
  {title:'b.then 仅保存 B 的反应',phase:'sync',line:10,queue:['T','A'],inner:'ok',a:'ok',b:'wait',logs:['same true false'],tags:['同步注册 then','B 尚未入队'],detail:'b 当前仍然 <strong>pending</strong>，所以 <code>b.then(...)</code> 只是在 b 上登记一个待兑现反应。<strong>这里不会把 B 放进微任务队列</strong>。'},
  {title:'queueMicrotask 将 M 入队',phase:'sync',line:12,queue:['T','A','M'],inner:'ok',a:'ok',b:'wait',logs:['same true false'],tags:['同步调用 queueMicrotask','入队 M'],detail:'<code>queueMicrotask</code> 将 M 放到队尾。当前队列严格是 <strong>T → A → M</strong>，不是 A → B → M，因为 b 尚未兑现。'},
  {title:'同步栈清空，开始微任务检查点',phase:'sync',line:13,queue:['T','A','M'],inner:'ok',a:'ok',b:'wait',logs:['same true false'],tags:['同步阶段结束','队列 T → A → M'],detail:'IIFE 的同步主体执行结束。开始按 <strong>FIFO（先进先出）</strong> 取微任务。尚未执行任何微任务时，b 依然是 pending；接下来队首 T 将被执行。'},
  {title:'执行 T：给 inner 添加内部 then',phase:'async',source:5,active:'T',queue:['A','M','J'],inner:'ok',a:'ok',b:'wait',logs:['same true false'],tags:['执行采纳任务 T','入队内部反应 J'],detail:'T 是 <strong>PromiseResolveThenableJob</strong>，它通过 inner 的 <code>then</code> 注册一对内部回调，用于兑现/拒绝 b。inner 已兑现，因此注册后生成<strong>内部反应任务 J</strong>，排到队尾。队列变成 <strong>A → M → J</strong>。T 运行完时 <strong>b 仍 pending</strong>。'},
  {title:'执行 A：输出 A 42',phase:'async',source:9,active:'A',queue:['M','J'],inner:'ok',a:'ok',b:'wait',logs:['same true false','A 42'],tags:['执行 PromiseReactionJob A','输出 A 42'],detail:'A 是 a.then 的反应任务，由于 a 本就是 inner，因此读取值 42 并输出 <strong>A 42</strong>。队列中下一个任务是 M，J 还在它后面。'},
  {title:'执行 M：输出 M',phase:'async',source:12,active:'M',queue:['J'],inner:'ok',a:'ok',b:'wait',logs:['same true false','A 42','M'],tags:['执行普通微任务 M','b 仍是 pending'],detail:'M 是 <code>queueMicrotask</code> 安排的回调。由于 M 比 J 更早入队，输出 <strong>M</strong>。此时 b 尽管早就调用过 resolve(inner)，<strong>依然 pending</strong>。'},
  {title:'执行 J：b 真正兑现，B 才入队',phase:'async',source:5,active:'J',queue:['B'],inner:'ok',a:'ok',b:'ok',logs:['same true false','A 42','M'],tags:['执行内部反应任务 J','b = fulfilled(42)','入队 B'],detail:'J 把 inner 的兑现值 <strong>42</strong> 传给 b 的内部 resolve 函数。现在 b 才正式成为 <strong>fulfilled(42)</strong>；之前保存在 b 上的 <code>b.then</code> 反应任务 <strong>B 这时才入队</strong>。'},
  {title:'执行 B：输出 B 42，队列清空',phase:'async',source:10,active:'B',queue:[],inner:'ok',a:'ok',b:'ok',logs:expected,tags:['执行 PromiseReactionJob B','输出 B 42','全部完成'],detail:'终于执行 b.then 的反应任务，得到值 42，输出 <strong>B 42</strong>。完整顺序为 <strong>same true false → A 42 → M → B 42</strong>。'}
];
const taskInfo={T:['采纳','rose'],A:['a.then','blue'],M:['用户任务','gold'],J:['内部 then','purp'],B:['b.then','cyan']};
const el = id => document.getElementById(id);
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cursor=0, timer=null;
function makeCode(){el('source').innerHTML=lines.map((s,i)=>`<div class="code-line" data-line="${i+1}"><span class="n">${String(i+1).padStart(2,'0')}</span><span class="src">${escapeHtml(s)||'&nbsp;'}</span></div>`).join('');}
function makeTicks(){el('ticks').innerHTML=frames.map((f,i)=>`<button type="button" class="tick" data-frame="${i}" aria-label="跳转第 ${i} 帧：${escapeHtml(f.title)}">${i}</button>`).join('');el('ticks').addEventListener('click',ev=>{const b=ev.target.closest('[data-frame]');if(b){pause();go(+b.dataset.frame);}})}
function renderState(name,status,note,highlight){const statusText=status==='none'?'未创建':status==='ok'?'fulfilled(42)':'pending';const cls=status==='ok'?'done':status==='wait'?'wait':'uninit';return `<div class="statecard ${status==='wait'?'waiting':''} ${highlight?'changed':''}"><div class="name">${name}</div><div class="value ${cls}">${statusText}</div><div class="note">${note}</div></div>`}
function render(){const f=frames[cursor],prior=frames[Math.max(0,cursor-1)];
  el('step-kicker').textContent=`FRAME ${String(cursor).padStart(2,'0')} / ${frames.length-1}`;
  el('step-title').textContent=f.title;el('step-detail').innerHTML=f.detail;
  el('phase-head').textContent=f.phase==='sync'?'① 同步执行':'② 微任务检查点';
  el('step-tags').innerHTML=f.tags.map(t=>`<span class="pill ${f.phase==='sync'?'sync':'async'}">${escapeHtml(t)}</span>`).join('');
  el('code-mode').textContent=f.phase==='sync'?'绿色 = 同步执行位置':`紫色 = ${f.active} 任务来源，并非同步重跑`;
  document.querySelectorAll('.code-line').forEach(row=>{const n=+row.dataset.line;row.classList.toggle('executing',f.phase==='sync'&&n===f.line);row.classList.toggle('origin',f.phase==='async'&&n===f.source);});
  const states=[renderState('inner',f.inner,'独立原生 Promise',f.inner!==prior.inner),renderState('a',f.a,f.a==='none'?'尚无引用':'与 inner 是同一个对象',f.a!==prior.a),renderState('b',f.b,f.b==='wait'?'resolve(inner) 已调用；跟随中':f.b==='ok'?'已采纳 inner 的值':'尚未创建',f.b!==prior.b)];
  el('states').innerHTML=states.join('');
  el('relations').innerHTML=f.a==='none'&&f.b==='none'?'引用关系尚未建立':`${f.a!=='none'?'<b>a ──同一对象──▶ inner</b><br>':''}${f.b!=='none'?'<span class="accent">b</span> ──采纳/跟随──▶ inner<br>b !== inner（始终如此）':''}`;
  el('queue').innerHTML=f.queue.length?f.queue.map((id,i)=>`${i?'<span class="q-arrow">→</span>':''}<div class="job ${taskInfo[id][1]}" title="${id} — ${taskInfo[id][0]}"><strong>${id}</strong><small>${taskInfo[id][0]}</small></div>`).join(''):'<div class="queue-empty">队列为空</div>';
  el('queue-notes').innerHTML=f.queue.length?`<b>队首：</b>${f.queue[0]}（下一次执行）<br><b>队尾：</b>${f.queue[f.queue.length-1]} ｜ 待执行 ${f.queue.length} 项`:'<b>队列已清空。</b>没有待执行的微任务。';
  el('terminal').innerHTML=`<div class="prompt">$ output</div>${f.logs.length?f.logs.map((str,i)=>`<div class="out-row"><span class="out-index">${String(i+1).padStart(2,'0')}</span><span class="out-text">${escapeHtml(str)}</span></div>`).join(''):'<div class="empty">(暂无输出)</div>'}`;
  document.querySelectorAll('.tick').forEach((b,i)=>{b.classList.toggle('done',i<cursor);b.classList.toggle('current',i===cursor);b.setAttribute('aria-current',i===cursor?'step':'false')});
  el('counter').textContent=`${String(cursor).padStart(2,'0')} / 13`;
  el('first').disabled=cursor===0;el('prev').disabled=cursor===0;el('next').disabled=cursor===frames.length-1;
}
function go(i){cursor=Math.max(0,Math.min(frames.length-1,i));render();if(cursor===frames.length-1)pause();}
function pause(){if(timer){clearInterval(timer);timer=null;}el('play').textContent='▶ 自动播放';el('play').setAttribute('aria-pressed','false');}
function play(){if(timer){pause();return;}if(cursor===frames.length-1)go(0);el('play').textContent='Ⅱ 暂停';el('play').setAttribute('aria-pressed','true');timer=setInterval(()=>{if(cursor===frames.length-1){pause();return;}go(cursor+1);},+el('speed').value)}
function bind(){el('first').addEventListener('click',()=>{pause();go(0)});el('prev').addEventListener('click',()=>{pause();go(cursor-1)});el('next').addEventListener('click',()=>{pause();go(cursor+1)});el('play').addEventListener('click',play);el('speed').addEventListener('change',()=>{if(timer){pause();play();}});document.addEventListener('keydown',ev=>{if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName))return;if(ev.key==='ArrowLeft'){ev.preventDefault();pause();go(cursor-1)}else if(ev.key==='ArrowRight'){ev.preventDefault();pause();go(cursor+1)}else if(ev.code==='Space'){ev.preventDefault();play()}});
  el('verify-btn').addEventListener('click',()=>{const logs=[];
    // Same semantics as the original IIFE; only the console sink is redirected.
    (()=>{const inner=Promise.resolve(42);const a=Promise.resolve(inner);const b=new Promise(resolve=>resolve(inner));logs.push('same '+(a===inner)+' '+(b===inner));a.then(v=>logs.push('A '+v));b.then(v=>logs.push('B '+v));queueMicrotask(()=>logs.push('M'));})();
    // A timer runs after the current microtask checkpoint, so the check sees all logs.
    el('verify-msg').textContent='正在执行真实 Promise 与微任务…';setTimeout(()=>{const ok=JSON.stringify(logs)===JSON.stringify(expected);el('verify-msg').textContent=(ok?'✅ 验证一致：':'❌ 与预测不同：')+logs.join(' → ');el('verify-msg').style.color=ok?'var(--teal)':'var(--red)';},0);
  });
}
makeCode();makeTicks();bind();render();
