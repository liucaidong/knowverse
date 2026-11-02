# Phase D 本地数据库设计

## 数据库身份

- Database：`knowverse-learning-archive`
- Schema version：**4**
- 实现：原生 IndexedDB，无新增运行时数据库封装依赖。
- 入口：`assets/js/backend/local-event-store.mjs`
- 业务入口：`assets/js/backend/learning-repository.mjs`

## Object Stores

| Store | Primary key | 主要索引 | 用途 |
|---|---|---|---|
| `learningEvents` | `id` | occurredAt、eventType、topicId、accountId、[accountId, occurredAt]、[occurredAt,userSeq,deviceId,deviceSeq,id]、[accountId,occurredAt,userSeq,deviceId,deviceSeq,id] | 本地追加式学习事件日志 |
| `learningDocuments` | `id` | [type,key]、dirty、updatedAt、accountId | 当前可恢复的活动状态文档 |
| `outbox` | `id` | queuedAt、accountId | 等待服务端确认的本机事件 |
| `syncMetadata` | `key` | primary | 游标、账户绑定、同步元数据、租约 |
| `devices` | `id` | primary | 当前设备 ID、单调设备序列、账户归属 |
| `conflicts` | `id` | primary | 文档 CAS 冲突和云端候选版本 |
| `migrationMetadata` | `key` | primary | 一次性迁移标记、源指纹、数量与时间 |

## 本地事件行

`learningEvents` 的 row 将事件 payload 与本地同步元数据分开：

- `id`：稳定事件 ID。
- `event`：Event Schema V3 payload。
- `accountId` / `deviceId` / `deviceSeq`：本机隔离与排序信息。
- `occurredAt` / `eventType` / `topicId`：查询索引字段。
- `createdAt`：本地首次落盘时间。
- `syncedAt` / `userSeq`：服务端确认状态。

事件按 `byOccurredAt` 或 `byAccountOccurredAt` 游标分页读取，可传入 `offset`、`limit` 和 `order`。页面可通过仓储接口逐页读取，不需要重写全量 JSON snapshot。

## 本地文档行

`learningDocuments` 包含 `type`、`key`、`payload`、`hash`、`accountId`、`localRevision`、`cloudRevision`、`baseRevision`、`documentSeq`、`deviceId`、`updatedAt`、`dirty`、`conflict` 和 `syncedAt`。

文档 payload 上限为 64 KiB，避免活动现场无限增长。历史事件必须保存在事件日志，不能永久塞入状态文档。

当前文档类型：
- `challenge_progress`：一个 challenge 的可恢复运行现场。
- `review_session`：一个未完成的 Review Session；结束后写 tombstone。
- `plan_preferences`：每日时长和专题偏好。

## 原子写 API

`commitLearningBatch({events, documents, accountId, migrationMarker})` 是核心写入原语：

1. 验证每个 event schema 和稳定 ID。
2. 检查同批次重复 ID 是否具有相同内容。
3. 检查数据库中同 ID 的历史 payload 不可变。
4. 检查本地账户绑定。
5. 检查文档 expectedLocalRevision。
6. 写入事件日志与 Outbox。
7. 写入状态文档。
8. 写迁移标记（如适用）。
9. 所有请求在同一个 IndexedDB transaction 完成后才返回成功。

任何检查或请求失败均 abort 事务。远端事件 merge 不创建 Outbox，服务端已确认的事件不会因恢复再次被上传。

## 多标签页与生命周期

- IDB 数据库连接遇到 `versionchange` 会关闭，避免长期占用升级锁。
- 新旧标签页同时运行导致 upgrade blocked 时发出可见诊断事件。
- 同步使用 `syncMetadata` 里的 lease，限制同一来源的并发 sync/restore。
- 同一标签页的 Sync Engine 用串行 Promise 队列避免并发操作重入。
- challenge、review 与 plan document 写入使用 localRevision 乐观锁。
- 云端 revision 冲突进入 `conflicts`，只允许明确选择 local 或 remote。
- Outbox 只在服务器确认后删除；掉线和响应丢失后可幂等重试。

## 删除、配额与迁移

- 业务文档删除使用 tombstone，不做静默物理删除。
- 事件是审计证据，不由挑战清理动作级联删除。
- 重要迁移数据只有回读核验成功后才删除旧键或旧 store。
- `QuotaExceededError` 转成明确错误，原事务回滚。
- IDB upgrade 请求失败会回滚升级事务，旧 schema 仍可再次升级或人工恢复。
- 清理历史事件/文档之前，必须由明确的数据保留策略与用户导出流程授权；Phase D 不做自动截断。

## 设计限制

浏览器 IndexedDB 不是跨设备数据库；设备之间共享依赖 Supabase RPC。浏览器可能清理站点数据，重要长期记录应提供导出备份。事件分页按索引游标读取，掌握度 reducer 如需全历史，仍需在应用层选择合理的数据读取窗口或后台投影。
