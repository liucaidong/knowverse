# Phase F — 实施计划

## 阶段
1. 纯算法：间隔复习、风险/趋势/诊断/目标预测、NBA，固定时间与证据 fixture 单测。
2. 应用服务：扩展 Task Orchestrator 幂等复习任务；Proactive Engine 读 Repository、调用 Learning Intelligence、保存版本化投影并处理 CAS。
3. 工作流：taskId 贯通 Review 工作台，启动/完成/失败仍使用原 Orchestrator 规则。
4. 产品：在现有 `/progress/` 驾驶舱和 Agent 上整合 NBA、目标轨迹、复习队列、风险与诊断，桌面/移动兼容。
5. 云端：新增 forward migration 扩展现有 archive 类型和 RPC allowlist，不添加表或放宽安全。
6. 验收：单元、集成、Chromium desktop、WebKit mobile、现有 Phase D/E 回归、CI、Supabase、Pages 和生产 HTTP。

## 主要新增文件
`assets/js/spaced-repetition-engine.mjs`、`learning-risk-engine.mjs`、`next-best-action.mjs`、`proactive-learning-engine.mjs`、`scripts/verify-phase-f.mjs`、对既有 `scripts/e2e-learning-intelligence.mjs` 和 `scripts/e2e-learning-agent.mjs` 的扩展、Supabase Phase F forward migration、`docs/phase-f/*`。

## 主要修改
`assets/js/backend/local-event-store.mjs`、`learning-agent/task-orchestrator.mjs`、`learning-agent/workspace.mjs`、`learning-progress-page.mjs`、`review-workspace.mjs`、`progress/index.html`、`assets/css/learning-progress.css`、CI Validate workflow。Learning Intelligence 的掌握度门槛和原始事件 Schema 不修改。

## 交付
完整实现、测试、diff 检查，形成一个 Phase F 阶段提交推送 main，检查 Validate/Deploy、Supabase 和真实页面；物理 iPhone/第二设备/Provider 外部配置分别报告，模拟 viewport 不冒充真实设备。
