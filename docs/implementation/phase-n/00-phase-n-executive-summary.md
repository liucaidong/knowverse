# KNOWVERSE Phase N — 执行摘要

**总体状态：** IN_PROGRESS / NOT PRODUCTION READY
**执行起点：** 2026-11-04
**最新更新：** 2026-11-04
**仓库：** `liucaidong/knowverse`
**工作目录：** `/Users/geeker/ai-projects/knowverse`
**生产 Supabase：** `sxcpareycpokcyroufww`
**当前主线：** `main` @ `b3c70374f147a651227675777934eac4adffea21`

## 1. 当前结论

Phase N 严格按 N1 → N2 → N3 → N4 → N5 推进。

- **N1 已完成主线合并与分支清理。** PR #11 已正常合并到 main，PR #10/#11 均为 MERGED；相关阶段分支已删除，仅保留 main。合并后的完整 Validate workflow 成功，Pages 部署成功。
- **N2 已完成本地与隔离 PostgreSQL 集成验证，但真实托管 staging 验收仍 BLOCKED。** 新增的 PostgreSQL 17 测试执行仓库全部 12 条 migration，并以 authenticated 角色调用真实 RPC，验证原子提交、事件幂等、CAS 整批回滚、游标分页、RLS 跨账号隔离和设备归属。现有 Mac/Chromium + WebKit iPhone profile E2E 通过，但该浏览器 E2E 使用内存 Mock RPC，不能代替真实 Supabase。
- **当前没有独立 staging Supabase 项目或 development branch。** 账号中只发现生产项目；本阶段没有把生产环境用作测试环境，也没有创建任何 Supabase 项目/分支。
- N3、N4、N5 继续 BLOCKED，必须按顺序等待 N2 真实 staging 验收。

**KNOWVERSE 当前仍 NOT PRODUCTION READY。** 不得将 PostgreSQL 隔离测试、Mock E2E、静态分析或 Pages HTTP 200 描述成真实跨设备生产级闭环。

## 2. N1 合并事实

- GitHub PR #11：MERGED，普通 merge 流程，merge commit 为 `b3c70374f147a651227675777934eac4adffea21`。
- PR #10、#11 均已合并；相关远端和本地已合并分支已删除。
- 当前本地/远端仅保留 `main`；当前无 OPEN PR。
- 合并后的 Validate workflow：run `41746832395`，结论 SUCCESS。
- 合并后的 Pages deployment：run `41746832366`，结论 SUCCESS。
- 合并后发布候选 workflow：run `41746902080`，结论 SUCCESS。
- Git 工作区中用户既有的未跟踪 `docs/audits/` 目录仍被保留，未删除、覆盖或纳入本阶段提交。

### Migration 历史文本说明

生产 migration ledger 记录 version/name，不记录已执行 SQL 的内容 checksum。第 12 条 `20261103224708_phase_m_authorize_initial_content_admin` 已在生产执行后，仓库中的 migration 文件为了修复空 Auth 重放和权限记录覆盖问题而被修订。生产没有、也不得再次执行该版本。生产当前授权行在 N1 只读核验时符合预期；文件内容与历史实际执行文本的字节级差异仍作为已披露的 migration provenance 风险保留，不能宣称 checksum 级一致。

## 3. N2 已取得的证据

### 代码 / 本地浏览器验证

- `scripts/verify-backend-contract.mjs`
- `scripts/verify-local-learning-database.mjs`
- `scripts/verify-learning-state-storage.mjs`
- `scripts/verify-e2e-async-wait.mjs`

以上合计 **34/34 tests PASS**。

- `scripts/e2e-cross-device-archive.mjs`：**1/1 PASS**。覆盖桌面与移动视口、冷启动拉取、离线 Outbox、重连补传、事件幂等、档案 CAS 冲突与解决。其服务端 RPC 是进程内 Mock，因此仅作为浏览器和本地 IndexedDB 验证。

### PostgreSQL 17 真实 SQL / RPC 集成测试

新增 `scripts/verify-supabase-sync-isolation.sh`，接入 `.github/workflows/validate.yml`。

该脚本在临时 Docker PostgreSQL 17 中执行仓库全部 12 条 migration，使用合成 Auth 用户和本地兼容的 `auth.uid()` shim；随后切换为 `authenticated` 角色调用真实迁移创建的数据库 RPC。已通过：

1. 同一用户两个设备注册与归属校验。
2. 学习事件和版本化档案文档的原子提交。
3. 相同 event ID / payload / device sequence 的幂等重试。
4. 文档 stale revision 触发 CAS 冲突；验证同批已先写入的新文档和事件均未提交。
5. 冲突解决后新 revision 和事件可以正常提交。
6. 事件分页游标与 has_more 行为。
7. 账号 B 不能读取账号 A 的学习事件和档案文档。
8. 账号 B 不能使用账号 A 的 expected_user_id 或设备 ID 进行同步。

脚本结果：**SUCCESS: PostgreSQL 17 Supabase sync isolation checks passed.**

该测试真实执行 PostgreSQL SQL、RLS 和业务 RPC，但使用最小 Supabase Auth 兼容 schema，不是托管 Supabase 项目的完整克隆，不包含托管 Auth、PostgREST、JWT 签发、网络、真机或真实浏览器到 Supabase 的端到端调用。

### 生产只读权限核验

本阶段对生产只执行 SELECT / 元数据权限检查：

- 学习事件、档案、设备和同步状态表：anon 无表级读写权限；authenticated 具备业务所需的最小表级权限，并受 `auth.uid()`、allowlist 和 RLS owner policy 约束。
- `practice_candidate_quality_records`：authenticated 仅 SELECT；service_role 可 SELECT/INSERT，但 UPDATE/DELETE/TRUNCATE 等被拒绝；写入经受控 RPC。
- 相关学习表 RLS 均启用，policy owner 限制匹配当前 Auth 用户和授权状态。
- 未向生产创建账号、设备、事件或文档。

## 4. 阶段状态

| 子阶段 | 状态 | 说明 |
|---|---|---|
| N1 Git / Migration | COMPLETE（主线流程） | PR #11 正常合并；分支清理；全量 main CI 成功。历史 migration SQL 字节级差异单独披露，不做生产重放 |
| N2 双设备 Supabase 同步 | IN_PROGRESS / BLOCKED | 本地浏览器 + PG17 真实 SQL/RPC 集成验证通过；缺独立托管 staging 和真实 Auth 双设备验收 |
| N3 真实 AI Provider | BLOCKED | 必须先 N2；需要隔离 staging Provider 凭证及独立 Reviewer 凭证 |
| N4 AI 内容发布闭环 | BLOCKED | 必须先 N3；需要 staging 发布凭证和真实候选审批链 |
| N5 知识图谱扩展 | BLOCKED | 必须先 N4；选择 AI Agent 与 AI 教育等主题构建正式图谱 |

## 5. N2 剩余准入项

1. 在用户明确授权的组织下建立独立 staging Supabase 项目；不得使用生产项目或复制生产个人数据作为测试样本。
2. staging 完整应用 main migration，并执行托管 Supabase 自身 Auth / PostgREST / RLS 验收。
3. 建立两个合成测试 Auth 用户：同账号两设备同步；另一账号隔离拒绝。
4. 在真实浏览器中完成 Mac 与第二台真实设备的 cold restore、事件/文档同步、离线补传、CAS 冲突解决、重复提交和重试。
5. 保存 request / response 状态、数据库行数与游标变化、设备注册信息、测试时间和清理证据；测试结束清理全部 staging 测试数据。
6. 对实体 iPhone Safari 的系统权限、后台恢复、键盘、弱网行为做单独验收；WebKit 自动化不能替代实机。

## 6. 安全边界

- 本阶段未向生产执行 INSERT、UPDATE、DELETE 或 DDL。
- 未创建、删除或修改生产 Auth 用户、session、device、allowlist 或 reviewer 记录。
- 未修改生产 RLS / grants、Edge Functions、Secrets 或 Auth 设置。
- 未将密钥、访问令牌或生产凭证写入仓库。
- 所有新增 SQL 集成数据均来自合成用户，并在本机临时 PostgreSQL 容器内执行。
- 用户本地 `docs/audits/` 保持原样。

## 7. 后续交付

- `02-cross-device-sync-acceptance.md`：N2 验收记录与剩余 staging 验收。
- `03-ai-provider-and-agent-acceptance.md)：N3。
- `04-ai-content-publishing-acceptance.md)：N4。
- `05-knowledge-graph-expansion.md`：N5。

Phase N 不能因为 N1 合并、CI 通过或 N2 本地测试通过而宣布 COMPLETE。
