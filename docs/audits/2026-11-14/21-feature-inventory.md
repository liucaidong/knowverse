# KNOWVERSE 4.1 — 全站功能与内容盘点

- 审计日期：2026-11-14
- 本清单按真实注册路由、页面入口、业务模块、数据服务与自动化测试追踪；不是按页面标题推断完成度。
- 规范路由：47；业务能力条目：22。
- 专题：12；正式 Concept：19；Competency：18；Gap：34；Review Assessment：78；Checkpoint：14；Challenge：3；作品：17；来源：17。

## 1. 全站入口与知识结构

一级工作区：开始学习、知识库、实践中心、我的进度。二级入口由 `content/navigation.json` 的 `children` 与 `content/routes.json` 统一注册。

| 工作区 | 入口路由 | 核心业务 | 状态 |
|---|---|---|---|
| 开始学习 | `learning.start` / `learning.agent` | 引导学习、Agent、今日计划 | 可用；真实 Provider 需独立核验 |
| 知识库 | `knowledge.overview` | 12 个专题、Concept、来源 | 可用；只有 4/12 专题具备正式能力图 |
| 实践中心 | `experience.lab` / `experience.gallery` / `experience.puzzles` | 原理实验、3D 场景、挑战 | 可用；逐场景运行时真实性仍需审计 |
| 我的进度 | `learning.overview` / `learning.review` | 掌握图谱、Gap、复习、历史、档案 | 部分可用；需核对真实数据持久化与因果链 |

## 2. 功能能力清单

| 功能 | 页面 / 路由 | 核心实现 | 数据来源 / 状态管理 | 当前判断 |
|---|---|---|---|---|
| 全局导航与首页 | `home` | `index.html, site-shell.mjs, build-site-shell.mjs` | 静态注册表 + 页面 Shell | 已实现；导航与路由静态回归覆盖 |
| 登录与账户状态 | `account.archive` | `auth.mjs, config.mjs, index.html` | Supabase session + 本地会话状态 | 部分可用；生产数据表已核实，真实登录/账户权限端到端待验 |
| 知识专题目录与课程 | `knowledge.overview` | `knowledge.json, learning-map.json, index.html` | 构建期注册表 + 静态页面 | 已实现；12 专题/47 路由/19 Concept/18 Competency 架构检查通过 |
| 原理实验室入口 | `experience.lab` | `index.html, works.json` | 静态页面 + 作品注册表 | 已实现；入口路由通过 |
| Promise 调试工作台 | `topic.promise` | `index.html, debugger.js, promise-*.js` | 页面运行时模型 + 可视化事件状态 | 已实现；13 场景/原生差分/解析与 FIFO 单测通过 |
| Promise 课程与独立挑战 | `topic.promise` | `**, promise-quest.mjs, challenges.json` | 静态课程 + 挑战引擎 + 本地学习证据 | 已实现；20 课与 5 阶段挑战验证通过 |
| 沉浸式知识展厅 | `experience.gallery` | `index.html, **, monorepo-world.js` | WebGL/DOM 场景运行时 + 页面可见性状态 | 已实现；场景可见性暂停/恢复回归通过 |
| 知识解谜世界 | `experience.puzzles` | `index.html, **, challenge-engine.mjs` | 挑战状态 + IndexedDB 证据 | 已实现；挑战引擎与多个专题挑战通过 |
| 学习成长总览 | `learning.overview` | `index.html, learning-progress*.mjs, learning-event-schema.mjs` | 本地事件日志 + 版本化 reducer + 派生视图 | 已实现；证据/掌握图谱/Gap 单测与浏览器用例覆盖 |
| 知识掌握图谱 | `learning.mastery` | `learning-progress.mjs, learning-risk-engine.mjs, learning-map.json` | 事件派生状态；非直接写入掌握分数 | 部分可用；仅正式映射的 4 个专题可进行能力级推断 |
| 薄弱点识别 | `learning.gaps` | `learning-progress.mjs, learning-risk-engine.mjs, learning-map.json` | 因果事件图 + reducer 派生 | 部分可用；已覆盖 Gap 创建/定向练习/解决流程 |
| 复习工作台 | `learning.review` | `index.html, review-engine.mjs, review-workspace.mjs` | 复习 session + 独立变体 + 学习事件 | 已实现；独立变体、错题 Gap、解决状态与刷新恢复测试通过 |
| 延迟复习与每周回顾 | `learning.today` | `spaced-repetition-engine.mjs, learning-weekly-review.mjs, proactive-learning-engine.mjs` | 事件派生排程 + 文档投影 | 部分可用；延迟排程和七日证据回顾有测试 |
| 个性化学习计划 | `learning.today` | `learning-planner.mjs, plan-manager.mjs, proactive-learning-engine.mjs` | 本地 reducer + 版本化计划文档 + 事件 | 已实现；目标→计划→任务→刷新恢复有浏览器测试 |
| 个人智能学习 Agent | `learning.agent` | `index.html, **, index.ts` | 本地规则 Agent + 受限云端 Provider + 会话文档 | 部分可用；规则模式与同意边界通过测试，真实 Provider 生产调用未验证 |
| AI Tutor | `learning.agent` | `learning-tutor.mjs, agent-provider.mjs, index.ts` | 单轮授权 Provider 请求；不直接写掌握证据 | 部分可用；本地同意与上下文隔离测试通过；真实模型调用未验 |
| AI Reviewer / 练习候选质量审核 | `learning.gaps` | `learning-practice-candidates.mjs, learning-practice-quality-review.mjs, index.ts` | 候选私有文档 + 服务端校验 + 独立 Reviewer + 人工审批 | 部分可用；确定性校验/权限边界测试通过，真实独立 Reviewer Provider 未验证 |
| 学习档案与云端事件同步 | `account.archive` | `archive-bootstrap.mjs, learning-repository.mjs, local-archive.mjs` | 本地优先 Outbox + 事件/文档同步 + CAS | 部分可用；单元/隔离 PostgreSQL/过往 staging 测试通过；生产真实账户完整同步待验 |
| 搜索、来源与知识关系 | `knowledge.sources` | `v2.js, site-shell.mjs, search-metadata.json` | 构建期搜索索引 + 静态关系注册表 | 已实现；118 搜索记录与 canonical Concept 跳转校验通过 |
| 学习反思与隐私笔记 | `account.archive` | `learning-reflections.mjs, learning-repository.mjs` | 本地 IndexedDB + 云端版本化文档 | 已实现；反思不会被当成掌握证据的测试通过 |
| 学习内容与来源溯源 | `knowledge.sources` | `sources.json, works.json, knowledge.json` | 构建期 provenance 页面 | 已实现；17 来源记录与公开页面构建通过 |
| 构建与发布管线 | `home` | `pages.yml, build-public-content.mjs, build-knowledge-context.py` | 静态可复现构建与 Pages 部署 | 已实现；本地构建链可运行，生产部署 commit 仍需 WP5 验证 |

## 3. 盘点结论

- 页面入口并非孤立：学习地图、作品注册表、路由注册表与来源登记已形成构建期连接。
- 核心学习数据分为两类：`learning_events` 追加式事实，以及 `learning_archive_documents` 版本化状态文档；掌握度 / Gap / 计划应由事件与注册图派生，不能以 UI 显示作为持久化证明。
- 正式能力图只覆盖 Promise、Monorepo、React Native、AI Agent 四个专题；其余八个专题仍是内容学习入口，不应显示未经证据支持的能力掌握结果。
- AI Tutor / Learning Agent 与 AI Reviewer 的本地规则模式、确定性校验和真实模型 Provider 必须分开验收。
- 完整逐功能文件、依赖、数据源、状态管理、测试覆盖与风险见 `22-feature-audit.json`。

## 4. 需要深审的薄弱处

1. 事件 payload 的 eventType / topicId / competencyIds / causationEventIds 是否全链路正确。
2. Review 的失败、重复提交、重试、页面刷新与独立变体是否保持幂等。
3. Gap 到计划任务、复习 session、再次挑战和掌握度更新是否能通过 ID 追溯。
4. Promise 工作台动画是否由真实运行时执行结果驱动，而非单独的演示状态。
5. Gallery 每个 WebGL 场景的初始化、切换、异常退出、隐藏页暂停和移动端降级。
6. 生产 Edge Function 的真实 Provider secrets / 模型调用状态。
7. 生产事件中 `unclassified` topic 的生成原因与是否影响学习计划。
