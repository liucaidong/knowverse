# N2 — Supabase 跨设备学习同步验收记录

**状态：** IN_PROGRESS / HOSTED STAGING BLOCKED
**更新日期：** 2026-11-04
**代码基线：** `main` @ `b3c70374f147a651227675777934eac4adffea21`
**生产 Supabase：** `sxcpareycpokcyroufww`（仅用于只读权限核验）

## 1. 验收结论

N2 已补齐两层隔离验证：

1. 浏览器 / IndexedDB 层：桌面与移动视口的 Mock RPC E2E 通过。
2. 数据库层：临时 PostgreSQL 17 执行仓库全部 12 条 migrations，并以 authenticated 角色调用真实 SQL RPC，原子提交、幂等、CAS 整批回滚、分页和 RLS 跨账号隔离通过。

**但 N2 尚未完成。** Supabase 账号当前只有生产项目，没有独立 staging project / branch。没有真实托管 Supabase Auth、JWT、PostgREST 网络和第二台物理设备的验收证据。不得把本报告中的 PG17 集成验证等同于托管 staging 通过。

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
| Supabase staging | 尚不存在 | 无 | BLOCKED |

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

## 6. staging 阻塞与下一步

目前 Supabase 账号只发现一个生产项目 `sxcpareycpokcyroufww`，组织为 `liucaidong's Org`（free plan），没有 development branch。没有把生产数据复制到测试环境，也没有新建云资源。

要完成 N2 剩余部分，需要：
1. 在用户明确授权的组织内创建独立 staging 项目；创建前核对报价，若会产生非零费用先停止并取得确认。
2. 对 staging 应用当前 main 的 12 条迁移并验证托管 Auth / PostgREST / RLS 行为。
3. 使用合成账号 A、B；A 在 Mac 和第二设备登录，B 做跨账号隔离尝试。
4. 真实浏览器直连 staging Supabase，完成同账号双设备首次上传 / cold restore / 离线补传 / CAS 冲突与解决 / event idempotency / session refresh / 错误重试。
5. 记录 HTTP/RPC 状态、数据库行数、cursor/revision、device rows、测试账号和最终数据清理结果。
6. N2 数据库测试不使用现有个人生产账号；测试完成后撤销 staging 测试身份 / 设备或删除 staging 项目。

实体 iPhone Safari 测试仍需要真实设备；Playwright WebKit 只能作为前置自动化测试。

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

**当前 N2 状态：本地数据库与模拟浏览器证据 PASS；托管 staging + 真实设备验收 BLOCKED。**
