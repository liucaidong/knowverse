# N1 — Git 与生产 Migration 一致性核验

**当前状态：** COMPLETE（主线合并与版本清单核对完成）
**原始核验日期：** 2026-11-04
**合并确认日期：** 2026-11-04
**生产项目：** `sxcpareycpokcyroufww`

> 本报告保留 N1 合并前的原始审查记录。为避免篡改历史核验时点，以下原始结果不做追溯覆盖；当前状态以本节的合并后事实为准。

## 0. 合并后状态覆盖

| 项目 | 当前结果 |
|---|---|
| Git main | `b3c70374f147a651227675777934eac4adffea21` |
| PR #11 | MERGED，普通 merge，merge commit 与 main 当前 SHA 相同 |
| PR #10 | MERGED |
| OPEN PR（N1 交接时） | 0 |
| 本地分支（N1 交接时） | 仅 `main` |
| 远端分支（N1 交接时） | 仅 `origin/main` |
| 已合并旧分支 | `phase-m/authorize-initial-content-admin-2026-11-04`、`phase-m/production-hardening-2026-11-04` 已删除 |
| 合并后的 Validate | run `41746832395` SUCCESS |
| Pages 部署 | run `41746832366` SUCCESS |
| 生产 migration ledger | 12 条；版本和名称与 main migration 文件清单对应 |

生产 migration 清单和 GitHub main 现在在 version/name 层面一致；当前 main 包含 PR #11 的 migration。N1 的 Git 合并门槛因此已通过。

### 0.1 重要的 migration provenance 限制

Supabase migration ledger 记录 version/name，不提供已执行 SQL 内容 checksum。第 12 条 `20261103224708_phase_m_authorize_initial_content_admin` 在生产已应用之后，其仓库 SQL 文件被修订，以修复空 Auth 用户库重放失败和 `ON CONFLICT DO UPDATE` 覆盖既有 reviewer 授权状态的问题。

因此：
- 生产 ledger version/name 与仓库一致；
- 生产当时执行的原始 SQL 与当前仓库文件不是字节级相同；
- N1 合并没有重跑这条生产 migration；
- 未来在生产不能通过重放这条 migration 来“同步”文件内容；
- 生产当前 reviewer / allowlist 状态只做过只读核验，符合预期；
- 历史 SQL 差异应保留在风险登记和发布记录中，未来若需进一步修正，使用新的前向迁移并经过单独审查，而不是重写/重放已经执行的生产迁移。

## 1. GitHub / PR 合并记录

- PR #11：`https://github.com/liucaidong/knowverse/pull/11`，已合并。
- PR #10：已合并。
- 合并后本地切换至 `main` 并执行 fast-forward 更新。
- 两条已合并阶段分支已从本地和远端删除。
- 在 N1 交接时无 OPEN PR，且只保留 main；随后启动的 N2 工作另建执行分支 `phase-n/n2-sync-isolation-2026-11-04`，对应 PR #12 当前 OPEN。
- `docs/audits/` 为用户此前的本地未跟踪基线目录，始终保留且未纳入本次更改。

## 2. 生产 migration ledger

生产只读 migration 查询返回 12 条：

1. `20261102032732_learning_archive_documents`
2. `20261102090144_gap_causality_v3`
3. `20261102114344_phase_d_atomic_learning_batch`
4. `20261102165337_phase_e_learning_documents`
5. `20261102190100_phase_f_proactive_projection`
6. `20261103171219_phase_m_practice_quality_review_records`
7. `20261103171735_phase_m_practice_content_reviewer_rpc`
8. `20261103172836_phase_m_practice_registration_idempotency`
9. `20261103212233_phase_m_ordered_candidate_state_revisions`
10. `20261103221157_phase_m_restrict_audit_table_inserts`
11. `20261103221527_phase_m_enforce_audit_provenance_chain`
12. `20261103224708_phase_m_authorize_initial_content_admin`

版本/name 层面 main 与生产 ledger 一致。Supabase 不记录 SQL checksum，所以这不等于字节级内容 provenance 一致，具体限制见第 0.1 节。

## 3. 授权迁移缺陷与修订

### 原始问题 A：空 Auth 用户库重放失败

原文件直接插入特定 `auth.users.id`。在目标 Auth 用户不存在的全新数据库中，外键会阻断 migration。

### 原始问题 B：重放会覆盖现有授权状态

原文件的 `ON CONFLICT (user_id) DO UPDATE` 会重置现有审核员 role / enabled / note。对权限行而言，migration 重放不得自动撤销或恢复人工授权决定。

### 修订后的行为

- 仅在 `auth.users` 中目标身份已经存在时插入。
- `ON CONFLICT (user_id) DO NOTHING`，不会覆盖现有审核员记录。
- 目标用户缺失或 reviewer 未启用时输出 NOTICE，提示运维走独立 provisioning 流程。
- `supabase/operations/provision-content-admin.sql` 是需要人工填写身份和审批归属的独立脚本；本阶段未执行。

## 4. PostgreSQL 17 隔离迁移重放

`scripts/verify-supabase-migration-replay.sh` 在临时 PostgreSQL 17 容器中建立最小 Auth 兼容 schema，并分别验证：

| 场景 | 结果 |
|---|---|
| 空 Auth 用户库完整重放 12 条 migration | PASS |
| 预置合成 Auth 用户完整重放 | PASS |
| 最后一条 reviewer provisioning migration 重放不覆盖 disabled + sentinel note | PASS |

该环境不是托管 Supabase 的完整替代，但 SQL 在真实 PostgreSQL 17 引擎内执行。

## 5. 生产 reviewer / 权限只读核验

N1 对生产只执行 SELECT / 元数据 / ACL 检查，没有 INSERT、UPDATE、DELETE、DDL 或 Auth 设置更改。

历史核验得到：目标 Auth identity 存在；对应 reviewer 行 1 条且启用 content_admin；allowlist 1 条；普通客户端不能读取 private reviewer 表，也不能执行 reviewer lookup RPC；service_role 按受限 RPC 调用。

## 6. 当前验收结论

| 验收条件 | 状态 |
|---|---|
| PR #11 已合并到 main | PASS |
| 已合并阶段分支清理 | PASS |
| main / 生产 migration version/name 清单对齐 | PASS |
| 空 Auth / seeded Auth 的 PG17 重放 | PASS |
| 重放不覆盖 reviewer 记录 | PASS |
| 生产 reviewer 状态 / ACL 只读核验 | PASS |
| 已应用 migration 的 SQL checksum / 字节级 provenance | UNAVAILABLE / DISCLOSED |
| 生产 migration 重跑 | NOT PERFORMED / NOT ALLOWED |

**结论：N1 的 Git 合并、分支清理和 migration version/name 对齐门槛已完成。** 生产 migration 文本的历史 provenance 差异仍披露为风险，不能描述成 checksum 级完全一致。
