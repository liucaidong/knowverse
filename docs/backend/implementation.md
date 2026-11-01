# KNOWVERSE 跨设备学习档案与云端同步实施手册

版本：2.0 · 2026-11-01  
仓库：liucaidong/knowverse  
目标：保留 GitHub Pages、Lab / Gallery / Puzzles 和现有 Learning Intelligence，建立 Local-first 的可恢复学习档案与可选 Supabase 多设备同步。

> 交付边界：代码、Migration 和自动化测试不等于用户的 Supabase 项目已经创建，也不等于真实设备云端验收完成。请按本文最后的激活步骤配置服务。

## 1. 现状与架构边界

现有挑战、复习和 Learning Intelligence 领域逻辑使用同步 LocalStorage API。为避免一次性将所有交互改成异步 API 而破坏课程和挑战流程，本阶段采用兼容式档案层：

- 领域引擎仍以同步写入 LocalStorage，保证无登录、离线及当前 API 契约。
- IndexedDB V2 是事件镜像、Outbox、设备身份、游标和可恢复文档的持久化同步工作区。
- 本地档案启动器扫描并安全复制现有学习事件和状态文档；源 LocalStorage 键在迁移期间绝不删除。
- 登录同步时从现有事件快照对账 Outbox，确保登录前产生的历史记录也能上传。
- 新设备先把云端事件合并到现有事件日志，再恢复挑战、复习和偏好文档。
- 掌握分数、Gap 生命周期、置信度、复习队列和主动学习计划都是事件/注册表派生数据，不接受远端汇总分数覆盖。

这是一条可回滚的双写兼容路径，不宣称所有领域 API 已经改造成“单次 IndexedDB 事务即为唯一主写入”。

## 2. 数据分类与来源

| 数据 | 当前领域入口 / 旧键 | IndexedDB / 云端归档 | 同步策略 |
|---|---|---|---|
| 掌握证据、挑战答案、提示、完成记录、学习活动 | learning-progress:v2；兼容 v1 | events + outbox；learning_events | 追加式事件，按 event_id 去重 |
| 进行中挑战、步骤数据、Run ID | challenge:v1:<challengeId> | documents；learning_archive_documents | 版本化文档、revision CAS |
| 复习历史 | 学习事件中的 review_started、attempt、assessment_passed、hint_revealed | events | 追加式；由事件重建历史 |
| 进行中复习 Session | review-session:v1:<sessionId> | documents；learning_archive_documents | 版本化文档；完成后发送 tombstone |
| 计划行动开始/完成 | learning-progress:v2 中的 plan_action_* | events | 追加式事件 |
| 学习计划偏好 | learning-plan:preferences:v1 | documents；learning_archive_documents | 用户级文档；CAS 冲突处理 |
| 掌握度、Gap、薄弱点生命周期、复习队列 | deriveLearningInsights() | 不单独保存可信分数 | 从事件事实、知识图谱、题目注册表重算 |
| 今日主动学习计划 | buildAdaptiveLearningPlan() | 不保存完整派生计划；偏好和行动事件同步 | 各设备按相同事实、注册表和偏好重新生成 |
| 搜索索引、课程内容、挑战注册表、知识图谱 | 仓库内静态 JSON / 模块 | 不进入个人云档案 | 随 GitHub Pages 发布 |
| 登录会话与 PKCE verifier | 认证模块自己的 LocalStorage 键 | 不同步到个人档案 | 每个设备独立登录，禁止复制 Refresh Token |
| 设备 ID、设备内序号、事件游标、文档游标 | 无旧版等价数据 | IndexedDB meta | 每个浏览器 Profile 独立 |
| 迁移状态、同步错误、最近成功时间 | 无 | IndexedDB meta | 本地运维元数据，不作为学习证据 |

已确认的核心 LocalStorage 键：

- knowverse:learning-progress:v2 / knowverse:learning-progress:v1
- knowverse:challenge:v1:*
- knowverse:review-session:v1:*
- knowverse:learning-plan:preferences:v1
- knowverse:supabase-session:v1 / knowverse:supabase-pkce:v1

### 2.1 事件名称兼容原则

当前 Learning Intelligence 已经在使用以下事实事件：attempt、hint、hint_revealed、completed、checkpoint_started、review_started、assessment_passed、activity、plan_action_started、plan_action_completed。

本阶段保留这些已有事件语义，不再创建一套功能相同的新类型。语义对应关系如下：

| 产品行为术语 | 当前事实事件 |
|---|---|
| challenge_started | 首次 attempt / activity 以及挑战进度文档 |
| challenge_answered | attempt |
| challenge_completed | completed |
| checkpoint_started | checkpoint_started |
| checkpoint_completed | assessment_passed（由检查点引擎产生） |
| review_started | review_started |
| review_completed | assessment_passed 或已结束的复习 attempt |
| gap_detected | 从错误 attempt 的 gapId 推导 |
| mastery_evidence_added | 从 completed / assessment_passed 等事实推导 |
| learning_plan_updated | plan_action_* 事件与偏好文档分别表示行动事实和配置 |

普通挑战答对不会删除先前失败事件，也不会自动解除 Gap。Gap 的纠正和独立验证仍按现有 Learning Intelligence reducer 规则决定。

## 3. 目标架构与主要文件

Lab / Gallery / Puzzles → 领域引擎 → Learning Intelligence → Local Archive → IndexedDB → Sync Engine → Supabase

| 文件 | 责任 |
|---|---|
| assets/js/backend/local-event-store.mjs | IndexedDB V2：事件、Outbox、meta、档案文档、冲突、迁移元数据 |
| assets/js/backend/local-archive.mjs | 扫描/复制 LocalStorage、幂等迁移、文档恢复、冲突选择 |
| assets/js/backend/archive-bootstrap.mjs | 全站共享同步运行时、启动时迁移与恢复入口 |
| assets/js/backend/sync-engine.mjs | 设备注册、Push / Pull、重试、游标和状态事件 |
| assets/js/backend/auth.mjs | OAuth PKCE、会话续期、401 后单次刷新重试 |
| assets/js/backend/account-panel.mjs | 登录、设备、档案、待同步状态、冲突处理 UI |
| assets/css/backend-account.css | 账号面板响应式设计 |
| supabase/migrations/20261101110000_learning_archive_documents.sql | 版本化档案文档、CAS RPC、Schema V3 事件元数据 |

## 4. IndexedDB 本地模型

数据库：knowverse-learning-store，版本：2。

| Object Store | 主键 | 内容 |
|---|---|---|
| events | id | 事件镜像、来源、同步标记 |
| outbox | id | 待云端确认事件，含 device_id / device_seq |
| documents | id | 挑战、复习、偏好快照、baseRevision、dirty、conflict |
| meta | key | device、事件 cursor、文档 cursor、同步时间、账号绑定 |
| migrations | id | 迁移状态（保留扩展点） |
| conflicts | id | 被拒绝覆盖的云端版本和冲突上下文 |

档案文档类型目前为 challenge_progress、review_session、plan_preferences。已删除的复习会话使用带 _deleted 的 tombstone 同步，避免另一设备把已完成的 Session 重新恢复。

### 4.1 LocalStorage 兼容迁移

迁移 legacy-localstorage-v1 执行以下步骤：

1. 读取 learning-progress:v2，缺失时兼容读取 v1。
2. 如果只有 V1，则写入经当前版本读取逻辑规范化的 V2 快照；原始 V1 保留。
3. 扫描挑战、复习 Session、计划偏好键，逐个解析并验证为 JSON 对象。
4. 将事件镜像到 IndexedDB，事件 ID 是幂等键。
5. 将状态文档复制到 IndexedDB；内容哈希相同不重复增加 revision。
6. 写入迁移状态、数量、checksum、错误列表与完成时间。
7. 远端文档恢复时仅在旧 LocalStorage 键缺失时补回；不会覆盖仍存在的本机旧状态。

迁移状态：completed / needs-attention / failed。失败时保留原始 LocalStorage；修复问题后可再次启动迁移。绝不通过清空旧键或重置学习记录让迁移通过。

## 5. 学习事件模型与顺序

云端 learning_events 保存：

- user_id：仅从 auth.uid() 获取。
- event_id：学习事件稳定唯一 ID。
- device_id、device_seq：事件来源设备和设备内严格递增序号。
- user_seq：服务端为该用户分配的接收顺序。
- event_type、topic_id、occurred_at、received_at。
- schema_version、causation_event_ids。
- payload_hash、event_payload。

### 5.1 顺序与因果

- 设备内 device_seq 在 IndexedDB readwrite transaction 中分配。
- event_id 用于跨设备和重试去重。
- 服务端锁定用户级 user_sync_state 后分配单调递增 user_seq。
- Pull 始终按 user_seq 排序和分页。
- occurred_at 是设备报告的发生时间；received_at 是服务端记录时间。
- 不使用两个设备的墙上时钟比较来决定因果，也不以较晚 timestamp 清除 Gap。
- Schema V3 可以携带 causationEventIds；当前旧引擎未显式建立依赖的事件不会被伪造因果引用。

Push 同一 event_id、相同 payload 是安全重试；同 ID 不同 payload 报冲突。相同设备序号被另一个事件占用时拒绝写入。

## 6. Supabase 同步协议

### 6.1 Push 事件

1. 认证并确认 allowlist。
2. 注册当前设备。
3. 从学习事件完整快照对账本地 Outbox。
4. 每批最多 100 条调用 sync_push_learning_events。
5. 服务端校验事件类型、事件 ID、设备归属、设备序号、Schema、payload 大小。
6. 数据库事务内锁定 user sync state，分配 user_seq 并写入事件。
7. 客户端只对 RPC 明确返回的 confirmed IDs 调用 acknowledgeOutbox()。

服务端重复写入时返回原先的 user_seq，不重复插入或计分。RPC 失败/响应丢失时，本地 Outbox 保留；重试不会提前清理数据。

### 6.2 Pull 事件

1. 按账户读取 cursor:<user_id>。
2. 服务端按 user_seq 增量分页。
3. 使用现有 appendMany(remote: true) 合并；事件 ID 去重。
4. 成功合并后镜像云端事件。
5. 仅在整个页面成功合并后推进游标。
6. 失败时游标保持不变，下一轮安全重试。

每轮最多拉取 20 页 × 100 条；未完成的分页会在下次可见、联网或手动同步时继续。

### 6.3 Push / Pull 档案文档

文档采用 revision 和 base_revision 比较并交换（CAS）：

- 新文档必须以 base_revision=0 创建。
- 更新时 base_revision 必须等于云端当前 revision。
- 同样 payload 的重复请求确认现有 revision，避免服务器已提交但浏览器没收到响应造成伪冲突。
- revision 不匹配时 RPC 返回当前远端版本，不覆盖远端或本地。
- 本地保存冲突双方，用户可以选择“保留本机版本”或“采用云端版本”。
- 保留本机时，以远端最新 revision 为新 base，再提交本机内容；采用云端时替换本地兼容快照。
- 文档游标与事件游标独立，按 document_seq 增量拉取。

挑战和复习状态快照是可恢复 UI 状态，不承担学习计分权威。挑战事件事实与复习证据仍由事件日志负责。

## 7. 冲突策略

| 数据 | 合并策略 | 不允许的行为 |
|---|---|---|
| 学习事件 | append-only + event_id 去重 | 用新事件覆盖旧事件 |
| 掌握度 / Gap | 在合并事件后按现有 reducer 重建 | 时间戳 LWW 或从云端分数直接覆盖 |
| 复习历史 | 事件追加，session_id / event_id 去重 | 重复计算答题次数 |
| 进行中挑战 | 同文档 CAS；revision 冲突时明确选择 | 静默 LWW |
| 进行中复习 Session | 同文档 CAS；结束后 tombstone | 已结束会话被旧设备复活 |
| 学习偏好 | 同文档 CAS；冲突时用户选择 | 设备离线时直接覆盖另一端 |
| 今日计划 | 由事件、偏好、知识注册表重算 | 把某设备派生计划作为唯一真相覆盖另一设备 |

## 8. 身份、安全和用户隔离

- 使用 Supabase Auth GitHub OAuth PKCE，Refresh Token 只保存在当前浏览器会话。
- 本地档案绑定首次成功同步的 user_id。另一个账号不会自动上传这份档案，防止意外串档；切换账号前需先导出备份并使用独立浏览器 Profile。
- 客户端只使用 Publishable Key。
- private.authorized_users 不暴露给 PostgREST；管理员手工白名单授权。
- 公开表启用 RLS，用户只能 SELECT 自己的行；普通写入通过 SECURITY DEFINER RPC，RPC 内重新验证 auth.uid() 和白名单。
- user_id 不由客户端作为写入参数传入。
- Service Role / Secret Key / 数据库密码 / GitHub OAuth Client Secret 不能出现在静态站点或仓库。
- Pages workflow 从显式工作区排除 supabase/、scripts/、.env* 和 docs/backend/。
- 退出登录只清除认证会话和 PKCE verifier；不删除本地事件、挑战或复习档案。

本地单用户档案绑定是安全隔离策略，不是多人账号切换产品。未来如需一台浏览器支持多个 KNOWVERSE 账号，应将 IndexedDB 数据库改为按 user_id 命名空间隔离，并提供明确的本地档案切换流程。

## 9. 同步调度与状态 UI

同步运行时由全站共享入口 assets/js/backend/archive-bootstrap.mjs 在每个页面启动；学习驾驶舱账号面板复用同一个实例，避免只在驾驶舱打开时才进入 Outbox。同步触发点：

- 登录后初始化。
- 学习事件写入后。
- 档案状态发生修改后。
- 网络从离线恢复在线。
- 页面重新获得可见性。
- 用户手动点击同步。
- 失败后指数退避重试，最大间隔 5 分钟。

本地学习不依赖同步成功。网络离线时 Outbox 保留；退出登录不清理 Outbox 或 Documents。

账号面板展示：

- 登录账号和授权状态。
- 当前设备 ID（短显示）。
- 在线 / 离线状态。
- IndexedDB 可用性与迁移状态。
- 本地事件数、待上传事件数、待同步文档数。
- 冲突数量、最近成功同步时间、最近错误。
- 手动同步、退出登录、冲突版本选择。

## 10. 自动化测试和真实验收边界

自动化测试分三层：

1. 领域与契约测试：保留已有 Challenge Engine / Learning Intelligence / Planner 测试；增加迁移、SQL 权限与 CAS 静态契约验证。
2. 浏览器 E2E：两个隔离 Chromium Browser Context，共享模拟云 RPC 服务，分别模拟 Mac 和 iPhone。验证事件与文档往返、离线 Outbox、时钟偏差、幂等、CAS 冲突和恢复。
3. 真实云端验收：在用户自己的 Supabase 项目中执行 Migration，配置 OAuth 和白名单后，用实际 Mac 与 iPhone 登录同一账户验收。模拟云不等于 Supabase 真实验收。

模拟 E2E 覆盖：
- Mac 挑战失败及 Gap 证据 → iPhone 拉取。
- iPhone targeted review 事件及 Session → Mac 拉取。
- 偏好和挑战快照恢复。
- 同一事件重复同步不重复写入。
- 离线事件保持在 Outbox，恢复网络后补传。
- 设备时钟倒退时仍按 user_seq 拉取。
- 两端同时修改挑战快照，产生冲突，选择本机后以新 revision 提交。

注意：模拟 RPC 不验证真实 Supabase Postgres/RLS 执行环境。真实用户隔离测试必须在用户自己的 Supabase 项目中用两份账户执行。

## 11. GitHub Pages 发布边界

GitHub Pages 只托管前端静态资源。Migration、验证脚本、后端实施手册不会进入 _site。前端公开配置仅含 Supabase URL 和 Publishable Key。未配置时使用纯本地模式。

## 12. Supabase Free 预算

按 2026-11-01 查阅到的官方 Free 套餐信息：每个项目数据库 500 MB、50,000 MAU、5 GB egress、1 GB Storage、最多 2 个活动 Free 项目；长期不活跃项目可能在一周后暂停。Free 项目不提供 Pro 级生产保障和每日备份。额度并非永久无限，任何套餐限制都可能调整。

本阶段只使用 Auth、Postgres 和小体积 RPC JSON，不引入 Storage、Realtime 或 Edge Functions，减少超额风险。用户个人事件和 JSON 文档不包括大段代码全文、试卷图片或视频。事件 payload 限制 16 KB，档案文档限制 64 KB；数据库大小仍需关注索引和历史事件增长。

参考：
- Supabase Pricing：https://supabase.com/pricing
- About Billing：https://supabase.com/docs/guides/platform/billing-on-supabase
- Free Postgres Projects：https://supabase.com/kb/faqs/platform/free-postgres-for-side-projects

## 13. 用户侧激活步骤

### A. 创建 Supabase 项目

1. 在 Supabase 创建一个 Project，Free 计划即可开始试用。
2. 记录 Project URL 与 Publishable Key。
3. 在 Dashboard 检查项目 URL / API key 页面。
4. 不要复制或提交 Secret / service_role Key、数据库密码。

### B. 执行 Migration

在 SQL Editor 依次执行：

1. supabase/migrations/20261101070000_learning_cloud_sync.sql
2. supabase/migrations/20261101110000_learning_archive_documents.sql

也可在本地使用 Supabase CLI supabase link 后执行 supabase db push。执行前确认目标 Project Ref，并备份项目中已有数据。

### C. 配置 GitHub OAuth

1. 在 GitHub Developer Settings → OAuth Apps 创建 OAuth App。
2. Homepage URL：https://liucaidong.github.io/knowverse/
3. Authorization callback URL：https://<PROJECT_REF>.supabase.co/auth/v1/callback
4. 在 Supabase Dashboard → Authentication → Sign In / Providers → GitHub 启用 Provider，填入 GitHub OAuth Client ID 和 Client Secret。
5. 在 Supabase Authentication → URL Configuration：
   - Site URL：https://liucaidong.github.io/knowverse/
   - Redirect URL：https://liucaidong.github.io/knowverse/auth/callback/
   - 本地测试可添加 http://localhost:4173/knowverse/auth/callback/

OAuth Client Secret 只进入 Supabase Dashboard，不进入 GitHub 仓库或 Pages。

### D. 设置前端公开环境配置

编辑 assets/js/backend/public-config.js：

~~~js
window.KNOWVERSE_BACKEND_CONFIG = {
  supabaseUrl: "https://<PROJECT_REF>.supabase.co",
  publishableKey: "<SUPABASE_PUBLISHABLE_KEY>"
};
~~~

两个值可以公开；其安全性依赖 RLS、私有白名单和受控 RPC。不要使用 Secret Key 替代 Publishable Key。提交后 Pages 自动部署。

### E. 单用户白名单

1. 打开 KNOWVERSE 学习驾驶舱并使用 GitHub 登录一次。
2. 在 Supabase Dashboard → Authentication → Users 中找到该用户 UUID。
3. 在 SQL Editor 中执行：

~~~sql
insert into private.authorized_users(user_id, note)
values ('<AUTH_USER_UUID>', 'KNOWVERSE owner')
on conflict (user_id) do update set enabled = true;
~~~

普通客户端不能读取或修改此白名单。

### F. 首次登录和双设备验收

1. Mac 打开 https://liucaidong.github.io/knowverse/progress/，登录并确认账号状态为已授权。
2. 完成一个挑战或制造一条失败答案，等待同步完成，待上传事件数归零。
3. iPhone 使用 Safari 打开同一地址，登录相同 GitHub 账号，点击立即同步。
4. 确认同一挑战进度、Gap 和掌握证据恢复。
5. 在 iPhone 完成对应 targeted review，再点击同步。
6. 回到 Mac 点击立即同步，确认复习事件和结果出现，Gap 生命周期按现有独立验证规则更新。
7. 在两台设备分别离线产生事件，重新联网并同步；确认事件均保留且不重复计数。
8. 分别退出登录，确认本地学习档案仍在。

真实云端验收未完成前，产品只能标记为“已部署、等待 Supabase 激活”，不能标记为“Mac + iPhone 已完成真实云同步”。

## 14. 故障排除与回滚

- Migration 报错：停止激活，检查 Migration 执行顺序和 Supabase SQL 错误；不要删除本地存储。
- pending-authorization：确认 GitHub 用户 UUID 已加入 private.authorized_users 且 enabled=true。
- device_not_registered_or_revoked：检查设备记录；被撤销设备需重新注册新设备 ID。
- Outbox 不清零：查看面板错误，确保事件仍保留；修复网络或权限后手动重试。
- 文档冲突：比较本机和云端内容，明确选择一版；另一版本由本地冲突记录保留。
- 本地迁移 needs-attention：根据错误列表排查损坏键；原始 LocalStorage 未删除，可导出后处理。
- 账号切换被阻止：这是本地档案 user_id 绑定保护。请使用原账户完成同步并导出备份，另一账户使用独立浏览器 Profile。
- 回滚前端：恢复上一个 Git commit 并重新部署；IndexedDB V2 和旧 LocalStorage 不会因回滚自动清空。
- 回滚 SQL：优先关闭前端公开配置；不要直接 DROP 用户事件、档案和 Auth 用户。数据表采用向前兼容 Migration 管理，数据清理需另做备份计划。

## 15. 后续演进边界

1. 在保持现有同步式 Challenge Engine API 不破坏的前提下，逐步将 LocalStorage 双写兼容层迁移为 IndexedDB-first async repository。
2. 增加只读设备列表、设备撤销与恢复历史。
3. 为长历史提供归档/压缩策略，但不能丢失可重建掌握度的关键事实。
4. 增加跨领域统一学习时间线与导出/导入加密备份。
5. 如未来存储书籍、试卷图片和视频，再单独评估 Supabase Storage / 对象存储；当前不纳入免费同步核心链路。
