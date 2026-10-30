# 新编诊断题库（不代替历史原题）

> 教学方式：**先预测输出与每个 Promise 的状态，再展开答案。** 以下均为新编练习，并非历史对话中的逐字题干。

## Q01 · executor 顺序

```js
console.log('A');
new Promise(resolve => { console.log('B'); resolve(); })
  .then(() => console.log('D'));
console.log('C');
```

<details><summary>查看解析</summary>

`A → B → C → D`。executor 同步，then 异步。

</details>

## Q02 · 链式 Job 的位置

```js
Promise.resolve().then(() => console.log('A'))
  .then(() => console.log('B'));
queueMicrotask(() => console.log('M'));
```

<details><summary>查看解析</summary>

`A → M → B`；第二个 then 的反应要等前一个 handler 返回后才入队。

</details>

## Q03 · resolve 不等于立即 fulfilled

```js
let finish;
const inner = new Promise(r => finish = r);
const outer = new Promise(r => r(inner));
outer.then(v => console.log(v));
finish('OK');
```

<details><summary>查看解析</summary>

只会在后续 Job 中打印 `OK`；outer 在采用 inner 时可以仍为 pending。

</details>

## Q04 · Promise 身份

```js
const p = Promise.resolve(1);
console.log(Promise.resolve(p) === p);
console.log(new Promise(r => r(p)) === p);
```

<details><summary>查看解析</summary>

`true`、`false`。原生 Promise 同构造器可被直接返回，新构造器调用总创建新对象。

</details>

## Q05 · getter 与 then 调用

```js
const x = { get then() { console.log('G'); return r => { console.log('T'); r(1); }; } };
Promise.resolve(x);
console.log('E');
```

<details><summary>查看解析</summary>

`G → E → T`。getter 读取同步，thenable 调用由 Job 安排。

</details>

## Q06 · 错误恢复

```js
Promise.reject('X').catch(() => 5).then(console.log);
```

<details><summary>查看解析</summary>

`5`。catch 返回普通值使下游兑现。

</details>

## Q07 · 同一 then 的两个回调

```js
Promise.resolve(1).then(() => { throw Error('X'); }, () => console.log('NO'))
 .catch(e => console.log(e.message));
```

<details><summary>查看解析</summary>

只输出 `X`；原 Promise 未拒绝，因此同一 then 的 onRejected 不执行。

</details>

## Q08 · 无 return

```js
Promise.resolve(9).then(v => { v + 1; }).then(console.log);
```

<details><summary>查看解析</summary>

打印 `undefined`。表达式求值未被 return。

</details>

## Q09 · finally 的普通返回值

```js
Promise.resolve(9).finally(() => 99).then(console.log);
```

<details><summary>查看解析</summary>

`9`。finally 正常完成时透传原结果。

</details>

## Q10 · finally 覆盖原结果

```js
Promise.resolve(9).finally(() => { throw Error('X'); })
 .catch(e => console.log(e.message));
```

<details><summary>查看解析</summary>

`X`。cleanup 抛错使下游拒绝。

</details>

## Q11 · all 结果顺序

```js
Promise.all([new Promise(r=>setTimeout(()=>r('slow'),10)), 'fast']).then(console.log);
```

<details><summary>查看解析</summary>

最终 `['slow', 'fast']`，顺序按输入位置。

</details>

## Q12 · any.errors 索引顺序

```js
Promise.any([new Promise((_,j)=>setTimeout(()=>j('A'),10)), Promise.reject('B')])
 .catch(e => console.log(e.errors.join(',')));
```

<details><summary>查看解析</summary>

`A,B`，即使 B 更早拒绝。

</details>

## Q13 · race 忽略成功偏好吗

```js
Promise.race([Promise.reject('R'), Promise.resolve('F')])
 .then(console.log, console.log);
```

<details><summary>查看解析</summary>

`R`。首先参与竞争的已拒绝 Promise，其 reaction Job 先入队，race 因此拒绝。

</details>

## Q14 · 空组合

`all([])`、`allSettled([])`、`any([])`、`race([])` 的命运分别是什么？

<details><summary>查看解析</summary>

分别为 fulfilled([])、fulfilled([])、rejected(AggregateError)、永久 pending。

</details>

## Q15 · async 同步体

```js
async function f(){ console.log('inner'); return 1; }
console.log('before'); f().then(() => console.log('then')); console.log('after');
```

<details><summary>查看解析</summary>

`before → inner → after → then`。async 在首次 await 前可同步运行，返回值仍是 Promise。

</details>

## Q16 · thenable 锁定

```js
const t = { then(resolve, reject) { resolve(1); reject(2); throw Error('late'); } };
Promise.resolve(t).then(console.log, console.error);
```

<details><summary>查看解析</summary>

打印 `1`，晚到 reject/throw 不覆盖已锁定结果。

</details>

## 下一步

使用专题首页的交互实验室逐题运行 Q01–Q16。需要分辨**日志顺序**和**对象实际落定时间**时，用纸绘制 Jobs 队列并逐帧记录。
