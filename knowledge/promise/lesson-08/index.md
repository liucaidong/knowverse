# Promise.all：汇总一组必须全部成功的结果

## 语义不等于“并发调度器”

`Promise.all(iterable)` 返回一个新的 Promise：**所有输入最终兑现后**，它按**输入顺序**兑现为数组；只要任何输入拒绝，它就拒绝为第一个可观察到的拒绝原因。

```js
const slow = new Promise(resolve => setTimeout(() => resolve('slow'), 30));
const fast = Promise.resolve('fast');
Promise.all([slow, fast]).then(console.log);
// 最终 ['slow', 'fast'] —— 输入顺序，不是完成先后
```

## “早拒绝”≠“自动取消”

```js
const a = Promise.reject(new Error('failed'));
const b = new Promise(resolve => setTimeout(() => {
  console.log('b still runs');
  resolve(2);
}, 10));
Promise.all([a, b]).catch(e => console.log(e.message));
```

`all` 的外层失败不意味着 b 的定时器、网络请求或其他底层操作被取消。取消应单独使用 `AbortController` 等底层 API 支持的机制。

## 空输入和非 Promise 值

- `Promise.all([])` 立即创建一个已经 fulfilled 的 Promise，值为 `[]`；**其 then 回调依旧异步执行**。
- 普通值会经过 Promise 解决机制，以数组原顺序加入结果。
- iterable 在调用期间被**同步迭代**；迭代器本身发生异常时，外层 Promise 会按算法拒绝。不要将它误读成逐项异步启动。

## 诊断矩阵

| 输入情况 | 外层结果 | 是否等待其余任务停下 |
|---|---|---|
| 全部 fulfilled | fulfilled(按输入顺序数组) | 等待全部落定 |
| 至少一个 rejected | rejected(先观察到的失败) | 否，其他底层任务仍可执行 |
| `[]` | fulfilled([]) | 不涉及等待 |

**适用场景**：页面同时需要多个缺一不可的数据来源；或者一项失败时这个组合结果整体失去价值。
