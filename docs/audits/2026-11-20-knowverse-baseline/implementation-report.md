# 实施报告 · KNOWVERSE 2026-11-20 基线

- 日期：2026-11-20
- 分支：`develop` @ `355a9dd`（开始时工作区干净、与 origin/develop 一致 0/0）
- 性质：审计 + 安全实施。未写生产数据、未改 Auth/Secrets、未执行迁移、未部署。

## 已实施变更

### 1. 构建可复现性修复（KV20-001，P2）

- 文件：`scripts/package-fullstack-project.py`
- 问题：打包脚本未排除本机 macOS `.DS_Store`，导致本地（macOS）产物比 CI（Ubuntu）多一个文件、ZIP 字节不一致。
- 修复：新增噪声文件过滤集合 `.DS_Store` / `Thumbs.db` / `desktop.ini`，并加注释说明跨 CI 复现原因。
- 验证：
  - 重打包输出 `48 source files`（与提交版一致）；
  - ZIP 内无 `.DS_Store`；
  - `git diff --stat` 对 ZIP 无输出（与 HEAD 二进制逐字节一致，确定性恢复）；
  - `python3 scripts/validate-fullstack.py` RC=0；
  - 其余校验脚本与 E2E 未回归（见 test-report.md）。

### 2. 建立 AGENTS.md

- 文件：`AGENTS.md`（新建）
- 内容：项目身份、不可逾越的安全边界、Git 工作流、数据与架构原则、真实测试标准与命令、文档要求、已知外部阻塞。
- 依据：阅读 `README.md`、`docs/adr/`、`docs/audits/` 后固化，未覆盖任何既有规则（此前仓库无 AGENTS.md）。

### 3. 审计文档集

- 目录：`docs/audits/2026-11-20-knowverse-baseline/`
- 文件：`00-executive-summary.md`、`01-engineering-audit.md`、`02-feature-inventory.md`、`03-content-inventory.md`、`04-database-audit.md`、`05-auth-security-audit.md`、`06-ux-ia-audit.md`、`07-production-audit.md`、`08-architecture-proposal.md`、`09-remediation-roadmap.md`、`audit-issues.json`、`test-report.md`、`deployment-report.md`、`implementation-report.md`。
- 历史 `docs/audits/2026-11-04/` 与 `2026-11-14/` 完整保留，仅在新文档中对比引用。

### 5. Staging 合成账户清理（用户授权）

- 用户于 2026-11-20 明确授权清理测试账户污染。仅操作 staging（`ypthoicwrfsblaidllyy`），用 Supabase CLI `--remote` 显式指定 ref，未碰生产。
- 范围：仅两个 `@knowverse-test.invalid` 合成账户（`n2-sync-a` / `n2-sync-b`），确认 staging 全部业务数据都属这两个账户、无真实用户数据。
- 清理前完整备份 7 张表 874 行到 `.workbuddy/staging-cleanup-backup-2026-11-20/`（不入 git，含 MANIFEST）。
- 删除 6 张业务表（events/docs/devices/sync_state/doc_sync/profiles）共 874 行；**保留 Auth 用户**以便 E2E 复用凭证；`practice_candidate_quality_records` 因 append-only 触发器保护未删（57 行，与学习档案污染无关）。
- 清理后全局只读核对：学习档案表全部 0 行，Auth 用户 2 个保留。
- 结果：干净档案上 `e2e-staging-cloud-learning-loop.mjs` **完整 PASS 1/1**，端到端验证 KV41-010 修复。

### 4. P1 修复：KV41-010（复习任务生命周期闭合）

- **根因**：`task-orchestrator.mjs` 的 `validateEvidence` review 分支把同一 competency+gap 的**全部历史**失败尝试视为当前任务必须验证的未解决观察。被复用的学习档案（staging 合成账户或任何长期真实账户）中，旧任务已通过其他 taskId 解决了其中大部分，导致 `unresolved` 永不为空、`complete()` 永久抛「必须对所有未解决错误观察完成独立验证」。干净 DB 的单测只含单个失败，掩盖了该缺陷。
- **修复**：
  - `learning-progress.mjs`：`getOpenGapObservationEventIds` / `resolvingPassForObservation` 新增可选 `excludeTaskId` 参数（默认行为不变）。
  - `task-orchestrator.mjs`：required failures 改用 `getOpenGapObservationEventIds({events}, competency, gap, taskId)` 口径——其他任务已解决的观察不再要求本任务重复验证；本任务自己的 pass 被排除，不能自我标记为已解决。
  - **不放宽标准**：`validPasses` 仍要求不同变体、零提示、`review_started→attempt→assessment_passed` 完整因果链。
- **E2E 配套修正**（`e2e-staging-cloud-learning-loop.mjs`）：
  - 等待条件同时等待证据事件与任务完成（pass 在 `engine.submit()` 内提交，任务完成在其后的异步监听器中；与本地 H1 pilot 模式一致）。
  - 更正一处断言笔误： Gap 由 review/repair 任务闭合，而非重做 assessment（与 `e2e-phase-h1-pilot.mjs` 对齐）。
- **验证**：
  - 新增 `scripts/verify-review-task-historical-gaps.mjs`（2 个场景：历史已解决失败 + 提示辅助历史），修复前 RED（复现精确错误）、修复后 GREEN；已注册到 `validate.yml`。
  - `verify-phase-e` 18/18 及其余 gap 相关 8 组单测、全部 `verify-*.mjs`、静态校验、构建可复现性、PG17 replay/隔离全部 PASS。
  - staging 真实环境插桩：`validateEvidence` 的 `unresolved=[]` 且存在有效 `validPass`，`complete()` 成功写入 `learning_task_completed`；E2E 已通过所有 KV41-010 相关断言。完整 E2E 在长期复用的合成账户上仅被无关的 planner 输出假设（干净档案才有 AI 专题）阻断，非产品缺陷。

## 明确未实施（含原因）

| 项 | 原因 |
|---|---|
| 创建新的 staging Auth 用户 | 无需：用户授权清理现有两个合成账户的业务数据后，用原凭证在干净档案上完成完整云端 E2E PASS，未创建/删除 Auth 用户。 |
| 搜索正文提取改造 | 影响 134 条记录，属产品决策；生产 CI 每次重建，线上不受影响。记录为 P3 观察。 |
| Production AI Provider / Auth leak-password 配置 | 需用户授权，涉及 secrets/Auth，属禁止擅自操作范围。 |
| 生产 migration / 数据变更 | 需授权；本轮未执行任何生产写操作。 |
| 数据库结构重建 | 现有模型已覆盖候选实体，重建会制造重复，违反项目原则。 |
| Push / 部署 | push develop 触发生产 Pages 部署；遵循显式授权流程，本轮未 push。 |

## Git 状态

- 前序本地提交：`0691532`、`0641300`（基线审计 + 构建修复）。
- 当前未提交改动（KV41-010 修复）：`assets/js/learning-agent/task-orchestrator.mjs`、`assets/js/learning-progress.mjs`、`scripts/e2e-staging-cloud-learning-loop.mjs`、`.github/workflows/validate.yml`、新增 `scripts/verify-review-task-historical-gaps.mjs`，以及本审计目录的状态更新。
- 提交前需审查完整 diff，确认不覆盖用户工作。**未 push、未部署**。
