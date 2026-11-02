# KNOWVERSE Supabase 与本地归档架构

本文件是当前实现说明。数据库只有一份初始化基线；浏览器只有当前一套数据键和 IndexedDB 结构。项目不承载旧版本数据，也不实现 V1→V2、旧键复制、双 schema 兼容或迁移状态机。

## 1. 唯一数据库基线

数据库完整定义位于：

- `supabase/migrations/20261102032732_initial_schema.sql`

该文件定义 KNOWVERSE 当前初始数据库的全部自有表、索引、RLS 策略、函数、触发器和授权。其文件版本 `20261102032732` 与远端 `supabase_migrations.schema_migrations` 中唯一的初始基线记录一致。此基线已经应用，后续结构变更必须通过新的、前向增量迁移文件发布；不要重写已应用基线，也不要再创建第二份初始化脚本。

应用表：

| 表 | 职责 |
|---|---|
| `private.authorized_users` | 服务端维护的账户白名单，不暴露给 PostgREST |
| `public.profiles` | Auth 用户的展示资料 |
| `public.user_devices` | 用户设备注册、平台标签与撤销状态 |
| `public.user_sync_state` | 用户级事件序列 |
| `public.learning_events` | 追加式学习事实事件 |
| `public.user_document_sync_state` | 用户级档案文档序列 |
| `public.learning_archive_documents` | 挑战进度、复习现场与学习计划偏好的 CAS 文档 |

基线在事件表初始定义中直接声明事件 envelope 字段与约束，不通过 ALTER / 回填 / 双版本读取实现升级。当前事件 envelope 只接受 `eventSchemaVersion = 2`。

## 2. 数据库安全模型

- `private` schema 不暴露给 Data API。
- `private.is_authorized_user(uuid)` 是唯一读取私有白名单的安全定义函数；`private.handle_new_auth_user()` 仅供 Auth 用户插入触发器调用。
- 所有 `public` RPC 都使用 `SECURITY INVOKER`，执行权限仅授予 `authenticated`。
- 应用表启用 RLS。策略同时约束 `user_id = auth.uid()` 与白名单状态。
- 事件表只允许本人读取和追加，不授予 UPDATE / DELETE。
- 设备、用户序列、档案序列表只授予必要的 SELECT / INSERT / UPDATE。
- `service_role` 密钥、数据库密码和 OAuth Client Secret 不进入静态站点。浏览器只持有 Supabase URL 与 Publishable Key。
- 如果 Supabase 环境提供 `public.rls_auto_enable()`，基线会撤销其对 `PUBLIC`、`anon`、`authenticated` 的执行权限；KNOWVERSE 自身不依赖该工具函数。

主要 RPC：

- `get_learning_sync_profile()`：检查当前账户是否在白名单中。
- `register_device(...)`：注册当前用户设备。
- `sync_push_learning_events(...)` / `sync_pull_learning_events(...)`：追加事件并按服务端 `user_seq` 分页拉取。
- `sync_push_learning_documents(...)` / `sync_pull_learning_documents(...)`：CAS 文档写入与增量拉取。

掌握度、置信度、薄弱点生命周期和复习计划由客户端确定性 reducer 从事件推导；数据库只保存事实，不接受客户端写入的“掌握分”。

## 3. 浏览器持久化

### LocalStorage：当前本机学习状态

- `knowverse:learning-progress`：完整学习事件日志快照。
- `knowverse:challenge/<challengeId>`：当前挑战现场。
- `knowverse:review-session/<sessionId>`：进行中的复习现场。
- `knowverse:learning-plan:preferences`：每日时长和专题偏好。
- `knowverse:supabase-session` / `knowverse:supabase-pkce`：Supabase Auth 会话与 PKCE verifier。

### IndexedDB：可靠同步基础设施

数据库：`knowverse-learning-archive`，结构版本 1，仅含：

| Store | 职责 |
|---|---|
| `outbox` | 待服务端确认的事件，不确认不删除 |
| `meta` | 设备 ID、设备序列、账户绑定、游标和同步状态 |
| `documents` | 当前设备的 CAS 文档、revision 与 dirty 状态 |
| `conflicts` | 需要用户明确选择的本机/云端冲突 |

本机事件日志只有 LocalStorage 一份权威副本。事件新增时进入 IndexedDB Outbox；首次登录或重新同步时会按事件 ID 幂等补齐 Outbox，服务端确认后才删除队列项。远端事件写入当前事件日志，不回流到 Outbox。

挑战、复习和偏好仍通过当前 LocalStorage 接口供同步式领域引擎即时读取，同时其可恢复文档写入 IndexedDB 并同步到云端。云端文档使用 `revision` compare-and-swap；任何冲突都保留两端内容，由用户明确选择，不使用静默 last-write-wins。

## 4. 事件同步规则

1. 客户端生成稳定 `event_id`，设备本地分配单调递增 `device_seq`。
2. Outbox 按 `device_seq` 上传。服务端以 `(user_id,event_id)` 去重、校验 payload hash，并分配 `user_seq`。
3. 只有服务端确认的事件才从 Outbox 删除。
4. 拉取只使用 `user_seq` 游标，不使用设备墙上时钟排序。
5. `event_id` 相同但 payload 不同会被拒绝；设备序列冲突会被拒绝。
6. 网络失败时 Outbox 保留，在线恢复后重试；重试是幂等的。

## 5. 文档同步规则

档案文档类型：`challenge_progress`、`review_session`、`plan_preferences`。每份文档拥有独立 ID、revision、document_seq 和 payload hash。首次创建要求 base revision 为 0；更新要求服务端 revision 与客户端 base revision 一致。云端相同 payload 的重试会被确认而不是生成假冲突。

收到新远端 revision 时：未修改的本机文档直接应用；本机存在较旧 base 的未同步修改则建立冲突记录。解决冲突时显式选择本机或云端，再以新的 base revision 同步。

## 6. 身份、授权和设备隔离

GitHub OAuth 使用 Supabase Auth PKCE。登录成功不等于可同步；必须由管理员将 Auth UUID 加入 `private.authorized_users`。每个 RPC 再次读取 `auth.uid()` 并检查白名单，不接受客户端指定 `user_id`。本机 IndexedDB 绑定单一账户，切换账户不会自动上传此前账户的数据；使用不同浏览器 Profile 隔离不同账户。

## 7. 维护流程

- 数据库初始结构由 `supabase/migrations/20261102032732_initial_schema.sql` 定义，远端只登记这一条初始版本。
- 新环境先创建 Supabase 项目，再通过 Supabase CLI link 并 `supabase db push`。推送前检查 Project Ref 和迁移列表。
- 已应用的基线不可编辑。后续改表、策略、函数或索引时，新增一个时间戳递增的前向迁移；本项目不维护多版本兼容分支、回填旧 schema 或双初始化脚本。
- 每个新迁移先在 PostgreSQL 17 空白数据库按完整迁移链执行，再部署到开发环境。对测试环境可重置数据库后按迁移链从零重建；不对生产环境执行远端 reset。
- Supabase 托管的 `auth`、`storage`、`extensions` schema 由平台管理。KNOWVERSE 只重建自己拥有的 `public` / `private` 对象，不删除 Auth 用户或平台内部对象。
- 本地 IndexedDB 结构是当前版本 1 数据库；不提供旧库升级链。开发期改变 store 结构时，发布新的数据库名称并要求测试浏览器清除站点数据，不部署多套旧结构兼容路径。

## 8. 当前验收边界

仓库 CI 覆盖 SQL 静态安全契约、IndexedDB Outbox、文档 CAS、离线重试、双浏览器模拟与领域学习测试。模拟 RPC E2E 不等于真实 Supabase Postgres/RLS 集成测试。真实验收还应在 Mac 与 iPhone 的独立浏览器环境中使用同一 GitHub 账户，确认事件与挑战/复习文档双向同步、Outbox 清零，以及双端并发修改需要显式解决冲突。
