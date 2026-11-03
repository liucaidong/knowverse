# Phase H1 真实学习闭环架构审计

日期：2026-11-03。范围：源代码、内容注册表、自动化测试、Supabase 生产 schema 与只读数据。

## 总结

KNOWVERSE 已具备学习事件、掌握推导、目标/计划/任务、挑战、针对性复习、策略调校和跨设备同步的大部分工程基础。Phase G 已通过 Proactive Projection、Planner、Task Orchestrator 和 Review Engine 使用相同策略决策 ID。生产云端目前没有真实学习事件，不能声称已验证真实学习效果。

H1 修复了一个实际 P2 断链：Promise 课程正文页此前未加载共享 learning-integration.mjs；规划器可以推荐阅读，但用户无法在课程正文页启动、暂停、恢复和明确完成阅读任务。

## 生产数据只读核验

Supabase project sxcpareycpokcyroufww，PostgreSQL 17.11。learning_events=0；learning_archive_documents=3：

- challenge_progress / promise-realm：revision 1，stage 0，done 为三个 false，3 个保存解答状态。这是旧挑战现场，不是掌握证据。
- learner_profile / strategy：mode adaptive、active false、cold-start、confidence score 0、evidence 0、history 0、profileRevision 0。
- proactive_learning_projection / current：sourceEventCount 0。
- 没有云端 learning_goal / learning_plan / learning_plan_head / learning_task / review_session 文档。

6 张 public 业务表均启用 RLS。anon 对 public 学习表没有 SELECT。learning_events 允许用户作用域 SELECT/INSERT，不允许 UPDATE/DELETE；learning_archive_documents 允许用户作用域 SELECT/INSERT/UPDATE，不允许 DELETE。没有执行 SQL 写入、DDL、migration 或 reset。

Advisor：private.authorized_users RLS 开启且 anon/authenticated 没有表权限，无 policy 是私有封闭表，不应添加宽松 policy。Auth leaked password protection 未开启（WARN），需要项目 owner 在 Auth 安全设置中单独评估。三个 unused index 是 INFO，本期不删除。

设备本地 IndexedDB 未从用户浏览器 profile 读取：Browser connector 未提供当前起始浏览器上下文；云端 0 事件不能推出本机 0 事件。

## 七个业务环节

| 环节 | 代码与真实能力 | 当前边界 |
| --- | --- | --- |
| 目标 | assets/js/learning-agent/goal-manager.mjs：validateGoal / create / update；只接收现有 topicId/competencyId；active/paused/completed/cancelled 有合法转换；/agent/ 的 workspace 有目标表单 | 自动化验证通过；生产云端无目标文档 |
| 画像 | learner-profile.mjs：normalizeLearnerPreferences / deriveLearnerProfile；分别统计任务终态、尝试、提示、日期、专题和掌握；浏览不等于掌握 | 生产 cold-start，无画像学习样本 |
| 规划 | learning-planner.mjs：buildAdaptiveLearningPlan；先修链、现有 evidence、已用 variant、预算、专题偏好和现存任务参与候选；plan-manager 先提案，学习者接受后建任务 | 自动化通过；无生产计划 |
| 实际学习 | challenge-engine / learning-progress.mjs 记录 attempt、hint、completed；learning-integration 将工作/检查点连接 Repository；H1 新增 Promise 课程正文任务入口 | 阅读任务 execution 不再断链；真实阅读/答题待学习者 |
| gap 与复习 | deriveLearningInsights 区分 unverified/weak/building/initial/stable；review-engine 使用不同 variant、无提示和显式因果链；spaced-repetition 按复习会话质量调度 | 逻辑测试全面；云端无真实 gap |
| 策略 | learning-strategy-engine 由 proactive-learning-engine.refresh 驱动；决策 ID 进入 plan/task/review；样本门槛、冷却、参数边界和回退存在 | 接入完整业务路径，但当前 active=false/cold-start |
| 同步/安全 | IndexedDB v4 + LearningRepository + Outbox + CAS；sync-engine 原子 push/pull；Supabase RLS 和账户/设备校验 | 自动化 offline/cold restore/CAS 通过；实体 iPhone 与生产双设备待做 |

### 目标和计划详情

goal-manager 的 validateGoal 只接受知识图谱中已有专题或能力 ID；create/update 将事件与档案一起 Repository commit。目标完成需要 profile 状态 ready-to-complete。learning-agent/workspace.mjs 提供 /agent/ 页面目标创建和生命周期控制。plan-manager 保存不可变提案历史；只有点击接受才创建任务。task-orchestrator 状态机覆盖 locked、ready、in_progress、paused、failed、completed、skipped、cancelled。

### 薄弱点和策略详情

learning-progress.mjs：createChallengeLearningEvents、getOpenGapObservationEventIds、deriveLearningInsights。Review Engine 要求失败观察、开始复习、无提示 attempt、不同 variant 和 pass 的因果链；不能从时间顺序推断因果。Phase G 有 72 小时冷却和有限参数移动；任务完成只衡量执行，不作为掌握。当前个性化选择是 adaptive，但 active false 是正确冷启动状态。

### H1 阅读修复

20 个 Promise lesson 页面均加载共享 integration。课程页 activity 只作为 exploration；五个已有 competency lessonHref 路由在带有有效 taskId 时，显示 reader task panel。面板核验 taskType、resourceType、topicId、competencyId 和 pathname；显式点击开始/暂停/继续/确认完成。确认完成后调用 Task Orchestrator.refreshUnlocks 解锁依赖该阅读的后续挑战任务。完成阅读只生成 learning_task execution event，evidenceEventIds 为空，不产生 mastery assessment。

## 数据库决策

现有 archive_documents 白名单已经支持 goal / plan / task / review / profile / projection，Events V3 支持因果关联；本次缺口是页面没有接入现有任务运行时，而不是 schema 不足。因此不新增表、不新增 migration、不调整 RLS。
