# KNOWVERSE — Phase N 生产就绪报告

**报告日期：** 2026-11-04
**总体结论：** NOT PRODUCTION READY
**Phase N 状态：** IN_PROGRESS

## 1. 结论

KNOWVERSE 当前具备较完整的静态知识内容、三个专题学习图谱、本地学习引擎、Supabase 数据模型和已部署的 AI Edge Function 入口。但 Phase N 的五项 P1 目标均尚未全部通过真实生产级验收。

当前只完成 N1 的审查与修复准备；PR #11 仍 OPEN，没有正式 Review，生产 main 尚未包含迁移文件。N2 的真实双设备同步、N3 的真实模型调用、N4 的人工审核到 Pages 注册闭环、N5 的两个新增正式图谱均未验收。

## 2. 已验证项目

- 生产 Supabase migration ledger 包含 12 条迁移，版本名与 PR #11 文件对应。
- 生产 Auth 审核员身份、启用的 content_admin 记录和 allowlist 记录存在且计数符合审计基线。
- 普通客户端角色不能读取 private reviewer 表，也不能执行 reviewer lookup RPC。
- 生产数据关键计数：learning_events 0、learning_archive_documents 3、practice_candidate_quality_records 0、user_devices 1。
- 在本地 PostgreSQL 17 兼容隔离环境，全部 12 条 migration 可从空 Auth 用户库重放；存在合成 Auth 身份时能创建 reviewer；重复运行不覆盖现有 reviewer 记录。
- 新增 PostgreSQL 17 migration replay 脚本并加入 Validate workflow；本机脚本通过。
- PR #11 原有 CI 检查 PASS，但本次新增 workflow 门禁需在推送后由 GitHub Actions 再次执行；目前没有正式人工 Review。

## 3. 尚未验证 / 未通过项目

- Git main 与生产迁移完整对齐（等待 PR #11 审查、批准和合并）。
- 托管 Supabase staging / 全新项目从零部署验证（本次 PG17 bootstrap 不是托管 Supabase 的完整替代）。
- Mac + 第二设备真实 Auth 登录、学习计划恢复、测评事件同步、离线补传、CAS 冲突和跨账号隔离。
- AI Tutor、Learning Agent、独立 Reviewer 的真实模型调用与错误注入。
- AI 候选内容从确定性校验到独立 Reviewer、人工审批、受保护 PR、Pages 精确核验和正式注册的完整闭环。
- 两个新增主题的完整学习图谱、官方来源、学习入口、测评与掌握证据验证。
- 备份恢复演练、实体 iPhone Safari 验收，以及全量内容语义事实核验。

## 4. 安全 / 变更记录

本阶段没有向生产数据库执行 INSERT、UPDATE、DELETE 或 DDL；没有修改生产 Auth 设置、权限、Edge Functions 或 Secrets；没有合并 PR；没有部署生产 Pages；没有创建生产测试账号或测试业务数据。

生产检查限定为读取 migration 列表、表/列元数据、行数、函数定义和 ACL。迁移重放在本机临时 PostgreSQL 容器中完成，使用合成 Auth 用户。

## 5. 生产准入条件

在宣布生产就绪前，必须至少满足：

1. N1 合并受审查 migration，且 main、生产 ledger 与受控迁移源码状态一致。
2. N2 在隔离 staging 完成真实双设备、同账号一致性、跨账号隔离、离线重试和 CAS 冲突验收。
3. N3 完成 Tutor、Agent、独立 Reviewer 真实 Provider 调用与失败关闭验证。
4. N4 完成至少一条真实候选的 deterministic → AI → 人工 → PR → Pages → registry 闭环。
5. N5 完成两个专题的正式学习图谱和来源审核。
6. 单元、集成、浏览器 E2E、数据库重建和 staging 验收全部通过；不通过的测试不得删除或降级。
7. 风险登记册中没有未披露 P0/P1；所有未完成 P2 均有负责人、计划和接受记录。

## 6. 最终判断

**当前不得宣布 Phase N COMPLETE，也不得宣称 KNOWVERSE 已具备生产级个人学习数据闭环或可靠的 AI 主动规划能力。** 当前状态仅代表 N1 已完成技术修复准备和本地 PostgreSQL 17 重放验证，等待 PR 审查与受控合并流程。
