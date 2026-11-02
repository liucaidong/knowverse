# Phase D Supabase PostgreSQL 数据模型

## 现有正式表（保留，不重建）

| 表 | 数据职责 | RLS |
|---|---|---|
| `private.authorized_users` | 管理员控制的 Auth UUID allowlist | 内部 schema，不对客户端开放 |
| `public.profiles` | 用户资料 | enabled |
| `public.user_devices` | 用户设备注册和撤销状态 | enabled |
| `public.user_sync_state` | 用户级学习事件游标 | enabled |
| `public.learning_events` | append-only 事件历史 | enabled |
| `public.user_document_sync_state` | 用户级文档游标 | enabled |
| `public.learning_archive_documents` | 当前状态文档 | enabled |

Phase D 不删除或重建这些对象，也不清空原有 profile/device 数据。项目现有 RLS 保持启用。

## Learning Events

云端事件是追加式证据，关键字段包括 event ID、user ID、device ID、设备序列、用户序列、事件发生时间、服务端创建时间和 JSONB payload。唯一约束包含用户 + 设备序列及用户 + 用户序列，事件 ID 用于重试幂等。

客户端提交同 ID 重试不得产生重复事件；同 ID 但 payload 不一致应作为不可变性错误，不可当作成功重复上传。服务端分配 user_seq 作为拉取增量游标；occurred_at 是客户端事件时间，created_at / committed_at 是服务端接收时间，两者用途不同。

## Learning Documents

文档以 `document_id`、`document_type`、`document_key`、`document_payload`、`revision`、`document_seq`、`device_id`、`updated_at` 等字段存储。每用户文档类型 + key 唯一。客户端传入 base_revision，服务端进行 CAS：

- 首次创建：base revision 必须为 0。
- 更新：base revision 必须等于当前云端 revision。
- payload 与当前版本相同：幂等确认，不增加 revision。
- base revision 过期：返回冲突，保留 local 与 remote 两份版本，等待人工选择。
- 删除：写 `_deleted` tombstone payload，通过相同 CAS 流程传播。

## Phase D RPC

migration：`20261102114344_phase_d_atomic_learning_batch.sql`

| RPC | 用途 | 安全边界 |
|---|---|---|
| `sync_commit_learning_batch(uuid,uuid,jsonb,jsonb)` | 一个事务内提交事件与状态文档 | 验证 `auth.uid()`、allowlist、预期账户、设备、批次大小 |
| `sync_pull_learning_events_for_account(uuid,bigint,int)` | 账户绑定的事件增量拉取 | expected user 必须等于当前 JWT |
| `sync_pull_learning_documents_for_account(uuid,bigint,int)` | 账户绑定的文档增量拉取 | expected user 必须等于当前 JWT |

原有事件和文档 push RPC 在批次 RPC 内执行。文档 CAS 返回冲突时，外层批次使用 PostgreSQL exception subtransaction 回滚本次所有文档写入，事件写入不会执行；客户端不会确认 Outbox。只有整个事务提交后才返回 `status=committed`。

## 身份验证与权限

三个新增函数均为 `SECURITY INVOKER`，`search_path = ''`，所有 schema 对象均显式限定。函数从 `auth.uid()` 获取用户，不信任客户端传入的账户字段；服务端再检查私有 allowlist 和注册设备。函数 revoke public/anon，grant authenticated。

认证前端只能使用 Supabase Publishable Key；Service Role、数据库密码和 OAuth secret 不得进入 Pages 静态资源。

## 增量游标

事件和文档分别有独立 cursor：
- `user_seq`：服务端事件单调序列。
- `document_seq`：服务端状态文档单调序列。

客户端只有在本地 merge/apply 成功后才推进对应游标。拉取中断可安全重试，重复事件由稳定 ID 去重，旧文档 revision 不会覆盖新本地版本。

## 当前线上变更

Phase D migration 已在 Supabase project `sxcpareycpokcyroufww` 应用，并核对三个 RPC 的安全属性：security invoker、空 search_path、anon 无 EXECUTE、authenticated 有 EXECUTE。迁移为 additive，不删除现有表或历史行。真实双账户 JWT 的 RLS 实测仍应作为生产验收项，不能用 SQL Editor/service role 查询冒充客户端 RLS 测试。
