import assert from 'node:assert/strict';
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
const l=[];l.push('A');new Promise(r=>{l.push('B');r()}).then(()=>l.push('D'));l.push('C');await wait();assert.deepEqual(l,['A','B','C','D']);
const lg=[];const t={get then(){lg.push('get');return resolve=>{lg.push('call');resolve(42)}}};lg.push('start');Promise.resolve(t).then(v=>lg.push('value '+v));lg.push('end');await wait();assert.deepEqual(lg,['start','get','end','call','value 42']);
let finish;const inner=new Promise(r=>finish=r);const outer=new Promise((resolve,reject)=>{resolve(inner);reject('late')});finish(42);assert.equal(await outer,42);assert.equal(Promise.resolve(inner),inner);assert.notEqual(new Promise(r=>r(inner)),inner);
let selfResolve;const self=new Promise(r=>selfResolve=r);selfResolve(self);assert.equal(await self.then(()=>false,e=>e instanceof TypeError),true);
const micro=[];micro.push('A');Promise.resolve().then(()=>{micro.push('B');queueMicrotask(()=>micro.push('D'))});queueMicrotask(()=>micro.push('C'));micro.push('E');await wait();assert.deepEqual(micro,['A','E','B','C','D']);
const chain=[];Promise.resolve().then(()=>chain.push('one')).then(()=>chain.push('two'));queueMicrotask(()=>chain.push('M'));await wait();assert.deepEqual(chain,['one','M','two']);
assert.equal(await Promise.reject('x').catch(()=>5),5);
assert.equal(await Promise.resolve(9).then(v=>{v+1}),undefined);
assert.equal(await Promise.resolve(9).finally(()=>99),9);
assert.equal(await Promise.resolve(9).finally(()=>{throw Error('X')}).catch(e=>e.message),'X');
assert.deepEqual(await Promise.all([new Promise(r=>setTimeout(()=>r('slow'),5)),'fast']),['slow','fast']);
assert.deepEqual(await Promise.any([new Promise((_,j)=>setTimeout(()=>j('A'),5)),Promise.reject('B')]).catch(e=>e.errors),['A','B']);
assert.equal(await Promise.race([Promise.reject('R'),Promise.resolve('F')]).then(v=>v,e=>e),'R');
assert.deepEqual((await Promise.allSettled([Promise.resolve(1),Promise.reject('no'),3])).map(x=>x.status),['fulfilled','rejected','fulfilled']);
assert.deepEqual(await Promise.all([]),[]);assert.deepEqual(await Promise.allSettled([]),[]);assert.equal(await Promise.any([]).catch(e=>e instanceof AggregateError),true);
const big=[];const log=(...args)=>big.push(args.join(' '));let resolveInner;const inner2=new Promise(r=>resolveInner=r);
const x={get then(){log('get');return(resolve,reject)=>{log('call');resolve(inner2);reject(Error('late'));throw Error('thenable-throw')}}};
log('start');const p=Promise.resolve(x);const q=p.then(v=>{log('p',v);throw Error('chain')});const r=q.catch(e=>{log('catch',e.message);return'recovered'});
Promise.race([p,Promise.resolve('fast')]).then(v=>log('race',v));Promise.allSettled([q,r]).then(rs=>log('all',rs.map(x=>x.status).join(',')));
queueMicrotask(()=>{log('M1');resolveInner(42);queueMicrotask(()=>log('M2'))});log('end');await wait();
assert.deepEqual(big,['start','get','end','call','M1','race fast','M2','p 42','catch chain','all rejected,fulfilled']);
console.log('PASS: Promise model and integrated microtask order, Node '+process.version);

// Keep the interactive debugger's curated trace aligned with native Promise semantics.
await import('./verify-promise-debugger.mjs');
