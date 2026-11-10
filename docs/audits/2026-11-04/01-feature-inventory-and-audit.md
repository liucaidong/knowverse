# KNOWVERSE 功能清单与功能审核报告

**审计日期：** 2026-11-04  
**基线：** origin/main a50eaca521b1；审计分支 phase-m/authorize-initial-content-admin-2026-11-04 7b788f1e8d3b  
**Pages 部署：** run 41732040457，main a50eaca521b1

## 1. 审核口径
清单分为系统能力、互动作品和 canonical route surfaces。路由存在只证明页面可达，不等于业务功能完整。
COMPLETE=当前范围实现和自动化证据充分；PARTIAL=主体逻辑存在但生产集成或端到端验收不完整；UI_ONLY=只有入口；MOCK=主要依赖模拟；BROKEN=不可用；NOT_IMPLEMENTED=未实现；UNVERIFIED=证据不足。
production_verified 只表示真实生产环境对该功能行为完成验证。HTTP 200 不会自动把业务功能标为生产验证完成。

## 2. 功能资产总览

| 资产类型 | 数量 |
|---|---:|
| 系统能力 | 39 |
| 互动作品 | 17 |
| Canonical route surfaces | 44 |
| 功能清单记录总量 | 100 |

其中**可计作产品能力/互动作品的记录为 56 条**（39 项系统能力 + 17 件作品）；44 条 route surfaces 单独记录，不纳入业务功能完成度。排除 route surfaces 后，状态为：COMPLETE 7, PARTIAL 10, UNVERIFIED 1。

### 实现状态

| 状态 | 数量 |
|---|---:|
| COMPLETE | 73 |
| PARTIAL | 26 |
| UNVERIFIED | 1 |

### 资产类型

| 类型 | 数量 |
|---|---:|
| interactive_work | 17 |
| route_surface | 44 |
| system_capability | 39 |
 

**业务功能与路由分开统计：** 39 项系统能力 + 17 件互动作品 = 56 条产品能力/作品记录，其中 29 COMPLETE、26 PARTIAL、1 UNVERIFIED。44 条 canonical route surfaces 另行登记，不计入业务功能完成度。

## 3. 生产访问、E2E 和 CI 证据

| 证据 | 结果 | 边界 |
|---|---|---|
| Canonical routes | 44/44 HTTP 200 | 不代表页面内操作均通过 |
| Works 页面 | 17/17 HTTP 200 | 不代表每件作品交互已验收 |
| Markdown 学习页面 | 74/74 HTTP 200 | 不代表逐段技术事实正确 |
| Reference URLs | 13/13 HEAD 200 | 可达不等于版本和引用位置正确 |
| 导航/路由 E2E | 11/11 PASS | 本地 Chromium 测试 |
| 学习流程 E2E | 31/31 PASS | 本地测试；部分服务为 isolated/mock |
| PR #11 CI | SUCCESS | run 41734045983 |
| main Pages deploy | SUCCESS | run 41732040457 |

42 条本地 E2E 覆盖桌面/移动导航、无 JS fallback、搜索跳转、44 routes 浏览器加载、Planner、任务暂停/恢复、Checkpoint、Gap 复测、Tutor consent、私有反思、候选审核门禁和七日回顾。跨设备归档与 Reviewer 测试不代表生产 Supabase 或真实 Provider 调用。

## 4. 完整功能资产清单

| ID | 产品线 | 模块 | 功能/资产 | 状态 | 生产验证 | 优先级 |
|---|---|---|---|---|---|---|
| KV-F-001 | 平台基础 | 导航与 Shell | Global navigation | COMPLETE | 否 | P3 |
| KV-F-002 | 平台基础 | 路由 | Canonical route registry | COMPLETE | 是 | P3 |
| KV-F-003 | 平台基础 | 搜索 | 全文搜索 | COMPLETE | 否 | P3 |
| KV-F-004 | 知识体系 | 专题目录 | 知识专题目录 | COMPLETE | 是 | P1 |
| KV-F-005 | 知识体系 | 课程内容 | 公开 Markdown 教学页 | COMPLETE | 是 | P2 |
| KV-F-006 | 知识体系 | 概念模型 | Concept 知识对象 | PARTIAL | 是 | P1 |
| KV-F-007 | 学习成长 | 能力模型 | Competency 与 Gap 图谱 | PARTIAL | 否 | P1 |
| KV-F-008 | 学习成长 | 知识关系 | 显式先修 DAG | PARTIAL | 否 | P1 |
| KV-F-009 | 实践体验 | Works 目录 | 三支柱作品目录 | COMPLETE | 是 | P2 |
| KV-F-010 | 技术学习 | JavaScript Promise | Promise 课程 | COMPLETE | 是 | P2 |
| KV-F-011 | 实践体验 | Promise Lab | Promise 机制调试工作台 | COMPLETE | 否 | P2 |
| KV-F-012 | 实践体验 | Promise Lab | Promise 微任务观测站 | COMPLETE | 否 | P3 |
| KV-F-013 | 实践体验 | Promise Puzzle | Promise 机制挑战 | COMPLETE | 否 | P3 |
| KV-F-014 | 技术学习 | Monorepo | TypeScript Monorepo 课程 | COMPLETE | 是 | P2 |
| KV-F-015 | 实践体验 | Monorepo Lab | Monorepo manifest 依赖图 | COMPLETE | 否 | P2 |
| KV-F-016 | 技术学习 | 工程样例 | Monorepo Fullstack 参考工程 | PARTIAL | 否 | P2 |
| KV-F-017 | 技术学习 | React Native | React Native 新架构课程 | PARTIAL | 否 | P2 |
| KV-F-018 | 实践体验 | React Native Lab | React Native Pipeline Lab | PARTIAL | 否 | P2 |
| KV-F-019 | 学习成长 | 挑战运行时 | 通用 Challenge Engine | COMPLETE | 否 | P2 |
| KV-F-020 | 学习成长 | 评估证据 | Checkpoint 测评 | COMPLETE | 否 | P2 |
| KV-F-021 | 学习成长 | 行为/掌握 | 学习事件与掌握 Reducer | PARTIAL | 否 | P1 |
| KV-F-022 | 学习成长 | 复习 | Review / 间隔复习 | COMPLETE | 否 | P2 |
| KV-F-023 | 学习成长 | 规划 | Adaptive Planner 与任务 | COMPLETE | 否 | P2 |
| KV-F-024 | 学习成长 | 复盘 | 七日回顾与私有反思 | COMPLETE | 否 | P2 |
| KV-F-025 | 后端数据 | 本地持久化 | IndexedDB 与 Offline Outbox | COMPLETE | 否 | P1 |
| KV-F-026 | 后端数据 | 身份认证 | Supabase Auth / OAuth | PARTIAL | 否 | P1 |
| KV-F-027 | 后端数据 | 访问控制 | Supabase RLS / API 安全 | COMPLETE | 是 | P2 |
| KV-F-028 | 后端数据 | 同步/档案 | 真实云端同步/多设备归档 | PARTIAL | 否 | P1 |
| KV-F-029 | AI 产品 | 教学对话 | AI Tutor | PARTIAL | 否 | P1 |
| KV-F-030 | AI 产品 | 主动规划 | AI Learning Agent | PARTIAL | 否 | P1 |
| KV-F-031 | AI 产品 | 候选题工厂 | AI 练习候选生成 | PARTIAL | 否 | P1 |
| KV-F-032 | AI 内容治理 | Review Gate | 确定性内容质量校验 | COMPLETE | 否 | P2 |
| KV-F-033 | AI 内容治理 | Reviewer | 独立 AI Reviewer | PARTIAL | 否 | P1 |
| KV-F-034 | AI 内容治理 | 审核权限 | 人工审核员授权 | PARTIAL | 否 | P1 |
| KV-F-035 | AI 内容治理 | 发布流水线 | 候选 PR 发布与正式注册 | PARTIAL | 否 | P1 |
| KV-F-036 | DevOps | 构建/发布 | GitHub CI 与 Pages 部署 | COMPLETE | 是 | P2 |
| KV-F-037 | DevOps | 凭证 | Secrets 与 Provider 配置 | PARTIAL | 否 | P1 |
| KV-F-038 | 运维 | 备份恢复 | 备份与灾备恢复 | UNVERIFIED | 否 | P2 |
| KV-F-039 | 体验质量 | 移动布局 | 响应式移动 Web | COMPLETE | 否 | P2 |
| KV-W-001 | promise | lab | Promise 机制调试工作台 · 可观测运行时 | COMPLETE | 否 | P3 |
| KV-W-002 | promise | lab | 微任务队列观测站 | COMPLETE | 否 | P3 |
| KV-W-003 | promise | lab | Promise.resolve · 同一性与采用 | PARTIAL | 否 | P3 |
| KV-W-004 | promise | lab | 微任务解析流程 · 校正动画 | PARTIAL | 否 | P3 |
| KV-W-005 | promise, creative | gallery | Promise 运行宇宙 · 叙事原型 | PARTIAL | 否 | P3 |
| KV-W-006 | promise, creative | gallery | Promise 宇宙 · WebGL 空间展览 | PARTIAL | 否 | P3 |
| KV-W-007 | promise, creative | puzzles | 第一领域 · 空间机制实验 | PARTIAL | 否 | P3 |
| KV-W-008 | promise, creative | puzzles | 约定之境 · 完整 3D 解谜 MVP | PARTIAL | 否 | P3 |
| KV-W-009 | monorepo | lab | Monorepo · 依赖图与 Affected 实验器 | COMPLETE | 否 | P3 |
| KV-W-010 | monorepo | lab | Monorepo · 缓存键完整性实验 | COMPLETE | 否 | P3 |
| KV-W-011 | monorepo | lab | Monorepo · 工作区构建顺序观测器 | COMPLETE | 否 | P3 |
| KV-W-012 | monorepo, creative | gallery | 依赖星系 · Monorepo 3D 架构展厅 | PARTIAL | 否 | P3 |
| KV-W-013 | monorepo, creative | puzzles | 依赖星门 · Monorepo 3D 解谜世界 | COMPLETE | 否 | P3 |
| KV-W-014 | promise, creative | puzzles | 时序裂隙 · Promise 机制挑战世界 | COMPLETE | 否 | P3 |
| KV-W-015 | react-native | lab | Fabric 渲染管线观测器 · Render / Commit / Mount | PARTIAL | 否 | P2 |
| KV-W-016 | react-native | gallery | 新架构空间全景 · Build / Startup / Runtime 3D 展厅 | PARTIAL | 否 | P2 |
| KV-W-017 | react-native | puzzles | 架构边界挑战 · React Native New Architecture Quest | PARTIAL | 否 | P2 |
| KV-R-001 | 平台/学习成长 | home | 首页 | COMPLETE | 是 | P3 |
| KV-R-002 | 平台/学习成长 | knowledge-index | 全部知识领域 | COMPLETE | 是 | P3 |
| KV-R-003 | 平台/学习成长 | sources | 来源与参考 | COMPLETE | 是 | P3 |
| KV-R-004 | 实践体验 | works-index | 全部实践体验 | COMPLETE | 是 | P3 |
| KV-R-005 | 实践体验 | experience-index | 01 · 原理实验室 | COMPLETE | 是 | P3 |
| KV-R-006 | 实践体验 | experience-index | 02 · 沉浸式知识展厅 | COMPLETE | 是 | P3 |
| KV-R-007 | 实践体验 | experience-index | 03 · 知识解谜世界 | COMPLETE | 是 | P3 |
| KV-R-008 | 平台/学习成长 | learning-start | 开始学习 | COMPLETE | 是 | P3 |
| KV-R-009 | 平台/学习成长 | progress | 学习成长总览 | COMPLETE | 是 | P3 |
| KV-R-010 | 平台/学习成长 | learning-agent | 个人智能学习 Agent | COMPLETE | 是 | P3 |
| KV-R-011 | 平台/学习成长 | learning-plan | 今日学习计划 | COMPLETE | 是 | P3 |
| KV-R-012 | 平台/学习成长 | mastery-graph | 知识掌握图谱 | COMPLETE | 是 | P3 |
| KV-R-013 | 平台/学习成长 | gap-diagnosis | 薄弱点诊断 | COMPLETE | 是 | P3 |
| KV-R-014 | 平台/学习成长 | review | 独立复习工作台 | COMPLETE | 是 | P3 |
| KV-R-015 | 平台/学习成长 | learning-history | 学习历史 | COMPLETE | 是 | P3 |
| KV-R-016 | 平台/学习成长 | account-archive | 个人学习档案 | COMPLETE | 是 | P3 |
| KV-R-017 | 知识体系 | topic | JavaScript · Promise | COMPLETE | 是 | P3 |
| KV-R-018 | 知识体系 | topic | TypeScript · Monorepo | COMPLETE | 是 | P3 |
| KV-R-019 | 知识体系 | topic | React Native · 新架构 | COMPLETE | 是 | P3 |
| KV-R-020 | 知识体系 | topic | AI · 多模态教育 | COMPLETE | 是 | P3 |
| KV-R-021 | 知识体系 | topic | AI Agent · 系统工程 | COMPLETE | 是 | P3 |
| KV-R-022 | 知识体系 | topic | 模型 · 算力与工具 | COMPLETE | 是 | P3 |
| KV-R-023 | 知识体系 | topic | 数据库 · 进化与内核 | COMPLETE | 是 | P3 |
| KV-R-024 | 知识体系 | topic | 金融学 · 案例与量化 | COMPLETE | 是 | P3 |
| KV-R-025 | 知识体系 | topic | WebGL · 知识交互 | COMPLETE | 是 | P3 |
| KV-R-026 | 知识体系 | topic | 数学 · 离散与线代 | COMPLETE | 是 | P3 |
| KV-R-027 | 知识体系 | topic | 语言 · 英语与东北话 | COMPLETE | 是 | P3 |
| KV-R-028 | 知识体系 | topic | 工程治理 · 开发工作流 | COMPLETE | 是 | P3 |
| KV-R-029 | 知识体系 | concept | Promise 状态机与解决权 | COMPLETE | 是 | P3 |
| KV-R-030 | 知识体系 | concept | thenable 解析与 Promise 采用 | COMPLETE | 是 | P3 |
| KV-R-031 | 知识体系 | concept | 微任务 FIFO 与嵌套入队 | COMPLETE | 是 | P3 |
| KV-R-032 | 知识体系 | concept | 链式传播与错误恢复 | COMPLETE | 是 | P3 |
| KV-R-033 | 知识体系 | concept | 组合 API 的真实边界 | COMPLETE | 是 | P3 |
| KV-R-034 | 知识体系 | concept | 综合执行时序推演 | COMPLETE | 是 | P3 |
| KV-R-035 | 知识体系 | concept | 工作区依赖声明 | COMPLETE | 是 | P3 |
| KV-R-036 | 知识体系 | concept | 依赖图与构建拓扑 | COMPLETE | 是 | P3 |
| KV-R-037 | 知识体系 | concept | Affected 反向依赖闭包 | COMPLETE | 是 | P3 |
| KV-R-038 | 知识体系 | concept | 构建缓存键完整性 | COMPLETE | 是 | P3 |
| KV-R-039 | 知识体系 | concept | 构建产物与启动边界 | COMPLETE | 是 | P3 |
| KV-R-040 | 知识体系 | concept | JSI 与跨语言运行时边界 | COMPLETE | 是 | P3 |
| KV-R-041 | 知识体系 | concept | TurboModules 与 Codegen 契约 | COMPLETE | 是 | P3 |
| KV-R-042 | 知识体系 | concept | Fabric 渲染管线 | COMPLETE | 是 | P3 |
| KV-R-043 | 知识体系 | concept | 线程模型与事件优先级 | COMPLETE | 是 | P3 |
| KV-R-044 | 知识体系 | concept | 新架构综合运行模型 | COMPLETE | 是 | P3 |

完整 runtime_status、backend/data dependency、权限、automation_test、证据、依赖、问题及建议见 feature-inventory.json。

## 5. 功能评分（0–5）

| 维度 | 评分 | 证据依据 |
|---|---:|---|
| 功能实现完整度 | 3.5 | 导航、核心课程和学习引擎已实现；AI/生产同步/内容发布和九专题图谱仍未完整。 |
| 真实运行可靠性 | 4.0 | 44 routes、74 教学页、17 作品生产可访问，42 个 E2E 通过；生产后端写入和 AI 调用未验收。 |
| 后端能力完整性 | 3.0 | 12 migrations、RLS、RPC 和两个 Edge Functions 已部署；真实双设备与 Provider 未验证。 |
| 数据持久化和安全性 | 3.5 | IndexedDB/Outbox 与 RLS 设计测试较完整；生产事件为 0、Auth WARN、备份恢复未验证。 |
| 用户操作闭环 | 3.5 | 本地 E2E 覆盖学习—评估—Gap—复习—计划；生产数据和 AI 发布链路没有完整证据。 |
| 自动化测试覆盖 | 4.5 | CI、validators 和 Chromium/WebKit E2E 覆盖广；真实 Provider、生产双设备和实体 iPhone 未覆盖。 |
| 产品体验一致性 | 4.0 | 统一导航、三个体验支柱和移动视口通过；17 件作品未逐件完成全部交互验收。 |
| 模块协作能力 | 3.5 | 三专题的知识、作品、评估关联有效；九专题未接入相同学习模型。 |
| 文档和维护能力 | 3.5 | 51 份工程文档、Registry 契约和 CI 存在；README route count/Phase M 状态过时。 |
| 产品价值和差异化 | 4.0 | 证据驱动掌握、Gap 复习、可解释规划和 Promise 原理实验有差异化；生产闭环仍待证。 |

评分为基于当前证据的产品审核判断，不是代码完成百分比，也不表示所有生产集成都已经验收。

## 6. P0–P3 问题汇总

| ID | 级别 | 问题 | 审核方向 |
|---|---|---|---|
| AUD-P1-001 | P1 | Production DB applied an authorization migration from still-open PR #11 | release-integrity |
| AUD-P1-002 | P1 | No production candidate/audit records; repository-level Actions secrets are empty | ai-content-publishing |
| AUD-P1-003 | P1 | Real Supabase cross-device learning sync has not passed production E2E | backend-data |
| AUD-P1-004 | P1 | Real model Provider execution for Tutor, Agent and Reviewer is unverified | ai-runtime |
| AUD-P1-005 | P1 | Nine of twelve knowledge topics lack a formal Concept/Competency/Assessment map | content-coverage |
| AUD-P2-006 | P2 | All 72 formal Review Assessments lack difficulty metadata | assessment-quality |
| AUD-P2-007 | P2 | Thirteen official references cover only three mapped topics | references |
| AUD-P2-008 | P2 | README route count and Phase M status are stale | documentation |
| AUD-P2-009 | P2 | Supabase Auth leaked-password protection is disabled | security |
| AUD-P2-010 | P2 | Full semantic fact-check and teaching-quality review is not complete | content-quality |
| AUD-P2-011 | P2 | Backup, restore and disaster-recovery drill have no evidence in this audit | operations |
| AUD-P2-012 | P2 | Mobile acceptance uses WebKit emulation rather than physical iPhone Safari | device-acceptance |
| AUD-P3-013 | P3 | Production sitemap.xml returns 404 | site-discovery |
| AUD-P3-014 | P3 | Supabase Advisor reports two unused indexes | database-performance |

本次没有确认 P0。主要 P1 风险集中在 PR/生产数据库状态分叉、AI/内容发布链路无生产记录、真实跨设备同步未验收和九个专题缺少学习能力图谱。

## 7. 后端和工程实际状态

- Supabase 项目 ACTIVE_HEALTHY，Postgres 17.11；迁移账本 12 条。
- 最新迁移 20261103224708_phase_m_authorize_initial_content_admin 已在生产应用，但所在 PR #11 仍 OPEN/未合并。
- public rows：profiles 1、user_devices 1、user_sync_state 1、user_document_sync_state 1、learning_events 0、learning_archive_documents 3、practice_candidate_quality_records 0。
- private.authorized_users 1 行、private.practice_content_reviewers 1 行。
- Edge Functions：learning-agent ACTIVE v9、practice-quality-review ACTIVE v3，verify_jwt=true。
- 仓库级 GitHub Actions Secrets/Variables 清单为空；Supabase Provider secret 状态不可读取。
- Security Advisor：leaked password protection WARN；private reviewer/allowlist 表 RLS 无 policy 为 INFO。
- Performance Advisor：两个 unused indexes INFO；事件表目前 0 行，不应据此直接删索引。

## 8. 下一步优先顺序

1. 对齐 PR #11 与生产迁移账本。
2. 使用 staging 真实 Provider 验收 Tutor/Agent/Reviewer。
3. 使用 staging 双设备验收 OAuth、RLS、事件、Outbox 和文档 CAS。
4. 为重点专题补齐 Concept/Competency/Assessment 图谱。
5. 逐件验收作品交互并逐题审校内容。

完整功能字段和证据请查看 feature-inventory.json；问题与验收标准见 audit-issues.json。
