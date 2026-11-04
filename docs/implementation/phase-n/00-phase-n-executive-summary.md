# KNOWVERSE Phase N — 执行摘要

**状态：** IN_PROGRESS
**执行起点：** 2026-11-04
**仓库：** `liucaidong/knowverse`
**工作目录：** `/Users/geeker/ai-projects/knowverse`
**生产 Supabase：** `sxcpareycpokcyroufww`

## 1. 当前结论

Phase N 已启动，严格按 N1 → N2 → N3 → N4 → N5 执行。当前只推进 N1（Git 主线与生产迁移一致性），尚未进入 N2。

N1 已完成代码审查、生产只读核对和 PostgreSQL 17 隔离迁移重放。发现 PR #11 的初始审核员授权迁移在空 Auth 用户库会因外键失败，且原 `ON CONFLICT DO UPDATE` 会在重复执行时覆盖已有授权记录。已在 PR #11 对应分支本地修正为：仅在 Auth 用户存在时插入，冲突时不更新，并提供独立的运维授权脚本。

**N1 尚未 COMPLETE。** GitHub PR #11 仍为 OPEN，尚无正式 Review，生产 `main` 仍未包含该迁移。未经维护者审查和明确批准，不执行合并、生产迁移、生产授权修改或部署。

## 2. 本次核验事实

- GitHub `main`：`a50eaca521b14acee16a4f5ac995923362f98a8e`。
- PR #11：OPEN，head 原始 SHA 为 `7b788f1e8d3bfe832a6b156a09918e2dff286c60`；单项 CI 检查 PASS；尚无提交 Review。
- 生产 Supabase migration ledger：12 条，包含 `20261103224708_phase_m_authorize_initial_content_admin`。
- 生产审核员表：1 行；启用的 `content_admin`：1 行；授权 allowlist：1 行。
- 生产候选审核记录：0 行；学习事件：0 行；学习档案文档：3 行；设备：1 行。
- 生产数据库只执行了 SELECT；没有改动生产数据、迁移、权限或函数。
- PostgreSQL 17 本地隔离兼容环境：12/12 迁移可在空 Auth 用户库和预置测试 Auth 用户库中执行。
- 已有审核员记录在手动重放迁移后保持原值，未被覆盖。
- 新增 `scripts/verify-supabase-migration-replay.sh`，并接入 GitHub Validate workflow；本机执行 PASS。

## 3. 阶段状态

| 子阶段 | 状态 | 说明 |
|---|---|---|
| N1 Git / Migration | IN_PROGRESS | 修复已准备；等待 PR 人工 Review 与合并审批 |
| N2 双设备 Supabase 同步 | BLOCKED | 必须先完成 N1；需要隔离 staging、测试账号和两台设备 |
| N3 真实 AI Provider | BLOCKED | 必须先完成 N2；需要 staging Provider 凭证及独立 Reviewer 凭证 |
| N4 AI 内容发布闭环 | BLOCKED | 必须先完成 N3；需要 staging 发布凭证和真实候选审批链 |
| N5 知识图谱扩展 | BLOCKED | 必须先完成 N4；优先评估 AI Agent 与 AI 教育专题 |

## 4. 安全边界

- 未合并任何 PR。
- 未向生产数据库写入测试数据或修改授权。
- 未向生产部署任何代码或内容。
- 未将密钥、访问令牌或生产凭证写入仓库。
- 未删除或重写用户已有的审计基线 `docs/audits/2026-11-04/`。
- 本阶段的本地数据库验证均使用临时 PostgreSQL 容器和合成 Auth 测试用户，不含生产业务数据。

## 5. 当前阻塞

1. PR #11 的迁移修复需要代码审查，并由维护者明确批准是否合并。
2. 迁移版本已经在生产执行过，当前源文件修订不能通过再次执行生产迁移来同步；只允许在未来按受控发布流程处理。
3. N2-N5 必须等待 N1 进入完成状态；没有隔离 staging / 测试账号 / Provider 凭证时，不得使用生产环境替代。

## 6. 后续交付

各子阶段验收后继续补齐本目录中的：

- `02-cross-device-sync-acceptance.md`
- `03-ai-provider-and-agent-acceptance.md`
- `04-ai-content-publishing-acceptance.md`
- `05-knowledge-graph-expansion.md`

本文件及 `01`、`06`、`07` 仅记录当前 N1 阶段证据，不代表 Phase N 完成。
