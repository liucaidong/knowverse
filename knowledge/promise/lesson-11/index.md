# allSettled：保留成功与失败的完整快照

`Promise.allSettled(iterable)` 不会因为任一参与者拒绝而让外层拒绝；它等**所有参与者落定**后，用与输入位置一致的对象数组兑现。

```js
Promise.allSettled([
  Promise.resolve(1),
  Promise.reject(new Error('no')),
  3
]).then(results => {
  console.log(results.map(r => r.status));
  // ['fulfilled', 'rejected', 'fulfilled']
});
```

返回对象形态：fulfilled 为 `{ status: 'fulfilled', value }`，rejected 为 `{ status: 'rejected', reason }`。不能一律读取 `.value`。

## 核心差异表

| API | 什么时候成功 | 什么时候失败 | 保留全体结果 |
|---|---|---|---|
| `all` | 全部 fulfilled | 任一 rejected | 成功时保留全部值 |
| `race` | 最先 settled 为 fulfilled | 最先 settled 为 rejected | 否 |
| `any` | 任一 fulfilled | 全部 rejected | 失败时 errors 数组 |
| `allSettled` | 全部 settled 后永远 fulfilled | 通常不会因输入拒绝而拒绝 | 是 |

## 空数组要特别记忆

```js
Promise.all([]);        // fulfilled([])
Promise.allSettled([]); // fulfilled([])
Promise.any([]);        // rejected(AggregateError)
Promise.race([]);       // pending forever
```

外层是否已经落定与 `.then` 回调是否同步执行仍是两个问题。**不论空输入如何，注册的 `.then` 处理器不会同步运行。**

## 工程选择

独立任务汇报、批量文件处理、允许部分成功时选择 allSettled；如果全体成功才有意义，选择 all。仅需第一个可用结果选择 any；需要最先发生事件的命运选择 race。
