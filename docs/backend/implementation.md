# KNOWVERSE Supabase 与本地归档架构

本文件是当前实现说明。数据库保留一份已应用初始化基线，并以单一前向迁移升级事件 envelope；浏览器只有当前一套数据键和 IndexedDB 结构。当前运行时只写入 Event Schema V3，不实现 V1/V2 双 schema 兼容或旧键复制状态机。

## 1. 数据库基线与前向迁移

数据库完整定义位于：

- `supabase/migrations/20261102032732_initial_schema.sql`

该文件定义 KNOWVERSE 数据库初始自有表、索引、RLS 策略、函数、触发器和授权。文件版本 20261102032732 是已应用初始化基线；该基线中的事件 envelope 是 V2。当前已额外应用前向迁移 20261102090144_gap_causality_v3.sql，把事件表约束与触发器升级到 V3。远端迁移记录必须与本地文件版本完全一致。不要重写已应用基线。

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

初始化基线仍保留当时的 V2 定义，前向迁移将现有 event payload 补齐 eventSchemaVersion、causationEventIds、targetGapEventIds 与 gapObservationId，并把数据库约束更新为 schema_version = 3。当前数据库仅接受 V3；没有 V2/V3 双版本写入分支。

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

本机事件日志只有 LocalStorage 一份权威副本。事件新增时进入 IndexedDB Outbox；首次登录或重新同步时会按事件 ID 幂等补齐 Outbox，服务端确认后才删除队列项。Outbox 读取时会把未发送的旧事件 envelope 规范化为 V3，保留 event ID / device sequence；相同 ID 但 payload 不同会拒绝。远端事件写入当前事件日志，不回流到 Outbox。

挑战、复习和偏好仍通过当前 LocalStorage 接口供同步式领域引擎即时读取，同时其可恢复文档写入 IndexedDB 并同步到云端。云端文档使用 `revision` compare-and-swap；任何冲突都保留两端内容，由用户明确选择，不使用静默 last-write-wins。

## 4. 事件同步规则

1. 客户端生成稳定 `event_id`，设备本地分配单调递增 `device_seq`。
2. Outbox 按 `device_seq` 上传。服务端以 `(user_id,event_id)` 去重、校验 payload hash，并分配 `user_seq`。
3. 只有服务端确认的事件才从 Outbox 删除。
4. 拉取只使用 `user_seq` 游标，不使用设备墙上时钟排序。
5. `event_id` 相同但 payload 不同会被拒绝；设备序列冲突会被拒绝。
6. V3 的 causationEventIds / targetGapEventIds 最多 20 项，gapObservationId 标识一次精确错误观察。
7. 网络失败时 Outbox 保留，在线恢复后重试；重试是幂等的。

## 5. 文档同步规则

档案文档类型：`challenge_progress`、`review_session`、`plan_preferences`。每份文档拥有独立 ID、revision、document_seq 和 payload hash。首次创建要求 base revision 为 0；更新要求服务端 revision 与客户端 base revision 一致。云端相同 payload 的重试会被确认而不是生成假冲突。

收到新远端 revision 时：未修改的本机文档直接应用；本机存在较旧 base 的未同步修改则建立冲突记录。解决冲突时显式选择本机或云端，再以新的 base revision 同步。

## 6. 身份、授权和设备隔离

GitHub OAuth 使用 Supabase Auth PKCE。登录成功不等于可同步；必须由管理员将 Auth UUID 加入 `private.authorized_users`。每个 RPC 再次读取 `auth.uid()` 并检查白名单，不接受客户端指定 `user_id`。本机 IndexedDB 绑定单一账户，切换账户不会自动上传此前账户的数据；使用不同浏览器 Profile 隔离不同账户。

## 7. 维护流程

- 数据库初始结构由 supabase/migrations/20261102032732_initial_schema.sql 定义；当前远端另有 20261102090144_gap_causality_v3.sql 前向迁移，迁移列表须与仓库一致。
- 新环境先创建 Supabase 项目，再通过 Supabase CLI link 并 `supabase db push`。推送前检查 Project Ref 和迁移列表。
- 已应用的基线与前向迁移都不可回写。后续改表、策略、函数或索引时，再新增时间戳前向迁移；当前运行时只接受 V3，不维护多版本写入分支。
- 每个新迁移先在 PostgreSQL 17 空白数据库按完整迁移链执行，再部署到开发环境。对测试环境可重置数据库后按迁移链从零重建；不对生产环境执行远端 reset。
- Supabase 托管的 `auth`、`storage`、`extensions` schema 由平台管理。KNOWVERSE 只重建自己拥有的 `public` / `private` 对象，不删除 Auth 用户或平台内部对象。
- 本地 IndexedDB 结构是当前版本 1 数据库；不提供旧库升级链。开发期改变 store 结构时，发布新的数据库名称并要求测试浏览器清除站点数据，不部署多套旧结构兼容路径。

## 8. 当前验收边界

仓库 CI 覆盖 SQL 静态安全契约、IndexedDB Outbox、文档 CAS、离线重试、双浏览器模拟与领域学习测试。V3 前向迁移已应用至当前 Supabase Postgres，远端事件表 schema version 约束及默认值均为 3；真实 Mac 与 iPhone Safari 的账户授权、事件双向同步、活动会话恢复和冲突选择仍需设备实测。自动化 WebKit 移动视口不等于真实 iPhone 设备验收。
