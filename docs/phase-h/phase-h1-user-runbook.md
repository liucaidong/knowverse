# Phase H1 ES Promise 真实学习者操作手册

入口：
- 学习驾驶舱：https://liucaidong.github.io/knowverse/progress/
- 个人智能学习 Agent：https://liucaidong.github.io/knowverse/agent/
- Promise 课程：https://liucaidong.github.io/knowverse/knowledge/promise/
- 独立复习：https://liucaidong.github.io/knowverse/review/
- 综合挑战：https://liucaidong.github.io/knowverse/puzzles/worlds/promise-mechanism-quest/

## 开始前
1. 在真实 Mac 浏览器打开 /progress/，不要清除浏览器数据或 IndexedDB。
2. 核对账户身份和云端档案同步授权；登录与 allowlist 授权是两个状态。
3. 检查本机已有目标、计划、任务、历史和 Outbox；如有离线事件先保护，不要为试点清空。
4. 未验证知识保持 unverified，不手动标成掌握或薄弱。

## 创建目标
1. 打开 /agent/ 的学习目标表单。
2. 名称可写“ES Promise 原理与工程实践”。
3. 关联知识专题选择 JavaScript · Promise。系统会验证 topic / competency 必须来自当前注册表。
4. 每日投入选择真实预算（默认 25 分钟），优先级和目标日期按真实安排。
5. 创建后在 /agent/ 检查目标状态。目标完成必须达到稳定掌握验收条件，不是看完就能完成。

## 生成和接受计划
1. 在 /progress/#adaptive-plan 设置每天分钟数和 Promise 专题偏好。
2. 回 /agent/ 生成提案，检查先修顺序、预计耗时和推荐理由。
3. 只有你明确点击“接受计划并创建任务”，才会创建正式任务；拒绝提案不会覆盖旧记录。

## 课程阅读
1. 从计划任务打开对应 lesson，不手工复制旧 taskId。
2. lesson-03/04/05/08/14 等五个 mapped competency 页面带 taskId 时，会在标题下出现“来自今日学习计划 · 阅读行动”。
3. 点击开始；中断可暂停；刷新后从任务状态继续；读完由你点击确认完成。
4. 任务完成仅表示执行，不代表掌握。其他辅助课程仍可正常阅读，但不冒充独立 competency。

## 挑战、gap 和复习
1. 按真实理解做 Promise 挑战；不为了制造 gap 故意答错。
2. 答错会关联注册 gapId；用提示如实记录 hintsUsed。
3. 在 /progress/#weak-points 查看真实 gap 并针对性修复。
4. 提示辅助通过只会待独立确认。到 /review/ 选不同题型、无提示验证；只有不同 variant + 完整因果链通过后才能关闭 gap。

## D4-D7 延迟复习
以 D1 真实日期为起点，等系统到期；至少 2 天后无提示回忆并使用新变体。记录实际时间、是否用提示、结果和关联 decisionId。不要改系统时间或回填历史日期。

## Mac 与 iPhone
两台设备使用同一个已授权账户。离线时继续记录在本机，云端不可视为已更新；网络恢复后先确认同步，再打开第二台设备核对目标、计划和任务。出现账户或 CAS 冲突时暂停另一台设备写入，保留两台现场，不要清库或反复导入。Playwright WebKit 测试不等同真实 iPhone Safari 验收。

## 策略反馈
在 /progress/ 策略面板对最近的决策选择“有帮助”或“不合适”。反馈只作为观察证据，不直接更改掌握度；样本不足时策略维持 cold-start。
