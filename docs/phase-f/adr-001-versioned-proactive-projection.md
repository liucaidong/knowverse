# ADR-001：将主动学习投影存储为现有 Archive 文档

- 状态：Accepted
- 日期：2026-11-03
- 范围：Phase F 派生调度、风险、趋势、目标预测与 Next Best Action 缓存

## 背景

Phase D/E 已建立 LearningRepository、IndexedDB v4、learningDocuments、Supabase `learning_archive_documents`、Outbox、revision/CAS 和用户/设备隔离。学习事件是唯一原始事实；Learning Intelligence 是掌握度权威；任务和计划分别由 Task Orchestrator 与 Plan Manager 管理。

Phase F 需要保存可恢复的派生投影，但这些结果必须能从原始事件、目标、偏好和知识注册表重建，不能成为新的事实来源。

## 决策

新增一种文档类型 `proactive_learning_projection`，只保存一个 `current` 版本化投影，沿用现有 Repository documents API、IndexedDB v4 文档存储、Outbox 同步、Supabase archive CAS RPC 和 RLS。投影包含 schema/algorithm version、source fingerprint、computedAt 和有限证据引用。

不新建表、不新增独立 repository、不复制掌握度或学习事件、不升级 IndexedDB schema version。

## 原因

1. 投影是派生缓存，生命周期与事件文档相同，适合版本化文档而不是新事实表。
2. 复用已有 Repository/CAS 可以避免引入第二条同步管线和跨设备 last-write-wins。
3. 投影损坏、缺失或过期时可以重算；无需进行数据迁移。
4. 原始事件仍是唯一证据，任务和计划仍走既有状态机，Agent 无直接 DB 权限。

## 安全与冲突

- 本地及云端写入都经 LearningRepository。
- Supabase 只扩展 archive document type check 与原 `sync_push_learning_documents` RPC 白名单。
- 保留原 RLS、用户所有权、JWT、active-device 校验、payload 限制、idempotency 和 CAS。
- 多设备写入冲突时有限重读/重算，不做 last-write-wins。
- 投影不是权威数据，不能直接关闭 gap、改变 mastery 或完成任务。

## 后果

优点是改动最小、可重建、沿用跨设备同步和访问控制。缺点是当前投影 payload 受现有 archive 文档大小上限约束，未来若 projection 明显增长，应先考虑分片与确定性多文档 CAS，而不是立即另建数据库。

浏览器关闭期间不执行计算；重新打开或设备恢复同步后从原始事件补算。真正的服务端常驻调度不在本 ADR 范围。
