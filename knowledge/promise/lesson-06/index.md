# `catch` 处理失败，`finally` 处理收尾

## catch 恢复与传播

`p.catch(onRejected)` 对拒绝作出响应。如果 `onRejected` 正常返回，后继 Promise 变为 fulfilled；如果再次抛错或返回拒绝的 Promise，拒绝继续传播。

## finally 是透传，不是无条件保真

```js
Promise.resolve(7)
  .finally(() => console.log('cleanup'))
  .then(v => console.log('value', v));
// cleanup
// value 7
```

```js
Promise.resolve(7)
  .finally(() => Promise.reject(new Error('cleanup failed')))
  .then(console.log)
  .catch(e => console.log(e.message));
// cleanup failed
```

在 cleanup 正常结束时，`finally` **透传原有 fulfilled 值或 rejected 原因**；若 cleanup 抛错或返回的 thenable 最终拒绝，会用新的拒绝覆盖原结果。`finally` 回调的普通返回值（比如 `return 100`）不会改写成功结果。

```mermaid
flowchart TD
  P[原 Promise] --> F[执行 finally 回调]
  F --> E{cleanup 抛错或拒绝?}
  E -->|否| K[透传原结果]
  E -->|是| R[后继以新原因 rejected]
```

## 定时器里的 `throw` 为什么捕不住

```js
new Promise(resolve => {
  setTimeout(() => { throw new Error('timer'); }, 0);
  resolve(1);
}).catch(e => console.log('will not catch', e));
```

定时器回调在**未来单独的任务执行上下文**中运行，已脱离 executor 同步调用的 `try/catch`。正确的桥接方式是在回调里**调用 reject**，而不是在外层等待一个与定时器毫无关联的 Promise。

```js
const parseLater = (raw, ms) => new Promise((resolve, reject) => {
  setTimeout(() => {
    try {
      const value = JSON.parse(raw);
      resolve(value);
    } catch (error) {
      reject(error);
    }
  }, ms);
});
```

这里真正可能抛错的是 `JSON.parse(raw)`，所以 `try/catch` 必须包住解析操作，并把异常交给 `reject`。`resolve(value)` 负责提交结果，不是用来捕获业务解析错误的；若底层 API 已返回 Promise，优先直接返回或 `await` 它，而不是再包一层无必要的 Promise。

## 自测

`finally(() => 100)` 与 `then(() => 100)` 的值传播有何不同？答案：前者正常完成时透传源结果，后者直接返回 100 作为下游兑现值。
