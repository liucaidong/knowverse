# Phase J：近 7 天学习回顾

- 日期：2026-11-03
- 状态：本地实现与自动化验证完成，待提交
- 产品主线：学习成长；复用既有 Learning Events V3 和 IndexedDB，不新增数据表或后端接口。

## 产品目的

参考 Duolingo 的复习入口、Khan Academy 的学习活动/技能进度，以及竞品分析中 P0 真实学习闭环的要求，把学习记录变成学习者每周都能读懂的复盘摘要。

这不是 H2 学习评估中心，也不宣称策略造成了学习提升。它只回答：
- 最近 7 个本地日历日是否发生了可追溯的学习行动？
- 有多少独立无提示验证、提示辅助通过、错误与复习会话？
- 是否存在当前仍待修复的误区？
- 有多少任务真正结算了执行耗时？

## 入口与体验

页面：/progress/，位于“今天应该学什么”之后、“高级分析与策略控制”之前。

展示：
- 七个本地日历日的有效学习活动条带。
- 有记录的天数、独立无提示通过、提示辅助通过、实际任务耗时、当前待修复误区。
- 作答/错误、复习会话、提示、任务开始/完成/失败、不同错误观察。
- 最近涉及最多的四个能力点。
- “复制本周学习回顾”，只复制本地汇总文本，不新增事件或改变掌握状态。

无记录时显示明确空状态，不显示虚假的零分、掌握率或成效结论。

## 数据与指标边界

核心实现：assets/js/learning-weekly-review.mjs。

时间范围是设备本地日历中的今天及之前六天。只接受已登记的真实事件类型；按 event.id 去重；忽略未来记录、超出窗口事件和普通页面浏览。

独立无提示通过必须满足：
- type 为 assessment_passed 或 completed；
- independent=true；
- hintsUsed=0；
- 至少一个 competencyId；
- 有效 variantId；
- 按 sessionType + sessionId + variantId 去重，同一会话的 assessment/completed 双事件不会重复加一。

提示辅助通过单独统计，不计入独立通过；没有独立标记的完成单独保留为未分类结果，不伪装成独立掌握。

任务执行耗时只累计带 taskId 的 learning_task_paused / completed / failed 事件 durationSeconds。estimatedMinutes、尚未结束的计时区间和浏览停留时间都不进入真实耗时。任务开始、完成和失败按 taskId 去重，而不是把暂停恢复次数当成多个任务。

当前待修复误区来自现有 Learning Intelligence 派生结果；错误观察按 gapObservationId（缺失时回退事件 ID）去重。

不做：
- 新建数据库表、事件类型、后端接口或 H2 报告系统；
- 推断遗忘概率、因果效果或学习能力排名；
- 将阅读确认、页面访问、AI 对话、提示辅助通过或计划任务完成当作掌握证据；
- 把本地回顾自动上传或作为新的学习证据。

## 自动化验证结果

- scripts/verify-learning-weekly-review.mjs：6 项通过，覆盖本地日历边界、重复/未来事件、独立与辅助结果拆分、复习会话、Gap、实际耗时、空数据与 session/taskId 去重。
- scripts/e2e-weekly-learning-review.mjs：3 项通过，覆盖 Chromium 空状态、真实 IndexedDB 事件回顾、WebKit 390px 布局。
- 关联 Learning Progress / Planner / Intelligence / Tutor / H1 Promise 试点 / 导航 / 路由回归：30 项浏览器 E2E 通过。
- 静态内容验证：3,500 个本地链接、44 条 canonical routes 与 113 条搜索索引记录通过。

本功能用于帮助学习者完成真实 7 天试点的观察与复盘，不替代试点本身。至少一个真实 D1-D7 周期、真实延迟回忆和真实设备同步仍需由学习者完成。
