# Phase G 正式基线冻结记录

冻结时间：2026-11-03 16:31:57 +08:00
仓库：liucaidong/knowverse；分支：main
生产站点：https://liucaidong.github.io/knowverse/

## Git 基线

| 项目 | 冻结值 |
| --- | --- |
| main / 本地 HEAD | d31532e72b5aacd3097cfe34596c5d47a6690862 |
| origin/main | d31532e72b5aacd3097cfe34596c5d47a6690862 |
| 工作区 / ahead / behind | clean / 0 / 0 |
| Annotated Tag | phase-g-stable-20261103 |
| Tag object | d4240ecbc2ec7b5dbf1a35c38d7a8de4c1dd1dc4 |
| Peeled commit | d31532e72b5aacd3097cfe34596c5d47a6690862 |
| 推送 | 成功；不覆盖旧 Tag；无 Force Push |

Tag：https://github.com/liucaidong/knowverse/tree/phase-g-stable-20261103

## Phase G GitHub Actions

- Validate #128，run 41597355132，success：https://github.com/liucaidong/knowverse/actions/runs/41597355132
- Pages Deploy #93，run 41597355095，success：https://github.com/liucaidong/knowverse/actions/runs/41597355095

以上只代表 G 冻结 SHA，H1 Actions 结果以后续提交后的 workflow 为准。

## 架构基线

Learning Events V3 是追加式事实流；Learning Intelligence 从事件推导掌握、置信度和 gap；IndexedDB v4 + LearningRepository 提供本地事务、Outbox、CAS 和账户边界；Supabase 的 learning_events / learning_archive_documents 承载云端事实及版本化档案；Phase E 管理目标/计划/任务；Phase F 管理复习/风险/诊断/投影；Phase G 通过 180 天观察窗口、60 天衰减、72 小时冷却和有限参数移动校准策略。H1 复用以上架构。

## 冻结文件 SHA-256

| 文件（Tag 内容） | SHA-256 |
| --- | --- |
| assets/js/learning-progress.mjs | 75914b89512c4570bad08aa072786ecec96eaea9686d3c9f5bf0fa6ba5e7225c |
| assets/js/learning-strategy-engine.mjs | adb0fd1303268d0244b03bf14db837d736443129d2f43d3fc1a8aa785255a839 |
| assets/js/proactive-learning-engine.mjs | 6d8422921228cb3c21babfe163298b8a16f72497ae72ca8980e3c1376a3124be |
| assets/js/learning-planner.mjs | 1252c649d488c38eac3dbbb507fac7924836eb4ed2ab663d29c41bee60a960b5 |
| assets/js/spaced-repetition-engine.mjs | 2cd5041ab909698303561858c84bf951cc0780574d216a863663204bd7e71808 |
| assets/js/review-engine.mjs | 1ee72cd586d5fe511c8f26d2f9d253a240f9b56c261ac4e31448aa458f5d9c5c |
| assets/js/learning-agent/task-orchestrator.mjs | 4d4f6a50e6663799c711e84381847cecd2b82f9ac74d1206f5dca0185b57a838 |
| assets/js/backend/learning-repository.mjs | 7d8797741c62c60df40fff1cdcc99bde6ee67b190def4616a9f6fb4e9118a727 |
| assets/js/backend/local-event-store.mjs | f30b314fcb88c987c24358dbb93b3d85f4864106cf02e89255be1584075116d1 |
| assets/js/backend/sync-engine.mjs | 949f7c473b3acef61a3032c78bab4724d8578e1f2026d196d5ca26cab495f751 |
| supabase/migrations/20261102032732_learning_archive_documents.sql | ef3caebaaa0a9f7880044de86bfb87d5cc74682402dcf7d71e5b7d598ae378f8 |
| supabase/migrations/20261102114344_phase_d_atomic_learning_batch.sql | 7255cab1ff9de175d71457179927cd4c654f4d5b7ce85789ce3153f3b0fa99bc |
| content/learning-map.json | 79b394dd5b61c400f144d178ec9b7df100b9eb003dbe192a7c8ff1f9c76faf6c |
| content/challenges.json | 66d7a43b89b6176ee96717885d2448c8ae58fd9042d4d4cce7d2017ea1ff76c4 |

基线构建产物：data/search.json 596e632c170def90a863d9a675ee35320f04df77db1b67a579c8bf94bb768c28；data/monorepo-graph.json c113da387416ed07b6f2238e7edda89a67fbfc25f49839f0d1392f0f5703c56f；content/knowledge.json 29af916e460327dbc9d36a9c207e1a44b6f45e70109bd4e1c3bff244c266ad35。

## 数据库基线

Supabase project ref sxcpareycpokcyroufww，eu-west-1，PostgreSQL 17.11。已部署迁移：20261102032732 initial_schema、20261102090144 gap_causality_v3、20261102114344 phase_d_atomic_learning_batch、20261102165337 phase_e_learning_documents、20261102190100 phase_f_proactive_projection。H1 没有变更数据库 schema / RLS / 迁移，也未清理用户数据。

## 限制

GitHub Pages 无常驻后台任务。Playwright WebKit 不等同真实 iPhone Safari；模拟 CAS 不等同两台生产设备真实并发。云端学习事件为 0 不排除用户本机 IndexedDB 有离线未同步事实；H1 不读取、不清空、不推断该本机数据。
