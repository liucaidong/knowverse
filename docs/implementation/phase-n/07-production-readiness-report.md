# KNOWVERSE — Phase N 生产就绪报告

**报告日期：** 2026-11-04
**总体结论：** NOT PRODUCTION READY
**Phase N 状态：** IN_PROGRESS
**当前主线：** `main` @ `b3c70374f147a651227675777934eac4adffea21`

## 1. 结论

N1 已完成 Git 合并与分支清理；main 合并后的 Validate workflow 成功。N2 已完成本地与 PostgreSQL 17 集成验证，并在独立 staging 上通过真实 Auth / JWT / PostgREST / RPC 认证态 HTTP 验收；Mac Chromium 中真实 KNOWVERSE 页面也已通过 Account A 登录、IndexedDB 冷恢复、自动 / 手动同步、pull-only 恢复和刷新。N2 仍缺第二台真实设备、离线补传、session refresh、弱网及实体 iPhone Safari 验收。

当前 N2 PR #12 最新提交 8ca34e6 的 GitHub Actions Validate workflow run #149（41762882174）已 SUCCESS；同时 staging hosted Auth / JWT / HTTP harness 已输出 RESULT: PASS。这两项仍不代表真实浏览器客户端与实体 iPhone 的完整跨设备体验已验收，因此不能声明 KNOWVERSE 已具备完整生产级跨设备个人学习数据闭环。

## 2. N1 已验证

- PR #11 normal merge 到 main，merge commit `b3c70374f147a651227675777934eac4adffea21`。
- PR #10 / #11 均已合并，N1 旧阶段分支已删除。N1 交接时仅保留 main 且无 OPEN PR；随后为 N2 创建独立分支 `phase-n/n2-sync-isolation-2026-11-04` 并打开 PR #12。
- main full Validate workflow run `41746832395` SUCCESS。
- Pages deploy run `41746832366` SUCCESS。
- 生产 migration ledger 12 条，版本名与 main migration 文件清单对应。
- 已披露第 12 条 migration 的 SQL 文件在生产应用后被修订；ledger 没有 SQL checksum，本报告不作字节级 provenance 一致性声明。
- 本阶段没有重跑生产 migration，也没有修改生产授权或数据库内容。

## 3. N2 验证证据

### 3.1 本地与浏览器

- Backend contract、local IndexedDB、state migration、async E2E wait：34/34 tests PASS。
- Mac + WebKit iPhone profile E2E：1/1 PASS，覆盖首次上传、冷启动 pull restore、事件与档案同步、离线 Outbox、重连补传、幂等重试、文档 CAS 冲突和人工选择解决。
- 该跨设备浏览器测试使用进程内 Mock RPC。它证明本地状态层与浏览器流程，但不能证明真实 Supabase API 可用。

### 3.2 PostgreSQL 17 真实迁移 / RPC 集成

新增 `scripts/verify-supabase-sync-isolation.sh` 并接入 Validate workflow。脚本在临时 PostgreSQL 17 容器执行全部 12 条真实 migration，以合成 Auth 身份和 authenticated 角色调用迁移产生的数据库 RPC，验证：

- 同一用户两设备注册和 device ownership。
- 事件 + 文档原子批次提交。
- 重复事件 ID / payload 幂等确认。
- stale document revision 触发 CAS 冲突；冲突批次内先执行的文档写入与关联事件均回滚。
- 新 revision 解决冲突后成功提交。
- 事件分页游标与 has_more。
- 账号 B 无法通过 RLS 读取账号 A 事件 / 文档。
- 账号 B 无法伪造 expected_user_id 或使用账号 A 的 device ID 同步。

结果：`SUCCESS: PostgreSQL 17 Supabase sync isolation checks passed.`

边界：测试用最小 Auth schema shim，不是托管 Supabase 的完整 clone，不包括真实 JWT 签发、PostgREST 网络层、Supabase hosted Auth 和物理设备。

### 3.3 生产只读权限

- 生产主要学习表均启用 RLS。
- anon 对学习事件、档案和设备表没有表级访问权限。
- authenticated 具备必要的表权限，RLS owner predicates 绑定 `auth.uid()` 并检查 allowlist。
- 审核审计表 authenticated 只读；service_role SELECT / INSERT；直接 UPDATE / DELETE 被撤销，写入通过受控 RPC。
- 本阶段仅执行只读 metadata / grants / policies 查询，没有生产 DML 或 DDL。

## 4. 仍未验证

- 真实 KNOWVERSE 浏览器客户端在 Mac + 第二台真实设备上使用同一账号完成同步和 cold restore。
- 浏览器 IndexedDB 恢复、离线 Outbox / 重连补传、session refresh、弱网 / 超时和错误重试。
- 真实网络离线 / 弱网、浏览器后台恢复、重复请求和服务端超时后重试。
- 物理 iPhone Safari 的键盘、权限、后台生命周期和网络恢复。
- 真实 Provider 调用、独立 Reviewer 与 AI 内容发布闭环（N3/N4）。
- 备份恢复演练和全量教学内容语义事实审核。

## 5. 当前阻塞

已按用户授权建立独立 staging 项目 knowverse-staging（ypthoicwrfsblaidllyy，eu-west-1），全部 12 条 migration 已成功应用，匿名请求按预期被拒绝。两个合成 staging Auth 用户已确认邮箱并加入 private.authorized_users；用户在本机设置临时密码后，真实 Auth / JWT / PostgREST / RPC HTTP harness 已 RESULT: PASS。A 双设备、B 单设备注册，atomic event + document commit、第二设备 pull、幂等重试、CAS 冲突整批回滚与恢复、跨账号 RLS / identity spoof / device spoof 拒绝均已验证。当前阻塞收敛为真实 KNOWVERSE 浏览器客户端的 Mac + 第二设备冷恢复 / 离线补传 / session refresh / 弱网验收，以及实体 iPhone Safari 验收。

在真实托管认证态 E2E 完成前：
- 不得使用生产数据库插入测试事件或档案。
- 不得在生产环境创建测试 Auth 用户或设备。
- 不得将 direct hosted HTTP harness 写成真实浏览器客户端或实体 iPhone 验收通过。
- N2 客户端设备验收未完成前，不推进 N3 的真实 Provider 测试。

## 6. 生产准入条件

1. N1 主线合并和 migration 版本清单一致性已完成；历史 SQL provenance 差异已披露。
2. N2 在独立托管 staging 完成 Auth / PostgREST / RPC / RLS 真实双设备测试，并完成账号隔离、离线重试和 CAS 冲突矩阵。
3. N3 完成 Tutor、Agent、独立 Reviewer 真实 Provider 调用与失败关闭验证。
4. N4 完成至少一条真实候选的 deterministic → AI → 人工 → PR → Pages → registry 闭环。
5. N5 完成两个专题的正式学习图谱和来源审核。
6. 单元、集成、浏览器 E2E、数据库重建和 staging 验收全部通过；未通过测试不得删除或降级。
7. 风险登记册中没有未披露 P0/P1；未完成 P2 风险具备负责人、计划和接受记录。

**当前不得宣布 Phase N COMPLETE，也不得宣称 KNOWVERSE 已具备生产级个人学习数据闭环或可靠的 AI 主动规划能力。**


## 7. 2026-11-04 staging 建立后的更新

已按用户授权建立独立托管 staging 项目：
- `knowverse-staging` / `ypthoicwrfsblaidllyy` / `eu-west-1`。
- 当前创建报价 `US$0/month`。
- 12/12 migrations 实际应用成功，migration ledger 名称顺序完整。
- Auth、allowlist、reviewer、设备、学习事件、学习文档、质量审计记录当前均 0 行，没有复制生产数据。
- 对外公开 API 匿名读取学习表和调用同步 profile RPC 均实际返回 HTTP 401 / 42501；authenticated RPC grant 与 RLS metadata 已核对。

**仍不能据此宣布 N2 完成。** staging 当前没有可用合成 Auth users / JWT。项目 email provider 要求确认邮件，但当前管理连接没有 Auth Admin 创建用户接口；直接 SQL 写 `auth.users` 被安全策略阻止，未落库。下一步需通过 Supabase Dashboard Auth Users 受支持流程建立合成账号，随后才可以运行真实双设备 HTTP E2E。生产项目完全未触碰。


## 8. 2026-11-04 托管认证态 HTTP 验收最新结果

用户在本机运行 scripts/e2e-hosted-supabase-sync.mjs，目标固定为 staging ypthoicwrfsblaidllyy，输出 RESULT: PASS。该测试通过真实 Supabase Auth 密码登录和 JWT，实际调用托管 PostgREST / RPC，并验证：
- A / B 身份与 allowlist；
- A 两设备、B 一设备注册；
- event + archive document 原子批次提交；
- A 第二设备 pull；
- 跨设备幂等重试；
- stale CAS 冲突整批回滚、正确 revision 恢复提交；
- B 无法读取 A 数据、伪造 A 的 expected user ID 或借用 A 的 device ID。

staging 只读计数：2 Auth users、3 user_devices、2 learning_events、1 learning_archive_documents。GitHub Actions Validate run #149（41762882174）SUCCESS。PR #12 仍 OPEN，未合并。

末尾 zsh: P9K_GCLOUD_PROJECT_NAME: parameter not set 是交互式 Powerlevel10k 提示符配置错误，在 harness 已输出 PASS 后出现，不属于 N2 测试失败。

**最新结论：** N2 的服务端托管认证态 HTTP 验收 PASS；真实浏览器客户端双设备冷恢复 / 离线补传 / session refresh / 弱网及实体 iPhone Safari 仍未验收。KNOWVERSE Phase N 继续 IN_PROGRESS / NOT PRODUCTION READY。


## 9. 2026-11-04 Mac Chromium staging 真实客户端回归

本次验收在本机隔离静态预览副本中运行真实 KNOWVERSE 页面，副本仅连接 staging ypthoicwrfsblaidllyy，生产站点配置未更改。Chrome DevTools Protocol 定位到单线程静态服务器在 ES module 并发加载时重置连接，造成核心模块未加载、账户面板未挂载。改用 ThreadingHTTPServer 后，模块请求全部正常，账户面板与两个操作按钮均在 DOM 中可见。

随后确认 Account A 的两项冲突分别是策略档案派生时间字段差异，以及新设备在云端事件恢复前生成的本机投影与云端投影 sourceEventCount / sourceFingerprint 不一致。实现策略档案的字段级语义比较、将主动学习投影调整为本机可重建缓存、云端事件合并后触发投影重算，并让学习进度页面先等待 best-effort 初始同步后再计算策略。冲突卡片同时修复为读取 remote.document_type / remote.document_key；真实策略参数差异仍保留人工选择。

验证：
- verify-archive-conflicts.mjs：10/10 PASS。
- backend / IndexedDB / Phase F / G 组合回归：72/72 PASS。
- e2e-hosted-browser-sync.mjs：真实 Account A staging 浏览器会话自动同步、手动同步、pull-only 恢复和刷新均 PASS。
- 冲突数 0；IndexedDB 可用；待上传项为 0；28 次已观测 Supabase RPC 全部 HTTP 200；浏览器 console / page errors 0。
- pull-only 恢复动作没有触发 sync_commit_learning_batch，没有把本机 Outbox 推上云。
- PR #12 保持 OPEN；本次修复不触碰生产 Supabase。

当前限制：Mac Chromium 只代表一台浏览器客户端。第二台物理设备双向同步、离线 Outbox / 重连补传、session refresh、弱网和实体 iPhone Safari 的权限 / 键盘 / 后台恢复仍待单独验收。N2 继续 IN_PROGRESS，Phase N 仍 NOT PRODUCTION READY。
