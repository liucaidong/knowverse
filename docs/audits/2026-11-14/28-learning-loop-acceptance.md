# KNOWVERSE 4.1 — 学习闭环验收记录

## 1. 本地隔离端到端验收

<badge>本地合成学习者场景</badge>

执行的真实浏览器场景：`scripts/e2e-phase-h1-pilot.mjs`、`scripts/e2e-phase-k-learning-loop.mjs`、`scripts/e2e-learning-agent.mjs`、`scripts/e2e-learning-planner.mjs`、`scripts/e2e-weekly-learning-review.mjs`。

- Chromium 中创建学习目标、保存偏好、生成计划提案并由学习者接受。
- 创建课程阅读任务和独立 Checkpoint 任务，后者在先修阅读任务完成前保持 locked。
- 阅读任务支持开始、暂停、刷新后恢复、继续和完成；完成事件不产生 mastery evidence。
- 错误 Checkpoint 真实写入 attempt / Gap observation。
- 针对 Gap 创建复习任务；先进行提示辅助复习，再使用不同注册变体进行零提示独立验证。
- Task orchestrator 验证 attempt / review_started / assessment_passed 因果链后允许完成复习任务。
- reducer 重新计算 Gap；独立通过后对应 Gap 关闭，掌握度依据真实测评事件更新。
- 延迟复习根据证据时间生成 due queue；测试虚拟日期只用于验证排程算法，不冒充现实等待时间。
- Agent 规则模式、用户同意边界、私有反思与 mastery evidence 隔离均有浏览器用例。

结果：本地隔离场景通过。学习闭环专项 E2E 13/13；完整浏览器回归 90/90。

## 2. 本地持久化与重放

- Node 单元 / 契约测试：245/245 通过。
- repository 的 IndexedDB events 与 versioned documents 事务、CAS、幂等和冲突处理有专门测试。
- 浏览器 E2E 检查刷新后任务状态、计划状态、复习目标和学习证据可恢复。
- 计划来源证据修复专项：18/18 Phase E 测试通过；学习核心相关测试 92/92 通过。
- 新增 Promise Universe 生命周期回归后，五个沉浸场景 5/5 通过。

## 3. Staging 云端闭环验收（未通过）

执行：`scripts/e2e-staging-cloud-learning-loop.mjs`。该脚本硬编码并断言 Staging project ref `ypthoicwrfsblaidllyy`，使用 `.env.n2.local` 中的独立 Staging 测试账户；没有连接 Production。

第一次执行实际走完学习者目标 → 计划 → 阅读 → Checkpoint 失败 → Gap repair → 延迟复习 → 云端推送阶段，但最终云端同步返回 `conflicts=2`，不满足零冲突验收条件，因此没有进入第二设备恢复和 Agent 真实调用验收。

进一步诊断时，第二次执行发现 Staging 账户初始同步本身就返回 `status=partial`、`conflicts=2`、`pushedDocuments=2`、`pulledDocuments=35`、`pendingDocuments=1`。为防止继续叠加测试数据，脚本已加安全前置条件：必须先完成无冲突的 initial sync，否则在创建新学习数据之前停止。

这表明当前 Staging 测试账户的云端基线存在文档冲突。冲突文档具体身份尚未安全确认；本阶段没有清空、覆盖或手动解决任何 Staging 文档，也没有改动 sync engine / 自动同步频率 / 多标签页等待调度（这些同步问题已由用户明确暂停）。第一次执行产生的 run-scoped 合成记录保留在 Staging 测试账户中，不执行删除。

结果：Staging 云端 / 第二设备恢复链路 **未通过验收**，原因是现有同步基线冲突，且该问题属于当前明确暂停的同步机制范围。不能把本地闭环通过扩展为云端闭环通过。

## 4. Production 数据安全

- Production 只做 schema、migration、RPC、Edge Function 和聚合数据只读检查。
- 没有向 Production 写入任何测试事件、计划、任务、账户或档案。
- 生产已有少量真实 Promise 学习事件和计划文档，但没有完整 task acceptance / execution / review chain；不能将其宣称为生产闭环验收。
- Production Edge Function active 不等于真实 AI Provider 已配置；未执行已授权用户的真实 Provider 调用。

## 5. 验收判定

| 验收项 | 结果 |
|---|---|
| 真实用户操作产生本地学习证据 | 通过（隔离合成学习者） |
| 失败答案产生 Gap | 通过 |
| Gap 驱动计划行动 | 通过；来源 event IDs 已修复并验证 |
| 学习者接受计划并创建任务 | 通过 |
| 阅读完成不冒充掌握证据 | 通过 |
| 不同变体、零提示复习解决 Gap | 通过 |
| 掌握度由新测评证据更新 | 通过（本地 reducer） |
| 延迟复习按证据时间排程 | 通过（虚拟时间测试） |
| 刷新后恢复本地状态 | 通过 |
| Staging 云端同步零冲突 | 未通过：2 个文档冲突 |
| 第二设备从云端恢复并重建同一掌握状态 | 未验证：云端推送前置条件失败 |
| Production 真实学习闭环 | 未验证；未向生产写入测试数据 |
| Production AI Provider / Reviewer | 未验证 |

**WP4 结论：本地真实学习闭环通过隔离验收；云端闭环与生产闭环尚未通过。KNOWVERSE 4.1 总体验收不能宣告完成。**


## 2026-11-15 补充

- 全专题图谱：12/12 topics，35 Concept，34 Competency，51 Gap，115 Review Assessment 变体。
- 八个此前 content-only 专题补充了 16 个可验证能力点、16 个薄弱点定义、32 个基础复习变体；AI 教育多模态能力增加第三个变体支持独立迁移验证。
- 16 个现有章节页面已接入 `learning-integration.mjs`，学习计划可从课程阅读推进到独立 assessment。
- Staging initialSync 在被动页面先完成 pull 后，观测到 `synced / 0 conflicts`；完整云端闭环与第二设备结果以最终 E2E 退出码为准。
- Repair task 统一使用 `taskType=assessment` + `resourceType=review`，保留精确 gap 因果验证，修复 Review Workspace 的提示辅助与独立验证状态处理。


## 2026-11-15 最终 Staging 结果
- Staging cloud E2E：未通过；initialSync `synced / 0 conflicts`，云端文档与事件在第二设备已恢复，但 Review Workspace 的无提示通过后 task 状态仍为 `in_progress`，未满足闭环验收。


## 2026-11-15 最终 Staging 结果
- Staging cloud E2E：未通过；initialSync `synced / 0 conflicts`，第二设备归档恢复已验证，但 Review task 在无提示独立通过后仍未完成。
