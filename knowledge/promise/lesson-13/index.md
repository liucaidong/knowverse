# 工程实践：只处理结果还不够

## 超时应该同时处理资源

下面的代码以 `fetch` 为例，使用 `AbortController` 在超时后要求底层 API 取消请求，并始终清理 timer。

```js
async function fetchWithTimeout(url, ms = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}
```

`AbortController` 能否真的中止操作由具体 API 决定；它不是 `Promise.cancel()`。`Promise.race` 只裁定外层命运，不负责释放底层资源。

## 顺序、重试与有界并发

- **串行**：B 需要 A 的结果才启动，用先后两个 `await`。
- **并发**：两个任务独立时，先创建两个 Promise，再一次 `Promise.all` 等待。
- **限流**：几十万个请求不能直接 `Promise.all` 一股脑启动，需要有界并发队列。
- **重试**：仅对可重试错误进行，并设置次数、退避、幂等性及取消信号。

## 包装回调式 API

```js
function readLegacy(cbApi) {
  return new Promise((resolve, reject) => {
    cbApi((err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}
```

包装时要处理回调多次触发（Promise 状态会锁定，但底层回调仍可能发生副作用）、同步 throw 和超时，不要把所有异步错误都寄希望于外层 try/catch。

## 错误恢复分三层

| 层级 | 目的 | 常用方式 |
|---|---|---|
| 本地恢复 | 使用备用值，继续提供功能 | `.catch(() => fallback)` |
| 上报后传播 | 记录诊断但不吞掉失败 | `catch (e) { log(e); throw e; }` |
| 整体汇总 | 保留多个任务的成败 | `allSettled` |

## “未处理拒绝”的边界

`unhandledrejection`（浏览器）与 Node 的 unhandled rejection 机制属于宿主行为。生产程序不应依赖全局监听器替代每条业务链的显式失败处理；还应避免创建未被消费的 fire-and-forget Promise。
