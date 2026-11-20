# 04 · 数据库审计（2026-11-20，本地/只读）

## 审计边界

本轮 Supabase CLI link 指向 **Staging**（`ypthoicwrfsblaidllyy`），生产（`sxcpareycpokcyroufww`）仅沿用历史只读结论，未在本次写入、迁移或删除任何生产数据。生产迁移属需授权操作，本轮未执行。

## Schema 与迁移

- 本地 13 条 migration（`supabase/migrations/`），PG17 replay 本轮实跑：空 Auth 库与 seeded Auth 库各 13/13 应用成功，`verify-supabase-migration-replay.sh` SUCCESS。
- Phase N 函数体本地与生产语义已比对（4.1：MD5 一致 5185 bytes）；版本号时间戳不同（本地 `20261113041514` vs 生产 `20261113153515`），作为 provenance 风险保留，不修正历史版本。
- 表：`profiles`、`user_devices`、`user_sync_state`、`learning_events`（append-only）、`user_document_sync_state`、`learning_archive_documents`、`practice_candidate_quality_records`，及 private schema 授权/审核表。

## 数据一致性与隔离（本轮实跑）

`verify-supabase-sync-isolation.sh`（真实 PG17 SQL/RLS/RPC）本轮通过：
- 同用户双设备注册与归属；事件+档案原子提交。
- 相同 event ID/payload/device sequence 幂等重试。
- stale revision 触发 CAS 冲突，同批已写入内容整批回滚。
- 冲突解决后新 revision 正常提交；分页游标/has_more 行为正确。
- 账号 B 不能读 A 的事件/文档，不能伪造 A 的 expected_user_id 或设备 ID。

## 重点领域评估

- 学习进度持久化：事件 append-only，reducer 派生掌握度/置信度/Gap——可靠。
- 学习证据可追溯：`sourceEvidenceRefs`/`causationEventIds`/`targetGapEventIds` 全链传播（4.1 修复，本轮单测复核）。
- 薄弱点→证据、复习计划→评估结果：因果链显式引用，本地单测覆盖。
- 并发/幂等/CAS/事务：PG17 集成测试通过。
- 多设备同步：本地 + PG17 契约通过；Staging 首设备通过，第二物理设备未验。
- 旧数据兼容：历史 plan 事件缺 topicIds 采用仅向前缓解，不回写生产。

## 未执行 / 阻塞

- 生产 migration：未执行（需授权）。
- 生产真实数据因果链验收：样本不足，NOT RUN。
- Advisor 未使用索引：保留（stats_reset 为 NULL，不足以安全删除）；leak-password protection 需授权。
