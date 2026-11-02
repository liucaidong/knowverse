# ADR-0001：数据库驱动的统一学习状态架构

- 状态：Accepted（Phase D）
- 日期：2026-11-02
- 决策范围：本机学习数据、云端归档、跨设备同步

## 背景

Phase C 通过单个 LocalStorage JSON envelope 实现逻辑记录的一次提交，但事件历史、挑战现场、复习现场与偏好仍被序列化为单一对象。IndexedDB 只承担 Outbox 和云端文档辅助存储。业务模块仍与具体 Storage API 耦合，多个标签页的并发写入缺乏统一 CAS。事件和文档分别调用两个云 RPC，也没有共同事务边界。

## 决策

1. IndexedDB v4 成为当前设备完整的 canonical learning database。
2. Supabase PostgreSQL 是已同步数据的云端权威。
3. 学习业务只通过 LearningRepository 读写；适配器和 Sync Engine 分层。
4. Learning Events 为 append-only；Learning Documents 只保存当前可恢复现场。
5. 一次本地学习动作的事件、状态文档和 Outbox 在一个 IDB transaction 中提交。
6. 云端由 sync_commit_learning_batch 在一个 PostgreSQL 事务提交事件和文档；文档 CAS 冲突使整批回滚。
7. 状态文档使用 localRevision/baseRevision/cloudRevision；不使用墙上时钟 LWW。
8. 跨账户访问通过本地绑定检查、Supabase JWT、allowlist 和 RLS 共同保护。
9. Phase C 只保留一次性迁移器，迁移核验成功后清理旧学习键，不做长期双读/双写。
10. 旧 IDB store 只在 schema upgrade 完成复制后删除，不要求用户清空站点存储。

## 后果

正面：
- 大事件日志不再每次全量 JSON stringify/parse。
- 事件与现场写入一致性有本地与服务端事务保障。
- 可离线写入，Outbox 确认后删除。
- 账户边界可在业务入口和服务端重复验证。
- Agent 可读取可追溯的事件事实与显式关系，掌握度可以重复计算。

代价：
- 业务 API 变为异步，页面必须 await 保存并展示错误。
- IndexedDB schema 和迁移必须纳入持续测试。
- 多端文档冲突需要人工选择。
- 浏览器本地库仍可能被浏览器存储配额或用户清理影响，重要数据需要导出及云端同步。

## 不选择的方案

- 不继续扩大 LocalStorage envelope。
- 不采用仅云端优先的在线写入（会失去可靠离线学习）。
- 不将全部事件历史塞入 challenge/review 文档。
- 不以 client updated_at 直接覆盖云端。
- 不把 AI Agent 直接设为掌握度裁决来源。

## 相关实现

见 docs/backend/phase-d-architecture.md、phase-d-local-database.md、phase-d-supabase-data-model.md、phase-d-sync.md 和 phase-d-migration.md。
