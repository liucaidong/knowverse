# Promise.any：只要有一个成功

`Promise.any(iterable)` 把输入中的**首次 fulfilled** 值作为结果；只有**全部 rejected** 时，才用 `AggregateError` 拒绝。

```js
const a = Promise.reject('early');
const b = new Promise(resolve => setTimeout(() => resolve('winner'), 10));
Promise.any([a, b]).then(console.log); // winner
```

## errors 按输入顺序，和拒绝先后无关

```js
const slow = new Promise((_, reject) => setTimeout(() => reject('S'), 12));
const fast = Promise.reject('F');
Promise.any([slow, fast]).catch(e => {
  console.log(e instanceof AggregateError);
  console.log(e.errors); // ['S', 'F']
});
```

虽然 F 可能更早拒绝，但 `errors` 按 iterable 进入组合时的索引顺序整理。不要用 `Promise.race` 的“先落定”直觉来理解 `any`。

## any 与 race 的语义差异

| 特征 | `any` | `race` |
|---|---|---|
| 胜出条件 | 首个 fulfilled | 首个 settled |
| 遇到 rejected | 继续等待其他输入 | 立刻以该拒绝结束 |
| 所有 rejected | AggregateError | 谁先 rejected 就是谁 |
| 空输入 | rejected(AggregateError) | 永远 pending |

**适用场景**：多个冗余镜像中找第一个可用结果；但不要用它吞掉全部失败的细节，处理时应该查看 `.errors`。
