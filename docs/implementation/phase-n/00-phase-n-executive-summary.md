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

- **N1 已完成主线合并与分支清理。** PR #11 已正常合并到 main，PR #10/#11 均为 MERGED；N1 阶段旧分支已清理。随后为 N2 独立创建执行分支并打开 PR #12。N1 合并后的完整 Validate workflow 成功，Pages 部署成功。
- **N2 已通过托管 Supabase 认证态 HTTP 验收，并新增真实应用页面的 Mac Chromium staging E2E PASS。** 真实浏览器登录 Account A 后完成本机 IndexedDB 初次恢复、自动同步、手动同步、pull-only 云端恢复和刷新后恢复；两个派生快照的时间戳假冲突已自动消除，冲突数为 0，RPC 全部 HTTP 200，浏览器错误为 0。仍未完成第二台真实设备 / 实体 iPhone Safari、离线 Outbox、session refresh 和弱网闭环。
- **独立 staging Supabase 项目已建立。** `knowverse-staging`（`ypthoicwrfsblaidllyy`，`eu-west-1`）已应用全部 12 条 migration；匿名表访问和同步 profile RPC 的真实 HTTP 请求均被拒绝。没有把生产环境用作测试环境，也没有复制生产用户或学习数据。
- N3、N4、N5 继续 BLOCKED，必须按顺序等待 N2 真实 staging 验收。

**KNOWVERSE 当前仍 NOT PRODUCTION READY。** 不得将 PostgreSQL 隔离测试、Mock E2E、静态分析或 Pages HTTP 200 描述成真实跨设备生产级闭环。

## 2. N1 合并事实

- GitHub PR #11：MERGED，普通 merge 流程，merge commit 为 `b3c70374f147a651227675777934eac4adffea21`。
- PR #10、#11 均已合并；相关远端和本地已合并分支已删除。
- **N1 交接时：** 本地 / 远端仅保留 `main`，无 OPEN PR。**N2 当前：** 执行分支 `phase-n/n2-sync-isolation-2026-11-04`，PR #12 OPEN，最新提交 `27cfd2fbf1456140ea20ae6a9c9fb8452ac61f09`。
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
- 2026-11-04 再次将上述 34 项 core tests 与该跨设备 E2E 合并执行：**35/35 PASS**；这仍不等价于托管 Supabase HTTP 验收。

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
| N2 双设备 Supabase 同步 | IN_PROGRESS / HOSTED AUTH HTTP PASS / MAC CHROMIUM STAGING E2E PASS / SECOND DEVICE PENDING | staging 真实 Auth/JWT/PostgREST/RPC 和 Mac 真实页面客户端同步通过；仍缺第二真实设备、实体 iPhone Safari、离线补传、session refresh 与弱网验证 |
| N3 真实 AI Provider | BLOCKED | 必须先 N2；需要隔离 staging Provider 凭证及独立 Reviewer 凭证 |
| N4 AI 内容发布闭环 | BLOCKED | 必须先 N3；需要 staging 发布凭证和真实候选审批链 |
| N5 知识图谱扩展 | BLOCKED | 必须先 N4；选择 AI Agent 与 AI 教育等主题构建正式图谱 |

## 5. N2 剩余准入项

1. **已完成：** 在已授权组织下建立独立 staging Supabase 项目，并应用 main 全部 12 条 migration；不得使用生产项目或复制生产个人数据作为测试样本。
2. **已完成：** 托管 Supabase anon HTTP denial 验证通过；真实 Auth / JWT / PostgREST / RPC HTTP 验收也已通过，包括 A 双设备 pull、atomic commit、幂等、CAS 冲突整批回滚与恢复、B 跨账号 / 身份伪造 / 设备伪造拒绝。
3. **已完成 Mac Chromium staging 客户端首轮验收；仍待完成：** 第二台真实设备的 IndexedDB cold restore / 双向同步、离线 Outbox 补传、session refresh、弱网与重试验证；以及实体 iPhone Safari 后台 / 恢复验收。
4. 在第二台真实设备完成与 Mac 的事件 / 文档同步、离线补传、CAS 冲突解决、重复提交和重试。
5. 保存 request / response 状态、数据库行数与游标变化、设备注册信息、测试时间和清理证据；测试结束清理全部 staging 测试数据。
6. 对实体 iPhone Safari 的系统权限、后台恢复、键盘、弱网行为做单独验收；WebKit 自动化不能替代实机。

## 6. 安全边界

- 本阶段未向生产执行 INSERT、UPDATE、DELETE 或 DDL。
- 未创建、删除或修改生产 Auth 用户、session、device、allowlist 或 reviewer 记录。
- 未修改生产 RLS / grants、Edge Functions、Secrets 或 Auth 设置。
- 未将密钥、访问令牌或生产凭证写入仓库。
- PG17 集成数据来自本机临时 PostgreSQL 容器中的合成用户；托管 HTTP 测试写入仅限独立 staging 的两个合成 Auth 用户及其测试设备 / 事件 / 文档。
- 用户本地 `docs/audits/` 保持原样。

## 7. 后续交付

- `02-cross-device-sync-acceptance.md`：N2 验收记录与剩余 staging 验收。
- `03-ai-provider-and-agent-acceptance.md)：N3。
- `04-ai-content-publishing-acceptance.md)：N4。
- `05-knowledge-graph-expansion.md`：N5。

Phase N 不能因为 N1 合并、CI 通过或 N2 本地测试通过而宣布 COMPLETE。


## 8. N2 staging 项目最新状态（2026-11-04）

- 已按用户授权创建独立 Supabase 项目 `knowverse-staging`，项目 ID `ypthoicwrfsblaidllyy`，区域 `eu-west-1`，API URL `https://ypthoicwrfsblaidllyy.supabase.co`。
- Supabase 项目创建费用报价：`US$0/month`。该值是当前项目创建报价，不构成对未来超额用量或平台套餐变化的承诺。
- staging 当前已成功应用仓库全部 12 条 migration。Supabase migration ledger 生成 12 条记录，名称顺序与 main 一致；migration version 为 staging 应用时生成的时间戳。
- 本节建立时 staging Auth / allowlist / reviewer / devices / learning_events / archive_documents / quality_records 行数均为 0；后续托管验收产生的合成测试数据与最新计数见第 9 节。没有复制生产数据。
- staging anon 对 learning_events 和 sync profile RPC 的真实 HTTP 请求均返回 401 permission denied。Authenticated sync RPC 仅 authenticated 可执行；审核写入 RPC 只允许 service_role。
- 初始 Auth 用户创建阶段曾遇到管理接口能力限制；随后通过 Dashboard 建立两个合成用户，并由用户在本机通过受支持的 Auth Admin API 更新临时密码。没有直接 DML 写 `auth.users`、伪造 JWT 或借用生产用户。
- 最新认证态 HTTP 测试已经通过；真实客户端离线 / 冷恢复和实体 iPhone Safari 仍未完成，N2 不 COMPLETE。


## 9. N2 托管真实认证态 HTTP 验收最新结果（2026-11-04）

- 用户本机执行 scripts/e2e-hosted-supabase-sync.mjs，输出 RESULT: PASS。
- 真实 Auth 密码登录与 JWT、email confirmation、两账号 allowlist、A 双设备 / B 单设备注册均通过。
- 真实 PostgREST / RPC：原子 event + archive document commit、第二设备 pull、跨设备幂等重试、CAS 冲突整批回滚、正确 revision 恢复提交均通过。
- 真实跨账号验证：B 无法读取 A 的事件 / 文档，不能伪造 A 的 expected_user_id，也不能借用 A 的 device ID。
- staging 只读计数：2 个测试 Auth users、3 个 user_devices、2 个 learning_events、1 个 learning_archive_documents。
- GitHub Actions Validate run #149（41762882174）SUCCESS；PR #12 保持 OPEN，未合并。
- 末尾 zsh / Powerlevel10k P9K_GCLOUD_PROJECT_NAME: parameter not set 为命令结束后的提示符配置问题，不影响已经输出的 harness RESULT: PASS。

**N2 当前状态：IN_PROGRESS / HOSTED AUTHENTICATED HTTP PASS / MAC CHROMIUM STAGING E2E PASS / SECOND REAL DEVICE PENDING。** 继续完成第二台真实设备双向同步、离线 Outbox、session refresh、弱网和实体 iPhone Safari 测试。Phase N 总体仍 IN_PROGRESS / NOT PRODUCTION READY。


## 10. N2 Mac Chromium 真实 staging 页面验收与冲突修复（2026-11-04）

- 使用本机隔离 staging 静态预览副本；预览 public-config.js 固定指向 staging URL，生产 Pages 与生产 Supabase 未修改。
- DevTools Protocol 首先定位出单线程静态服务器在模块并发加载时的 ERR_CONNECTION_RESET；改为 ThreadingHTTPServer 后，所有应用模块正常加载。
- 修复档案冲突处理：learner_profile/strategy 的 updatedAt 与 observedWindow.from/to 只作为派生时间元数据比较；策略参数、历史、证据和用户决策仍严格比较。proactive_learning_projection/current 被明确作为本机可重建缓存，不再上传 / 拉取；旧缓存冲突自动退役，云端事件恢复后通过事件日志重建。
- 修复冲突面板字段映射：档案类型与键从 conflict.remote.document_type/document_key 读取，并显示本机 / 云端修订，不再渲染 undefined · undefined。
- 新增 scripts/verify-archive-conflicts.mjs，10/10 PASS；与 backend contract、local IndexedDB、Phase F / G 一起运行，72/72 PASS。
- 新增本机真实托管浏览器回归 scripts/e2e-hosted-browser-sync.mjs：自动登录 Account A，先完成初始同步再计算策略，自动同步、手动同步、pull-only 恢复、页面刷新全部 PASS；冲突 0、待上传项 0、IndexedDB 可用、28 次已观测 RPC 全部 HTTP 200、浏览器错误 0。
- 第二台物理设备和 iPhone Safari 尚未验收；N2 仍 IN_PROGRESS，Phase N 仍 NOT PRODUCTION READY。
