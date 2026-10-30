# 每个 `.then()` 都产生新 Promise

## 使用对象关系图思考

```js
const p = Promise.resolve(5);
const q = p.then(v => v + 3);
const r = q.then(v => { console.log(v); });
console.log(p === q, q === r); // false false
// 后续记录 8
```

```mermaid
flowchart LR
  P[p: fulfilled 5] -->|then(v => v+3)| Q[q: fulfilled 8]
  Q -->|then(log) 返回 undefined| R[r: fulfilled undefined]
```

注意图中箭头表示**逻辑依赖**，不是同步状态切换；不同状态往往跨越多个 Job。

## 四条传播规则

| 处理器行为 | 下游 Promise 命运 |
|---|---|
| `return 9` | fulfilled(9) |
| 不写 `return` | fulfilled(undefined) |
| `throw Error('x')` | rejected(error) |
| `return somePromise/thenable` | 采用该对象的结果 |

```js
Promise.resolve('origin')
  .then(() => { throw new Error('chain'); })
  .then(() => console.log('never'))
  .catch(err => {
    console.log('recover:', err.message);
    return 'ok';
  })
  .then(v => console.log('done:', v));
// recover: chain
// done: ok
```

`.catch(handler)` 等价于 `.then(undefined, handler)` 的常见形式。**catch 返回普通值会恢复链**，除非 handler 再次抛错或返回拒绝的 Promise。

## 容易错的一点：同一个 then 的 onRejected

```js
Promise.resolve(1)
  .then(
    () => { throw new Error('inside-onFulfilled'); },
    () => console.log('not-caught-here')
  )
  .catch(e => console.log('caught later', e.message));
```

第二个参数只处理**源 Promise 的拒绝**，不会捕获同一次 `.then` 的成功回调内部的异常；该异常会拒绝 `.then` 返回的**新** Promise，因此由后面的 `.catch` 捕获。

## 作业

画出每次 `.then` 的新对象，并在每条箭头旁写出其处理器是 `return`、`throw` 还是 `adopt`。能画出对象身份，再考虑时间顺序。
