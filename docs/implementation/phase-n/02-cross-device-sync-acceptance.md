# N2 — Supabase 跨设备学习同步验收记录

**状态：** IN_PROGRESS / HOSTED AUTHENTICATED HTTP PASS / MAC CHROMIUM STAGING BROWSER PASS / SECOND REAL DEVICE PENDING
**更新日期：** 2026-11-12
**代码基线：** `develop` @ `1c8f516cc85869a1bb5c21cc18ca943c843ef683`
**生产 Supabase：** `sxcpareycpokcyroufww`（仅用于只读权限核验）

## 1. 验收结论

N2 已补齐两层隔离验证：

1. 浏览器 / IndexedDB 层：桌面与移动视口的 Mock RPC E2E 通过。
2. 数据库层：临时 PostgreSQL 17 执行仓库全部 12 条 migrations，并以 authenticated 角色调用真实 SQL RPC，原子提交、幂等、CAS 整批回滚、分页和 RLS 跨账号隔离通过。

**N2 真实托管认证态 HTTP 与 Mac Chromium 真实应用页面验收已通过，但 N2 尚未完成。** 在 staging 上，两个合成账号真实登录并通过 JWT / allowlist 验证；A 两设备、B 一设备、原子提交、pull、幂等、CAS rollback / recovery、账号隔离全部 PASS。随后真实 KNOWVERSE 页面在 Mac Chromium 中登录 Account A，完成 IndexedDB 初次恢复、先同步再计算策略 / 投影、自动 / 手动同步、pull-only 云端恢复和页面刷新；2026-11-12 再次复验通过：28 个托管 RPC 响应全部 HTTP 200、冲突 0、待上传事件 / 文档 0、浏览器错误 0，pull-only 恢复没有调用批量写入 RPC。仍未完成第二台真实设备的同步 / 离线补传、session refresh、弱网恢复及实体 iPhone Safari 验收。

## 2. N2 验收边界

本阶段验证的对象是用户个人学习数据在本地 IndexedDB 与云端之间的同步协议：

- append-only Learning Events：稳定 event ID、device sequence、server user sequence、payload hash 和增量游标。
- resumable archive documents：版本号、base revision、local revision、server document sequence 和 CAS 冲突。
- 设备身份：同一账号可以注册多台设备；设备必须属于当前 Auth user 且未撤销。
- Auth 边界：同步调用使用当前 JWT 身份；客户端提供的 expected user ID 必须与 `auth.uid()` 一致。
- RLS 隔离：每个账号只能读取本账号事件、文档、同步状态和设备。
- Offline-first：本地写入与 Outbox 原子提交；云端成功确认后才清理 Outbox；网络恢复后继续补传。
- Restore：首次恢复是 pull-only，不会偷偷将本机未确认数据推送上云。
- Conflict：CAS 冲突不丢本机内容；需要显式选择本地或云端版本后再次同步。

## 3. 执行环境

| 环境 | 使用方式 | 数据 | 证据等级 |
|---|---|---|---|
| Mac 本地浏览器 | Chromium / Playwright | IndexedDB 测试数据 | 本地浏览器验证 |
| Playwright WebKit iPhone profile | WebKit 模拟设备视口 | IndexedDB 测试数据 | 浏览器引擎验证，不是真机 |
| 本机 Docker PostgreSQL 17 | 重放仓库全部 12 条 SQL migration，并调用数据库 RPC | 合成 Auth 用户 / 设备 / 事件 / 文档 | 数据库 SQL / RLS / RPC 集成验证 |
| Supabase 生产项目 | 只读查询 migrations、table grants、RLS policies、行数元数据 | 生产现有数据，只读 | 生产权限和结构观测，不是同步验收 |
| Supabase staging | `knowverse-staging` (`ypthoicwrfsblaidllyy`)，12/12 migrations PASS | 2 个合成 Auth 用户、20 个设备、4 个学习事件、4 个档案文档、0 个候选审核记录 | 真实 Auth / JWT / PostgREST / RPC HTTP 与 Mac Chromium 页面验收 PASS；第二台实体设备和 iPhone 尚待验收 |

## 4. 测试清单与结果

### 4.1 本地 Backend / IndexedDB contract tests

命令：

```bash
node --test \
  scripts/verify-backend-contract.mjs \
  scripts/verify-local-learning-database.mjs \
  scripts/verify-learning-state-storage.mjs \
  scripts/verify-e2e-async-wait.mjs
```

结果：**34/34 PASS**。

重点覆盖：
- 同一 IndexedDB transaction 保存事件、Outbox、设备元数据和文档。
- event ID 稳定幂等；相同 ID 不允许被不同内容覆盖。
- 文档本地 CAS 失败会阻止同批本地事件 / Outbox 写入。
- 远端事件合并不重新进入本地 Outbox。
- 本地 account binding 原子化；登录账号切换后禁止读取旧账号数据。
- Sync lease 排除并发 tab。
- v1 → v4 IndexedDB 数据升级以及旧数据完整性。
- 远端档案可以恢复进行中的 Review Session 和偏好。

### 4.2 Mac + WebKit iPhone-profile browser E2E

命令：

```bash
node --test scripts/e2e-cross-device-archive.mjs
```

结果：**1/1 PASS**。

覆盖：
- Mac 初次上传学习事件和挑战进度文档。
- 移动端拉取事件、挑战状态并恢复。
- iPhone cold storage context pull-only restore，恢复事件、Review Session、偏好。
- Mac 和移动端两端增量合并；事件顺序由服务器 sequence 决定，不依赖设备墙上时钟。
- 移动端离线写入 Outbox，网络恢复后自动补传。
- 两端同时编辑同一个文档时发生 CAS 冲突；记录冲突，用户选择本地版本后 revision 再次提交。
- 浏览器页面错误 / console error 为空。

**限制：** 此脚本在 `createCloudMock()` 中维护内存事件和文档 Map，并由 harness RPC 代理响应。它不访问托管 Supabase；“Mac + iPhone”是 Playwright 浏览器配置 / WebKit profile，不是真实 Mac 与实体 iPhone 上的 Supabase 网络验收。

### 4.3 全量 migration replay

命令：

```bash
bash scripts/verify-supabase-migration-replay.sh
```

结果：**PASS**。

PG17 临时容器分别从空 Auth 用户库和预置合成 Auth 用户库重放 12 条 migrations；验证目标 reviewer provision 在空库不会创建不存在的用户引用，预置用户只创建一条 reviewer；再次重放不覆盖已有 reviewer 的 disabled / sentinel note。

### 4.4 新增真实 SQL / RPC 集成门禁

脚本：`scripts/verify-supabase-sync-isolation.sh`

命令：

```bash
bash scripts/verify-supabase-sync-isolation.sh
```

结果：**PASS**。

脚本执行方式：
- 启动临时 Docker PostgreSQL 17。
- 创建最小兼容 `auth.users` 和 `auth.uid()` 接口、Supabase 角色。
- 执行仓库全部 12 条 migrations。
- 使用合成用户 A / B 建立 Auth identity 和 test-only allowlist。
- SQL 测试切换为 `authenticated`，设置当前测试 JWT subject claim，实际调用 migrations 创建的 `register_device`、`sync_commit_learning_batch`、`sync_pull_learning_events_for_account` RPC。

结果断言：

| 场景 | 实际验证 | 结果 |
|---|---|---|
| 同一账号两设备注册 | 账号 A 注册桌面设备 A1 和移动设备 A2 | PASS |
| Atomic push | 一个 RPC 同时提交 event 与 archive document | PASS |
| Event idempotency | 相同 event ID / payload / device sequence 重试 | PASS |
| CAS conflict | A2 对 A1 的 stale revision 发起更新 | PASS |
| 整批回滚 | 冲突批次先插入的另一个新文档 + 同批 event 最终均不存在 | PASS |
| Conflict recovery | 以正确 base revision 重试，event 和新文档一起成功提交 | PASS |
| Event pagination | page size 1，next_cursor 和 has_more 正确 | PASS |
| Cross-account RLS | 账号 B 查询账号 A 的 event/document 返回 0 行 | PASS |
| Expected-user spoofing | B 的 JWT 携带 A 的 expected_user_id 调用 pull RPC | PASS，拒绝 |
| Device spoofing | B 使用 A 的 device ID 进行写入 | PASS，拒绝 |

此测试执行真实 PostgreSQL 业务 RPC / RLS，不是 mock RPC；但是 Auth schema 只实现迁移所需的最小兼容接口。它没有测试 Supabase 托管 Auth、JWT 真实签名与刷新、PostgREST、HTTP/API key、网络波动或真实浏览器 session，因此证据等级止于本机 PostgreSQL 集成测试。

### 4.5 生产只读 RLS / GRANT 核对

项目：`sxcpareycpokcyroufww`。

查询范围只限系统表和 ACL：
- public 核心学习表均已启用 RLS。
- anon 对 learning_events、learning_archive_documents、user_devices、user_sync_state、user_document_sync_state 无 SELECT / INSERT / UPDATE / DELETE table privilege。
- authenticated 对这些表具备所需权限，但 RLS policy 要求 `user_id = auth.uid()` 且账户 allowlist active。
- `practice_candidate_quality_records`：authenticated 仅 SELECT；service_role SELECT / INSERT；没有 UPDATE / DELETE / TRUNCATE；policy 仅允许用户读取自己的审核历史。
- production migration ledger 返回 12 条，版本与 main 文件清单对应。

这是生产只读权限核验，不表示已经在生产执行同步。生产没有插入测试用户、设备、事件或文档。

## 5. 本轮新增代码

| 文件 | 变更 |
|---|---|
| `scripts/verify-supabase-sync-isolation.sh` | 新增 PG17 全量 migration + authenticated RPC / RLS 整合测试 |
| `.github/workflows/validate.yml` | 新增 CI 步骤，强制执行 sync isolation script |
| `docs/implementation/phase-n/00-phase-n-executive-summary.md` | 更新 N1 / N2 当前状态 |
| `docs/implementation/phase-n/01-git-and-migration-reconciliation.md` | 补充 N1 merge 后事实 |
| `docs/implementation/phase-n/06-risk-register.md` | 更新 AUD-P1 状态与 staging 阻塞 |
| `docs/implementation/phase-n/07-production-readiness-report.md` | 更新生产准入结论 |
| `docs/implementation/phase-n/02-cross-device-sync-acceptance.md` | 本验收记录 |

## 6. staging 验收后的剩余工作

独立 staging 项目和真实认证态 HTTP 验收已经完成。staging 项目为 knowverse-staging（ypthoicwrfsblaidllyy，eu-west-1），未使用 production 数据或身份。

托管 HTTP 验收已覆盖真实 Auth 密码登录与 JWT、A/B allowlist、A 两设备 / B 一设备注册、事件 + 文档原子提交、第二设备拉取、重复提交幂等、CAS 冲突整批回滚和恢复、跨账号 RLS / identity spoof / device spoof 拒绝。当前数据库观测到的合成测试数据为：2 个 Auth users、3 个 device rows、2 个 learning_events、1 个 learning_archive_documents。

N2 剩余工作收敛为：
1. Mac Chromium 真实应用页面与 staging Account A 的首次认证、IndexedDB 冷恢复、自动 / 手动同步、pull-only 恢复和刷新已 PASS。
2. 通过第二台真实设备登录同一账号，完成双向同步、离线 Outbox、重连补传、重复请求、真实 CAS 冲突解决、session refresh、网络超时 / 弱网和设备撤销。
3. 保存浏览器 request / response、服务端行数、cursor / revision、设备信息和测试时间；所有客户端验收结束后再清理 staging 合成账号及其级联测试数据。
4. 对实体 iPhone Safari 单独验证系统权限、键盘、后台恢复和弱网行为；Playwright WebKit 不能替代真机。

生产环境仍只做过只读核验；所有写入均限定在 staging。

## 7. 阶段退出标准

N2 只有在以下项目全部 PASS 后才能标记 COMPLETE：

- 独立 hosted staging 已建立并从 main migrations 重建成功。
- Auth 用户 A 在真实 Mac 和真实第二设备登录同一账户，两设备共享学习数据。
- 新设备 pull-only cold restore 成功且无非预期 Outbox push。
- 离线产生事件 / 文档后，重连可幂等补传；重复请求不会产生重复事件或覆盖不同 payload。
- 两设备并发编辑触发真实服务端 CAS conflict；冲突前后事件与文档符合原子批次语义。
- 用户选择本地 / 云端版本后恢复同步，游标只在本地 merge 后推进。
- 用户 B 无法读取 / 写入 A 的数据，也无法冒用 A 的 device ID 或 expected user ID。
- Session 过期、网络失败、函数异常和设备撤销均失败关闭，不泄露或丢弃本机 Outbox。
- 测试完成后 staging 数据清理有证据。
- 至少一台实体 iPhone Safari 完成核心恢复 / 离线 / 后台回前台验收。

**当前 N2 状态：IN_PROGRESS / HOSTED AUTHENTICATED HTTP PASS / REAL BROWSER DEVICE E2E PENDING。**


## 8. Hosted staging 实际创建与部署记录（2026-11-04）

### 8.1 项目创建

- Organization：`liucaidong's Org`（`cgnunolzpmabptkybvjd`，Free plan）。
- Project：`knowverse-staging`。
- Project ref：`ypthoicwrfsblaidllyy`。
- Region：`eu-west-1`（与 production 相同区域）。
- API URL：`https://ypthoicwrfsblaidllyy.supabase.co`。
- 创建费用报价：Supabase `get_cost(type=project)` 返回 `US$0/month`，并通过该报价的 cost confirmation 后创建。
- 数据库状态：`ACTIVE_HEALTHY`，PostgreSQL 17.11。

### 8.2 Migration 应用结果

当前 main 的 12 条 migration 全部通过 Supabase migration API 在 staging 成功应用：

1. `learning_archive_documents`
2. `gap_causality_v3`
3. `phase_d_atomic_learning_batch`
4. `phase_e_learning_documents`
5. `phase_f_proactive_projection`
6. `phase_m_practice_quality_review_records`
7. `phase_m_practice_content_reviewer_rpc`
8. `phase_m_practice_registration_idempotency`
9. `phase_m_ordered_candidate_state_revisions`
10. `phase_m_restrict_audit_table_inserts`
11. `phase_m_enforce_audit_provenance_chain`
12. `phase_m_authorize_initial_content_admin`

Supabase ledger 为这些 migration 分配了 staging 应用时生成的 version timestamp；全部 12 个名称均在 ledger 中，顺序正确。注意这是托管 staging 上的实际迁移应用，不是 PostgreSQL 17 本地重放。

### 8.3 空库与权限实测

数据库状态查询确认：
- Auth users：0；authorized_users：0；content reviewers：0。
- user_devices：0；learning_events：0；learning_archive_documents：0；practice_candidate_quality_records：0。
- 所有核心学习表和质量审核表启用 RLS。
- anon 对 learning_events、learning_archive_documents、user_devices、sync state 和 profiles 无表级访问权限。
- authenticated 的核心学习 RPC 执行权存在；anon 无执行权。
- `append_practice_candidate_quality_record` / reviewer lookup RPC 仅 service_role 有执行权。
- 质量审计表 authenticated 仅 SELECT；service_role 的直接 INSERT 权限也已被后续 migration 撤销，写入必须走受控 RPC。

真实 HTTP 负向请求：
- `GET /rest/v1/learning_events?select=event_id` 使用 publishable key 且无登录 JWT：HTTP 401，PostgREST 返回 `42501 permission denied for table learning_events`。
- `POST /rest/v1/rpc/get_learning_sync_profile` 无登录 JWT：HTTP 401，返回 `42501 permission denied for function get_learning_sync_profile`。

Security Advisor：无高危 finding；有 2 条 INFO：private schema 的 `authorized_users` / `practice_content_reviewers` 表 RLS 开启但没有 policies。它们位于非公开 private schema，无 anon/authenticated 表权限，这是当前有意的管理边界。Performance Advisor 的 unused-index 提示来自新建空库，尚无实际查询负载。

### 8.4 Auth 合成账户阻塞

staging Auth settings 显示 email provider enabled、signup enabled，但 `mailer_autoconfirm=false`。当前可用 Supabase 管理连接仅提供项目/数据库操作与 publishable key，没有 Auth Admin create-user endpoint 或 service-role key。尝试通过管理 SQL 直接写入 staging `auth.users` 被工具安全检查拦截，未成功提交任何写入。因此：
- **本节 8.4 初始核验时** staging Auth users / allowlist / devices / sync data 均为 0 行；后续 8.7 更新记录了两个合成 Auth users 已建立并加入 allowlist。
- 没有发送测试邮件，没有更改邮件确认设置，没有伪造 JWT。
- 不会通过尝试另一种 SQL 写法规避安全拦截。
- 本项是初始核验时的待办。后续 8.7 记录已通过 Supabase Dashboard 建立两个合成用户、确认邮箱并启用 allowlist；当前不再需要创建用户，剩余工作仅是本机录入临时密码并执行认证态 E2E。

### 8.5 Auth Admin 阻塞解除前的阶段结论（历史状态）

Hosted staging project 与完整 schema 已完成部署，真实 PostgREST anon 拒绝验证通过。两个合成 Auth 用户已建立、邮箱已确认并加入 allowlist；真实 hosted HTTP sync、双账户隔离、双设备冷恢复、离线补传和 CAS 冲突仍待本机临时密码配置并取得真实 JWT 后进行。**本节形成时状态为 IN_PROGRESS；最新状态见 8.7。不得将 N2 标记 COMPLETE。**


### 8.6 真实托管 Supabase HTTP 验收脚本（执行前计划；实际结果见 8.8）

新增 `scripts/e2e-hosted-supabase-sync.mjs`。该脚本使用 Node.js 原生 `fetch`，直接请求 staging Auth / PostgREST / RPC，不依赖 Mock RPC，也不读取 service_role key。脚本固定允许的 origin 为：

`https://ypthoicwrfsblaidllyy.supabase.co`

任何其他域名（尤其 production）都会在请求前触发安全停止。

#### 测试账号准备

以下两个合成 staging 用户已通过 [Supabase staging Authentication → Users](https://supabase.com/dashboard/project/ypthoicwrfsblaidllyy/auth/users) 创建，并启用 Auto Confirm User；Dashboard 核验到的 UUID 与 allowlist 状态如下：

- A：`n2-sync-a@knowverse-test.invalid` → `807a4a86-dcdd-47ac-88b9-e29ce6df6a19`，email confirmed，allowlisted=true。
- B：`n2-sync-b@knowverse-test.invalid` → `07a67a01-5120-4c4e-8dde-424391719e6e`，email confirmed，allowlisted=true。

两个身份已在 staging 的 `private.authorized_users` 启用，备注为 N2 synthetic staging E2E。不得使用生产账号或生产 UUID。密码只保留在本机，不要粘贴到聊天或提交到 Git。

#### 本机配置与执行

在本机仓库根目录运行安全设置脚本：

```bash
bash scripts/setup-n2-staging-env.sh
```

脚本会隐藏密码输入，仅接受 16–128 位字母 / 数字 / 下划线 / 连字符，要求 A/B 密码不同；自动写入 staging URL、staging publishable key 和两个邮箱，并以文件权限 `600` 创建 `.env.n2.local`。仓库 `.gitignore` 的 `.env.*` 规则会忽略该文件。脚本拒绝覆盖已有环境文件。然后执行：

```bash
set -a
source .env.n2.local
set +a
node scripts/e2e-hosted-supabase-sync.mjs
```

脚本不会输出密码、publishable key 或 JWT；只输出逐项 PASS / FAIL。测试覆盖：

1. A / B 真实 Auth 密码登录、email confirmation、身份区分与 allowlist。
2. 账号 A 的两个设备、账号 B 的一个设备注册。
3. 真实 HTTP 原子写入 learning event + archive document。
4. A 的第二设备 pull 恢复。
5. 跨设备相同 event / document 的幂等重试。
6. 过期 base revision 的 CAS 冲突；验证同批 event 未入库、文档 revision 未变化。
7. 使用正确 base revision 重试并提交新事件和文档版本。
8. B 通过 RLS 看不到 A 的事件 / 文档；B 伪造 expected_user_id、借用 A 的 device ID 均被拒绝。

以上为执行前的操作说明和测试矩阵。真实 HTTP 脚本已在 2026-11-04 成功运行，实际执行证据、结果及 staging 行数见 8.8。本脚本验证真实 Supabase HTTP / Auth / RPC 协议，不代替真实浏览器离线、浏览器本地 IndexedDB 冷启动或实体 iPhone Safari 验收。

#### 测试数据清理

脚本每次使用随机 event ID、document ID 和 device UUID，不覆盖已存在的测试数据。验收完成并保存日志后，在 Supabase Dashboard Authentication → Users 删除两个一次性合成测试用户；依赖 Auth UUID 的授权、设备、事件和文档表均配置了 `ON DELETE CASCADE`，删除用户会清除其 staging 测试记录。不得对生产项目执行清理。


### 8.7 历史状态快照：Auth 用户已建立并完成 allowlist（2026-11-04；后续结果见 8.8）

用户提供两个 staging Auth UUID 后，已在 staging 进行只读身份匹配，并确认邮箱已验证：

| 账号 | 邮箱 | Auth UUID | email confirmed | allowlist |
|---|---|---|---|---|
| A | `n2-sync-a@knowverse-test.invalid` | `807a4a86-dcdd-47ac-88b9-e29ce6df6a19` | true | enabled=true |
| B | `n2-sync-b@knowverse-test.invalid` | `07a67a01-5120-4c4e-8dde-424391719e6e` | true | enabled=true |

两个 UUID 在 staging `private.authorized_users` 中使用 `ON CONFLICT DO NOTHING` 加入，没有覆盖任何现有授权决定。随后只读计数确认：

- 指定 Auth users：2。
- 指定 enabled allowlist rows：2。
- 测试 user_devices：0。
- 测试 learning_events：0。
- 测试 learning_archive_documents：0。

本机代码与数据库验证结果：

- `node --check scripts/e2e-hosted-supabase-sync.mjs`：PASS。
- `bash -n scripts/setup-n2-staging-env.sh`：PASS。
- `git check-ignore -v .env.n2.local`：确认由 `.gitignore: .env.*` 忽略。
- `git diff --check`：PASS。
- 本地 backend / IndexedDB / async wait / WebKit browser E2E：35/35 PASS。
- `bash scripts/verify-supabase-migration-replay.sh`：PASS（空 Auth 与 seeded Auth 两种数据库）。
- `bash scripts/verify-supabase-sync-isolation.sh`：PASS（真实 PostgreSQL 17 migration / RPC / RLS）。
- hosted Supabase JWT / PostgREST / sync RPC 脚本：本节记录时尚未运行；随后已在 2026-11-04 完成，详见 8.8。

**本节当时的历史状态：IN_PROGRESS / LOCAL TEST CREDENTIALS PENDING。** 最新 N2 状态以 8.8 为准。


### 8.8 最新结果：托管 Supabase 真实认证态 HTTP 验收通过（2026-11-04）

执行环境：用户本机 Mac，仓库 /Users/geeker/ai-projects/knowverse；目标严格限定为 staging API https://ypthoicwrfsblaidllyy.supabase.co。测试使用本机 Git 忽略的 .env.n2.local 中两组合成账号密码；staging Secret Key 仅由用户在本机隐藏输入，用于 Supabase Auth Admin 更新两个测试用户密码。密钥、密码和 JWT 均未输出到聊天或写入 Git。

**真实托管验收结果：RESULT: PASS。** 所有以下断言均显示 PASS：

1. A / B 真实 Auth 登录、email confirmation、不同身份和 staging allowlist。
2. A 注册两个设备、B 注册一个设备。
3. 真实托管 PostgreSQL 原子提交 learning event + archive document。
4. A 的第二设备 pull 到同账号的事件和档案文档。
5. 跨设备相同 event / document 重试幂等。
6. Stale CAS revision 冲突时整批回滚，冲突批次的 event 不落库、文档 revision 不变。
7. 正确 base revision 重试后，事件和 revision 2 文档成功提交。
8. B 无法读取 A 的事件 / 文档；B 伪造 A 的 expected user ID 或使用 A 的 device ID 均被拒绝。

随后使用 staging 只读 SQL 计数交叉核验：
- 合成 Auth users：2。
- 测试 user_devices：3。
- 测试 learning_events：2。
- 测试 learning_archive_documents：1。

GitHub Actions Validate run #149（run ID 41762882174）已完成，结论 SUCCESS；check job 的所有已返回步骤均为 completed / success。PR #12 仍 OPEN、未合并。

终端最后出现的 zsh: P9K_GCLOUD_PROJECT_NAME: parameter not set 是交互式 zsh / Powerlevel10k 提示符在 shell 退出后读取未设置变量的提示符配置错误。它出现在脚本已经输出 RESULT: PASS 之后，不属于 Supabase HTTP harness 的失败，也不改变上述 PASS 结果。

**最新 N2 状态：IN_PROGRESS / HOSTED AUTHENTICATED HTTP PASS / MAC CHROMIUM STAGING E2E PASS / SECOND REAL DEVICE PENDING。** Mac Chromium 真实页面已通过认证、IndexedDB 冷恢复、同步 / 恢复和刷新；第二台真实设备、离线 Outbox / session refresh / 弱网及实体 iPhone Safari 仍待验收。不得因此宣布 N2 COMPLETE 或 KNOWVERSE PRODUCTION READY。


### 8.9 Mac Chromium 真实 staging 客户端验收与同步冲突修复（2026-11-04）

范围与隔离：
- 使用仓库副本 /tmp/knowverse-n2-staging-site 做本机预览；副本中的 public-config.js 固定为 staging URL 与 publishable key。
- 生产 public-config.js、GitHub Pages、生产 Supabase (sxcpareycpokcyroufww) 均未修改 / 写入。
- Account A / B 凭证只从 .env.n2.local 读取，不打印、不提交。

DevTools 根因：
- 首次 CDP 记录到多个静态 ES module 请求 net::ERR_CONNECTION_RESET；学习页面 boot 因核心模块未加载而提前中止，导致 #backend-account-panel 没有挂载。按钮不是 CSS 隐藏，也不是 Supabase 登录失败。
- 本机预览服务器由单线程 HTTP server 改为 ThreadingHTTPServer。修复后学习进度启动标记完成，云端面板正常挂载；DOM 检查确认两个按钮可见。另将页面启动顺序调整为先等待本次启动的初始同步完成（失败仍 best-effort 继续本地学习），再创建学习策略与主动学习投影，避免用空事件集覆盖或冲突真实云端策略。

档案冲突根因与修复：
- 两个冲突为 learner_profile/strategy 与 proactive_learning_projection/current。策略档案的差异仅为 updatedAt 与 observedWindow.from/to 等派生窗口元数据；仪表盘快照则存在真实的 sourceEventCount / sourceFingerprint 差异，因为新设备先以空事件集计算缓存，而云端已有 2 条事件。修复后策略元数据按语义比较，仪表盘快照转为本机可重建缓存，不再进行跨设备冲突比较。
- 策略档案仅忽略派生的 updatedAt / observedWindow 时间字段；用户配置、策略参数、history、evidence、sourceFingerprint 和 lastDecision 仍参与严格比较。proactive_learning_projection/current 则不属于权威档案，永远不上传 / 拉取，设备从本机已恢复事件中重新计算。真实用户偏好或策略参数差异仍阻断并保留两端。
- 冲突面板改为读取 remote.document_type / remote.document_key，显示实际档案类型 / key 和本机、云端修订，不再显示 undefined · undefined。

验证结果：
- node --test scripts/verify-archive-conflicts.mjs：10/10 PASS。
- node --test scripts/verify-backend-contract.mjs scripts/verify-archive-conflicts.mjs scripts/verify-local-learning-database.mjs scripts/verify-learning-state-storage.mjs scripts/verify-phase-f.mjs scripts/verify-phase-g.mjs：72/72 PASS。
- node scripts/e2e-hosted-browser-sync.mjs：RESULT: PASS。真实 Account A staging 会话、先初始同步再计算策略 / 投影、自动同步、手动同步、pull-only 恢复、页面刷新均通过；冲突 0、待上传事件 / 档案 0、IndexedDB 可用、28 次已观测 RPC 全部 HTTP 200、浏览器错误 0。云端恢复动作未调用 sync_commit_learning_batch，验证为 pull-only。
- Mac Chromium 本次只覆盖一个浏览器客户端。第二台物理设备 / iPhone Safari、离线 Outbox、session refresh、弱网、后台恢复仍未完成。

最新状态：IN_PROGRESS / HOSTED AUTHENTICATED HTTP PASS / MAC CHROMIUM STAGING E2E PASS / SECOND REAL DEVICE PENDING。


## 8.9 最新复验：Mac Chromium 真实页面与 staging 再次通过（2026-11-12）

目标仍严格固定为 `knowverse-staging`：`https://ypthoicwrfsblaidllyy.supabase.co`。本次在本机临时预览副本中注入 staging public config，通过 staging Auth password grant 登录 Account A，并使用应用自己的 `SupabaseAuthClient.saveSession()` 规范化保存会话。临时预览副本和 public config 位于 `/tmp`，测试结束后已删除；没有修改仓库 public config，也没有触碰 production。

**结果：`RESULT: PASS`。**

| 验收项 | 实际结果 |
|---|---|
| 真实 staging Auth 登录 | PASS，进入 `/progress/#cloud-account` |
| 首次 IndexedDB / 云端状态 | `已同步`，IndexedDB 可用 |
| 待处理冲突 | 0 |
| 待上传事件 / 待同步档案 | 均为 0 |
| 手动“立即同步” | PASS，状态保持 `已同步` |
| “从云端恢复” | PASS，状态变为 `云端恢复完成` |
| Pull-only 写入保护 | 恢复前后 `sync_commit_learning_batch` 调用增量为 0 |
| 页面刷新 | PASS，账户、状态和操作按钮恢复 |
| Staging RPC | 28 个响应全部 HTTP 200 |
| 浏览器错误 | 0 个 pageerror、console error 或 requestfailed |

观察到的 RPC 名称：`get_learning_sync_profile`、`register_device`、`sync_pull_learning_events_for_account`、`sync_pull_learning_documents_for_account`。自动同步、手动同步、pull-only 恢复和刷新均已验证。

**证据边界：** 这是 Mac Chromium 真实浏览器 + 托管 staging Auth / RPC 的通过记录；它不等于第二台实体设备、iPhone Safari 或离线 Outbox 的验收。浏览器测试没有提交新的学习事件或档案文档；可能为当前浏览器注册一个 staging 设备。两个合成 Auth 用户及此前 HTTP 测试数据仍保留在 staging，需在最终证据归档后按第 8.6 节删除，不得清理 production。


## 8.10 Staging Edge Function deployment and provider configuration gate（2026-11-12）

当前 staging 项目 `ypthoicwrfsblaidllyy` 已部署两个 Edge Functions，均启用平台 JWT 验证：

- `learning-agent`：Active；无 JWT 请求 HTTP 401；Account A 的真实 Auth 请求进入函数后返回 `503 AI_PROVIDER_NOT_CONFIGURED`。
- `practice-quality-review`：Active；无 JWT 请求 HTTP 401；尚未提交候选审核，因此没有触发 Reviewer 模型调用。

这证明云端入口和认证边界已生效，但尚未证明 AI Provider 真正调用成功。Learning Agent 在缺少 `AI_PROVIDER_API_KEY` / `AI_PROVIDER_MODEL` 时 fail-closed；本次没有发出任何付费模型请求。

在 Supabase Dashboard → Project Settings → Edge Functions → Secrets 配置 staging-only secrets：`AI_PROVIDER_API_KEY`、`AI_PROVIDER_MODEL`、可选 `AI_PROVIDER_BASE_URL`；独立 Reviewer 需要 `PRACTICE_REVIEWER_API_KEY`、`PRACTICE_REVIEWER_MODEL`、可选 `PRACTICE_REVIEWER_API_BASE_URL`。Reviewer 模型必须与生成模型不同。另设置 `KNOWVERSE_CONTENT_REF=develop`，让 staging Reviewer 使用 develop 的 canonical learning map / assessment registry；函数默认值仍是 `main`，适合生产默认基线。不要把 key 粘贴到聊天或提交进仓库。

本地 `scripts/e2e-hosted-learning-agent.mjs` 会验证两个函数拒绝未认证请求，并在 secrets 配置后执行一条最小 Tutor 调用。当前因 provider secret 缺失而以退出码 2 报告 BLOCKED；配置后重新运行即可。

Supabase Security Advisor 另报告 Auth leaked-password protection disabled，需在 Authentication → Settings → Password Security 开启。私有 schema 无客户端 RLS policy 的 INFO 项保持不变，不增加宽泛客户端策略。


## 8.11 Staging Edge Function deployment and provider configuration gate（2026-11-12）

当前 staging 项目 `ypthoicwrfsblaidllyy` 已部署两个 Edge Functions，均启用平台 JWT 验证：

- `learning-agent`：Active；无 JWT 请求 HTTP 401；Account A 的真实 Auth 请求进入函数后返回 `503 AI_PROVIDER_NOT_CONFIGURED`。
- `practice-quality-review`：Active；无 JWT 请求 HTTP 401；Account A 的 authenticated history read 返回 HTTP 200 且记录为空，没有创建候选记录，也没有触发 Reviewer 模型调用。

这证明云端入口、共享模块导入和认证边界已生效，但尚未证明 AI Provider 真正调用成功。Learning Agent 在 provider 配置不完整时 fail-closed；本次没有发出任何付费模型请求。

在 Supabase Dashboard → Project Settings → Edge Functions → Secrets 配置 staging-only secrets：`AI_PROVIDER_API_KEY`、`AI_PROVIDER_MODEL`、可选 `AI_PROVIDER_BASE_URL`；独立 Reviewer 需要 `PRACTICE_REVIEWER_API_KEY`、`PRACTICE_REVIEWER_MODEL`、可选 `PRACTICE_REVIEWER_API_BASE_URL`。Reviewer 模型必须与生成模型不同。另设置 `KNOWVERSE_CONTENT_REF=develop`，让 staging Reviewer 使用 develop 的 canonical learning map / assessment registry；函数默认值仍是 `main`，适合生产默认基线。不要把 key 粘贴到聊天或提交进仓库。

本地 `scripts/e2e-hosted-learning-agent.mjs` 会验证两个函数拒绝未认证请求，并验证 Reviewer history 只读路径；在 provider secrets 配置后，它会执行一条最小 Tutor 调用。当前因 provider secret 缺失而以退出码 2 报告 BLOCKED；配置后重新运行即可。

Supabase Security Advisor 另报告 Auth leaked-password protection disabled，需在 Authentication → Settings → Password Security 开启。私有 schema 无客户端 RLS policy 的 INFO 项保持不变，不增加宽泛客户端策略。
