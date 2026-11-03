# Phase H1 自动化端到端试点验证

日期：2026-11-03
脚本：`scripts/e2e-phase-h1-pilot.mjs`
运行方式：Playwright Chromium，独立浏览器上下文和独立 IndexedDB。

## 验证目标

把原本分散在 Agent、课程阅读、知识检查、薄弱点诊断、Review 和复习调度中的测试，串成一条完整的合成学习者旅程：

目标创建 → 计划生成与接受 → 课程阅读 → 先修任务解锁 → 检查点错误 → gap 诊断 → 提示辅助复习 → 不同变体无提示独立复习 → 延迟复习调度。

## 测试场景

1. 通过 `/agent/` 页面真实表单创建 ES Promise 目标，设置 25 分钟每日预算和 Promise 专题。
2. 通过工作区按钮触发规则规划，确认计划提案并接受。
3. 使用正式 `mapPlanActionToTask` 契约，把阅读与其依赖检查点的任务关联到已接受计划；任务文档仅写入当前隔离的测试数据库。这使 E2E 可以对确定的 Promise competency 作稳定验收，不把“计划生成了某个具体内容列表”误作本测试目标。
4. 通过课程页面真实 UI 开始、暂停、刷新恢复、继续并确认阅读完成；等待 IndexedDB 状态落盘，断言后续检查点从 locked 解锁为 ready，且阅读任务 `evidenceEventIds` 为空，不产生 mastery 证据。
5. 通过知识检查 UI 选择一个错误选项，确认生成 `resolved-vs-settled` 的真实 gap observation，并保留 taskId 关联。
6. 创建针对该 gap 的复习任务，进入真实 Review 工作台；第一次展开提示并答对，验证属于辅助证据、任务不能完成、gap 仍保持打开。
7. 重试复习任务，切换注册表中的另一个变体，无提示独立答对；断言 task evidence、session/attempt/pass 因果关系、原始 `targetGapEventIds` 引用以及精确 gap 关闭。
8. 将**仅当前 Playwright 页面上下文**的虚拟时钟前进 4 天，验证到期复习进入队列并由调度器判断为 due。

## 事件字段边界回归

- `targetGapEventIds`：明确指向本次 Review 要解决的原始错误观察。
- `causationEventIds`：描述 Review Session、前序 Review attempt 和当前 attempt/pass 之间的因果关系。
- 原始错误观察不要求重复出现在 `causationEventIds` 中；要求它在 `targetGapEventIds` 中，并要求当前 review 的 started/attempt/pass 构成完整可追溯链。

本次 E2E 揭示 `TaskOrchestrator.validateEvidence` 曾错误要求 `review_started.causationEventIds` 同时包含原始错误 ID。这会使第二轮复习（尤其是第一次提示辅助通过后）被错误拒绝。已将校验改为分别验证目标引用与因果前序，并在 `scripts/verify-phase-e.mjs` 添加真实 Review Engine + Task Orchestrator 回归测试。

## 隔离与时间模拟边界

- `KNOWVERSE_BACKEND_CONFIG` 在测试 profile 中清空 Supabase URL 和 publishable key。
- 不登录 GitHub，不使用真实账户，不连接生产 Supabase，不读取或修改用户本机已存在的学习档案。
- 所有 goal、plan、task、event、review session 写入新建的 Playwright 浏览器上下文 IndexedDB。
- 虚拟日期用于确定性验证 scheduler 的到期判断。它不是 4 天真实经过，也不是人类延迟回忆或长期记忆效果证据。
- 错误答案和正确答案由测试脚本驱动，是机制回归 fixture，不代表用户本人真实知识水平。

## 结果解释

该自动化验证可以证明：页面可交互、Repository 原子保存路径可用、任务依赖状态正确、阅读证据与 mastery 分离、hint-assisted pass 不会伪装成 independent pass、不同变体的无提示复习可以按精确 gap 与因果规则完成，并且调度器会在给定虚拟时间下安排后续复习。

它不能证明：学习者真的读懂了课程、AI 讲解提高了学习效果、用户真实 4 天后仍能回忆、跨真实设备/真实网络/真实账户的全部生产同步行为无误。跨设备生产验收和真实学习者 7 天试点仍是独立工作。

## CI

脚本通过 `.github/workflows/validate.yml` 纳入 Validate KNOWVERSE Content 工作流，作为独立 Browser E2E 步骤运行。自动化结果与用户真实学习记录完全隔离。
