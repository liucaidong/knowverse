# 组合 API 与边界矩阵

> 来源：按可检索历史会话线索整理，部分表达为知识性归纳，非逐字原话。

四种组合 API 不是简单的“先后执行”变体。`all` 要求全部成功，可以提前拒绝；`any` 要求至少一个成功，全部拒绝时返回 `AggregateError`；`race` 取最先落定者，无论成功或失败；`allSettled` 等待全部落定并记录每项结果。

| API | 何时 fulfilled | 何时 rejected | 空数组 |
|---|---|---|---|
| all | 所有输入兑现 | 任意输入拒绝 | fulfilled([]) |
| any | 任意输入兑现 | 全部拒绝 | rejected(AggregateError) |
| race | 首个落定结果为兑现 | 首个落定结果为拒绝 | 永久 pending |
| allSettled | 全部落定后汇总 | 正常情况下不因某成员拒绝而拒绝 | fulfilled([]) |

`all` 与 `allSettled` 的结果顺序、`any.errors` 的顺序按**输入位置**记录；`race` 的结局受状态与 reaction 调度影响。四个组合方法均不会自动取消未胜出的任务。

**历史练习脉络**：第 10—12 课反复训练 `race`、`any.errors`、空数组和已落定输入顺序；复习时要用“状态落定 → reaction 排队 → 微任务执行”说明原因。
