# 在工程里如何为 Promise 写可重复的测试

学习时的输出顺序题是观察机制的工具；工程测试要更进一步：**明确输入时机、所有权、可观察输出、失败分支和清理义务**。仅靠 `setTimeout(0)` 等待“所有事情应该都结束”是不稳定的测试策略。

## 设计可控的 Promise

```js
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const d = deferred();
const events = [];
d.promise.then(v => events.push(v));
d.resolve(42);
await d.promise;
// 不要仅根据 await d.promise 就断言所有后续级联反应一定已完成；
// 如需测试某个 downstream，请显式 await 该 downstream Promise。
```

与其依赖设备快慢，不如使用可控 `deferred` 来安排**何时解决**。注意 `await d.promise` 和提前注册的 `d.promise.then` 的先后仍受 reaction Jobs 具体入队规则控制，所以在复杂链上，最稳妥的断言目标是你要测试的那个“最终结果 Promise”。

## 测试可观察行为，而非隐藏内部槽

```js
const source = Promise.resolve(4);
const downstream = source.then(v => v * 2);
const result = await downstream;
if (result !== 8) throw new Error('bad result');
```

断言最终值、外部副作用和错误传播，不依赖非标准的 Promise 状态 inspection。想验证具体入队行为时，使用日志序列测试，但要声明运行环境和控制 timer、I/O 的方式。

## Fake Timers 不能代替 Promise 微任务知识

许多测试框架支持伪时钟，它可以控制 timer 回调；然而 Promise Jobs 和 `process.nextTick` 等队列可能不受同一套模拟控制（取决于测试框架版本与配置）。测试需要明确：推进了哪一种计时器？刷新了哪些 Jobs？哪些回调可能仍在进行？

在 Node.js 和浏览器中，`await Promise.resolve()` 常作为一个让出执行权的手段，但不能被当作“清空整个未来微任务世界”的万能指令：await 本身会安排续体，而续体执行时有些下游 Jobs 还未入队。

## 诊断未处理拒绝

```js
async function save() {
  throw new Error('save failed');
}
const p = save();
// 不调用 await 或 catch，就可能触发宿主的未处理拒绝机制。
p.catch(e => console.error('handled:', e.message));
```

在业务边界明确地 `await` 并处理，或者显式返回给上游；如果故意 fire-and-forget，应提供独立的错误处理和生命周期管理。浏览器 `unhandledrejection` 和 Node unhandled rejection 策略会随宿主配置变化，应按运行环境文档验证。

## 排障记录模板

每一次异步问题记录以下五项，可避免复盘时混淆：

| 维度 | 需要记录 |
|---|---|
| Promise 身份 | p、q、r 是谁创建，是否相等 |
| 解决权 | 是否 resolve(inner)，有无晚到 reject |
| 同步阶段 | executor、getter、console 的实际顺序 |
| Job 队列 | 每条 reaction 在何时入队 |
| 观测结果 | 浏览器 / Node 版本、日志、异常、断言 |

**实践练习**：将第 14 单元的 `thenable + inner + race` 代码拆成 `deferred` 和独立 Job 记录。不要直接把“输出相同”推导成“内部状态每个时刻都相同”。
