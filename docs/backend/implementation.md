# KNOWVERSE 后端与个人学习数据实现说明

本文是当前实现导航。详细设计见：

- Phase D 总体架构：phase-d-architecture.md
- IndexedDB 本地数据库：phase-d-local-database.md
- Supabase 数据模型：phase-d-supabase-data-model.md
- 同步与冲突协议：phase-d-sync.md
- Phase C → D 迁移手册：phase-d-migration.md
- Mac / iPhone Safari 实体设备验收：phase-d-real-device-acceptance.md
- 架构决策 ADR-0001：../adr/ADR-0001-learning-data-architecture.md

## 1. 当前架构

IndexedDB v4 是本机学习数据的唯一权威存储；Supabase PostgreSQL 是已同步数据的云端权威。LocalStorage 不再承担运行时学习状态或事件日志。旧 Phase C envelope 和 Promise Realm 旧存档仅通过一次性迁移器读取，迁移核验成功后清理明确列入 allowlist 的旧学习键。

业务代码的唯一入口是 assets/js/backend/learning-repository.mjs。学习领域模块不得直接使用 IndexedDB、LocalStorage 或 Supabase REST API。

## 2. 本机数据库

Database：knowverse-learning-archive，版本 4，使用浏览器原生 IndexedDB。

| Object Store | 职责 |
|---|---|
| learningEvents | 完整追加式学习事件日志 |
| learningDocuments | challenge、review、plan 偏好当前现场 |
| outbox | 需要服务端确认的本机事件 |
| syncMetadata | 账户绑定、独立游标、同步状态和 lease |
| devices | 当前设备 ID 和单调序列 |
| conflicts | 本地 / 云端文档冲突 |
| migrationMetadata | Phase C 源指纹和迁移标记 |

一次学习动作产生的事件、状态文档和 Outbox 必须在同一个 IDB transaction 中写入。文档更新使用 expectedLocalRevision，拒绝多标签页的过期写入。浏览器配额错误或事务 abort 会明确报错，不显示保存成功。

事件历史使用复合索引游标读取，不按固定条数静默截断；相同时间戳以服务端序列、设备 ID 和设备序列稳定排序。

## 3. 学习数据模型

- Learning Event：发生过的事实，只追加，不原位覆盖。
- Learning Document：当前可恢复的挑战、复习现场和计划偏好；删除使用 tombstone。
- Outbox：只在服务端确认后删除。
- Mastery / Confidence / Gap：由确定性 reducer 根据事件推导，不由客户端直接向数据库写入掌握分数。

当前文档类型为 challenge_progress、review_session、plan_preferences。

## 4. 云端同步和身份

新增 migration：20261102114344_phase_d_atomic_learning_batch.sql。

- sync_commit_learning_batch 在一个 PostgreSQL 事务内提交事件和文档。
- 文档 CAS 冲突会使整个批次回滚，事件不被单独确认。
- 两个 Pull wrapper 在每次请求时验证 JWT 用户等于客户端预期账户。
- 新函数均为 SECURITY INVOKER、空 search_path；撤销 public / anon 执行权限，只授权 authenticated。
- RLS、JWT、private allowlist 和设备注册共同构成服务端边界。

本机数据库绑定单一账户。Repository 在每次领域读写时检查当前认证用户与本地绑定；不一致时拒绝访问。不同账户应使用不同浏览器 Profile。

## 5. 数据迁移

Phase C → D 迁移先校验格式和 allowlist，计算 SHA-256 指纹，在单一 IDB transaction 内导入事件、文档与迁移标记，再回读核验。只有验证成功后才清理旧 envelope 和旧学习键。Auth / PKCE / callback state 不在清理 allowlist 内。

IndexedDB v1–v3 的 Outbox、meta、documents 和既有事件会在 schema upgrade transaction 中前向迁移；旧 Outbox 会回填到新的事件日志，避免服务端确认后本机失去事件历史。迁移完成前不删除源 store。

## 6. 同步和恢复行为

- 正常 Sync：Push 原子批次，随后 Pull 事件和文档。
- 显式 Restore：pull-only，不先上传本机 Outbox / dirty 文档。
- 网络失败：Outbox 保留，网络恢复后重试。
- 重复事件：稳定 event ID 幂等；相同 ID 不同 payload 拒绝。
- 文档冲突：CAS 保留双方版本，用户明确选择 local 或 remote。
- 多标签页：IDB lease + 同标签页串行队列避免并发同步。

## 7. 部署与验收

应用 migration 后执行数据库对象、函数属性、RLS 与 advisor 检查。GitHub Pages workflow 只发布静态站点，排除 supabase/ 与环境文件。

自动化 WebKit viewport 不是实体 iPhone Safari 验收。真实设备 OAuth、Mac → iPhone 冷恢复、离线写入、反向同步、CAS 冲突和真实双账户 JWT RLS 仍需按 phase-d-real-device-acceptance.md 现场记录。
