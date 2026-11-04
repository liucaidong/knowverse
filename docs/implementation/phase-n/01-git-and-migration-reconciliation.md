# N1 — Git 与生产 Migration 一致性核验

**状态：** PREPARED / AWAITING REVIEW
**核验日期：** 2026-11-04
**生产项目：** `sxcpareycpokcyroufww`

## 1. GitHub / PR 状态

| 项目 | 核验结果 |
|---|---|
| 远端 `main` | `a50eaca521b14acee16a4f5ac995923362f98a8e` |
| PR #11 | OPEN、非 Draft、可合并 |
| PR URL | https://github.com/liucaidong/knowverse/pull/11 |
| PR base | `main` @ `a50eaca521b14acee16a4f5ac995923362f98a8e` |
| PR 原始 head | `7b788f1e8d3bfe832a6b156a09918e2dff286c60` |
| PR 检查 | 1 项 `check` PASS（run 41734045983） |
| 正式 Review | 未发现已提交 Review |
| 合并 | 未执行 |

本地工作分支为 `phase-m/authorize-initial-content-admin-2026-11-04`。本地 `main` 在核验时落后远端两个提交，不作为远端主线依据。工作区中存在用户提供的未跟踪 `docs/audits/`，已完整保留且未纳入本次更改。

PR #11 唯一新增的 migration 文件为：

`supabase/migrations/20261103224708_phase_m_authorize_initial_content_admin.sql`

## 2. 生产 migration ledger

通过 Supabase 管理接口只读获取，生产有 12 条迁移，顺序如下：

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

**版本名层面：** 生产 ledger 的第 12 条与 PR #11 migration 文件完全对应。
**发布状态层面：** 生产已应用该版本，但 `main` 尚未包含该文件，PR 仍 OPEN，因此 Git 主线与生产发布状态尚未完全对齐。

Supabase migration ledger 记录 version/name，不提供已执行 SQL 文件的内容 checksum。由于本次修复发生在生产迁移已应用之后，当前仓库文件与历史执行时的原始 SQL 文本并非字节级相同。生产没有也不应再次执行该版本。当前修订是对后续全新环境重放语义的修复；生产现有授权记录经只读核验仍满足预期状态。

## 3. 授权迁移审查发现

### 原始问题 A：空 Auth 用户库重放失败

原文件直接插入一个指定 `auth.users.id`。在没有该 Auth 用户的干净数据库中，外键会拒绝插入，导致迁移序列第 12 条失败。

### 原始问题 B：重复执行会覆盖授权数据

原文件的 `ON CONFLICT (user_id) DO UPDATE` 会将已存在记录强制改成 `content_admin`、`enabled=true` 并覆盖备注。对权限记录而言，不应由迁移重放自动恢复或覆盖人工撤销。

### 当前修订

当前 PR 工作分支的 migration 已改为：

- 从 `auth.users` 查询目标身份；身份不存在时跳过数据授权，不影响 schema migration 完成。
- 使用 `ON CONFLICT (user_id) DO NOTHING`，绝不覆盖已有审核员记录。
- 当目标身份缺失或已有记录不是启用的 content_admin 时输出 NOTICE，提示运维人员单独处理。
- 单独增加 `supabase/operations/provision-content-admin.sql` 运维脚本。它要求操作员明确填写 Auth UUID 和审批归属；目标用户不存在时失败；现有冲突记录不会被静默更新。

运维脚本目前只有占位符，未执行，也不包含具体用户 UUID。

## 4. PostgreSQL 17 隔离重放结果

在本机临时 PostgreSQL 17 容器中建立兼容性测试环境：创建最小 `auth` schema、`auth.users`、`auth.uid()` 及 Supabase 应用角色，然后分别测试两套独立数据库。该 bootstrap 不是 Supabase 托管实例的完整替代，但迁移 SQL 在 PostgreSQL 17 引擎中真实执行。

| 场景 | 结果 | 证据 |
|---|---|---|
| 空 Auth 用户库 | PASS | 12/12 migrations 全部执行；Auth 用户 0、Reviewer 0 |
| 预置合成 Auth 用户 | PASS | 12/12 migrations 全部执行；Reviewer 1、启用 content_admin 1 |
| 已有记录冲突重放 | PASS | 先把测试 Reviewer 设为 disabled 并写入 sentinel note，再重放第 12 条；两项值保持不变 |

PostgreSQL 16 临时容器也执行过同等的早期检查；最终验收以 PostgreSQL 17 的两库结果为准。全部测试使用隔离数据库和合成 Auth 记录，不含生产业务数据。

为防止回归，新增 `scripts/verify-supabase-migration-replay.sh`，并将它加入 `.github/workflows/validate.yml`。该脚本自动创建临时 PostgreSQL 17 容器、分别重放空 Auth 与预置 Auth 两个数据库，并断言空环境不会制造审核员、已存在身份只产生一条启用记录，以及最后一条数据迁移重放不会覆盖 sentinel 权限状态。脚本在本机完整执行通过。

## 5. 生产授权与权限边界（只读）

生产只读核验结果：

| 检查项 | 结果 |
|---|---|
| 目标 Auth 身份存在 | 是 |
| 与之对应的 reviewer 记录 | 1 行 |
| 启用的 content_admin | 1 行 |
| private.authorized_users | 1 行 |
| practice_candidate_quality_records | 0 行 |
| learning_events | 0 行 |
| learning_archive_documents | 3 行 |
| user_devices | 1 行 |

权限核验：

- `anon` 不具备 private schema USAGE。
- `anon`、`authenticated` 均没有 `private.practice_content_reviewers` 的 SELECT 权限。
- `anon`、`authenticated` 均不能执行 reviewer lookup RPC。
- `service_role` 可执行审核员 lookup 函数。
- `public.is_practice_content_reviewer(uuid)` 是限制为 service_role 调用的包装函数；内部函数使用空 search_path。
- 审核 Edge Function 通过 Supabase 已验证的 user claims 获取用户身份，再由 service-role RPC 判定审核员权限；不接受请求体自报角色。
- `supabase/config.toml` 只暴露 `public` schema，不包含 `private`。

未发现该迁移引入面向普通浏览器用户的审核员读取/调用权限扩张。

## 6. 生产变更与回滚策略

本阶段没有执行以下任何操作：

- 没有重跑生产 migration。
- 没有修改生产 reviewer / allowlist 记录。
- 没有撤销或授予生产权限。
- 没有合并 PR #11。
- 没有部署 Pages 或 Edge Function。

迁移一旦在生产执行，不通过逆向删除授权行来“回滚”。若未来需要撤销审核员，应由授权管理员执行单独、可审计的禁用操作，并核对目标身份与审批记录；不能依赖 migration replay 或修改历史 migration 隐式变更权限。

## 7. N1 验收结论

| 验收条件 | 状态 |
|---|---|
| PR migration 文件与生产 ledger version/name 对齐 | PASS |
| 空数据库迁移重放 | PASS（PostgreSQL 17 兼容隔离环境） |
| 预置 Auth 用户迁移重放 | PASS（PostgreSQL 17 兼容隔离环境） |
| 重放不覆盖既有权限记录 | PASS（PostgreSQL 17 兼容隔离环境） |
| 生产审核员身份与记录一致 | PASS（只读核验） |
| 普通用户无法调用审核员权限 RPC | PASS（ACL 核验） |
| Git main 包含该 migration | BLOCKED：PR #11 尚未合并 |
| PR 获得正式人工 Review / 合并批准 | BLOCKED：尚无提交 Review |

**结论：N1 修复准备完成，但 N1 阶段仍为 IN_PROGRESS。** 最终主线一致性必须由维护者审查并批准 PR #11 后才能成立。不得把当前状态标记为 COMPLETE。
