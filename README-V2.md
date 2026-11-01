# KNOWVERSE V2 · 知域知识宇宙

- GitHub Pages：`https://liucaidong.github.io/knowverse/`
- 版本：V2 / Learning Intelligence 2.0 / 2026-11-01
- **12 个知识专题、92 条可检索内容记录、22 张 Mermaid 全景图、14 件已上线互动作品。**
- `content/knowledge.json` 是知识专题注册表；`content/works.json` 是三条产品主线与作品注册表；作品通过 `knowledge_ids` 关联专题。
- 首页精选专题、知识目录、三条主线作品卡片和专题页的关联体验由共享注册表驱动。

## 内容架构

- `content/knowledge.json`：稳定专题 ID、标题、分类、摘要、路由和精选信息。
- `content/works.json`：产品主线与互动作品；关系只在作品记录中声明，前端自动生成专题到作品的反向链接。
- `content/search-metadata.json`：搜索标题、摘要、标签等人工策划字段。
- `data/search.json`：从 Markdown 正文或 HTML 正文构建的全文搜索索引。
- `scripts/build-search-index.py`：确定性搜索索引生成器；内容验证与 Pages 部署都会执行。
- `assets/js/knowledge-graph.js`：从注册表生成首页专题/主线卡片，并在专题页显示相关互动体验。
- `data/monorepo-graph.json`：从真实五包全栈参考工程的 package.json 自动生成依赖图与构建层。
- `assets/js/monorepo-world.js`：同一套 WebGL 3D 场景渲染器，为 Monorepo 展厅与解谜世界复用。
- `assets/js/monorepo-graph-model.mjs`：统一计算反向依赖闭包、可构建节点和构建约束。

## 目录

- `knowledge/{topic}/index.html`：专题首页，包含全景图与相关互动体验入口
- `knowledge/{topic}/{article}/index.md`：Markdown 文章源
- `assets/panoramas/*.mmd`：可编辑 Mermaid 源文件
- `assets/panoramas/*.svg`：离线可见的静态矢量备份
- `works/index.html`：全部互动作品总览，支持主线筛选、关键词搜索和关联专题跳转
- `lab/experiments/promise-debugger/`：Promise 运行时观测工作台

## Monorepo 三主线体验

TypeScript Monorepo 不再只是课程页：原理实验室提供依赖图、缓存键和构建层实验；沉浸展厅用 WebGL 展示由真实 package.json 生成的五包依赖星系；知识解谜世界验证 workspace 协议、拓扑构建顺序和 Affected 反向依赖闭包。三个产品面共享同一份 `data/monorepo-graph.json`。

## Promise 调试工作台

工作台使用独立的 `TraceRuntime` 执行可编辑 JavaScript 代码，并为每个状态转移和调度动作生成快照。内置 13 组机制实验，覆盖 thenable 解析、Promise 采用与身份、reaction 链、catch / finally、all / race / any / allSettled、自我解决和空输入边界。

**边界说明：** 这是一个具有可观测内部状态的教学/调试运行时，不是 V8 或 JavaScriptCore 的内部调试接口。浏览器原生 Promise 的私有 reaction 队列不会被直接暴露。

## 工程原则

1. 静态 JSON 是内容注册表，不引入不必要的后台服务。
2. 作品与专题关系只维护一份，反向关系在呈现层推导。
3. 搜索正文从真实 Markdown/HTML 页面生成，不重复手工维护。
4. Mermaid 是可编辑图的源格式；SVG 是加载失败时的可用备份。
5. 所有本地路由、关系引用和搜索入口由 GitHub Actions 检查。
6. 不发布聊天私人内容或凭证，也不把推断当作逐字历史记录。

## 内容来源

可恢复的历史对话摘要、既有专题笔记及 KNOWVERSE 作品。来源与覆盖边界见 `provenance/`。


## Learning Intelligence 2.0 · 知识掌握与独立复习闭环

- 学习驾驶舱：`/progress/`；针对性复习工作台：`/review/`。
- 统一事件 V2：兼容旧 V1 学习档案，记录挑战、复习会话与三条产品线探索活动。
- 掌握度与置信度分开计算；未验证节点不记 0 分。
- gap 精准生命周期：普通成功不清除误区，提示辅助通过需等待不同题型的无提示独立验证。
- 首批 9 个能力点、19 个薄弱点、40 个精确复习变体，覆盖 Promise 与 TypeScript Monorepo。
- `assets/js/review-engine.mjs`：隔离复习会话，不重置或覆盖原始挑战。
- `assets/js/learning-activity.mjs`：本地记录实验室、展厅、解谜世界的探索活动；探索行为不会被当作掌握证据。
- `docs/learning-progress-system.md`：V2 数据模型、迁移、复习策略、隐私和验收说明。

学习记录保存在当前浏览器 LocalStorage，不会提交到公开仓库；GitHub Pages 不提供账户或云同步，跨设备请使用 JSON 导出 / 导入。浏览器存储受站点配额限制，建议定期备份。


## 统一作品学习接入

- `content/works.json` 为 14 件作品声明活动采集、能力点关系和评估入口。
- `assets/js/learning-integration.mjs` 按当前作品路由加载同一套集成。
- `content/learning-checkpoints.json` 为 12 件非挑战作品提供无提示、可判定的检查点；两件结构化解谜挑战继续由 Challenge Engine 提供评估证据。
- `assets/js/learning-checkpoint-engine.mjs` 只将正确检查点写为掌握证据；错误答案可产生薄弱点，但检查点不能自行清除 gap，必须走独立 Review。
- Monorepo 新增“构建缓存键完整性”能力点，配有两个薄弱点和四个定向复习变体。
- CI 检查作品、知识能力、挑战、检查点和页面入口之间的完整关系。


## 主动学习规划引擎 · Adaptive Learning Planner

- 学习驾驶舱的“今天应该学什么”由 `assets/js/learning-planner.mjs` 实时生成。
- 规划输入：掌握度与置信度、gap 生命周期、复习到期时间、完整前置知识链、作品与挑战注册表、检查点变体使用记录。
- 决策顺序：未解决误区 → 到期复习 → 薄弱能力练习 → 独立变体验证 → 可解锁的基础课程。
- 前置门控递归检查所有祖先能力：任一前置节点尚未初步掌握或仍有活跃 gap，下游课程暂缓推荐。
- 每日可用时间支持 15 / 25 / 40 / 60 分钟；计划最多三步，并将当天已完成步骤耗时累计计入预算。
- 计划行动支持开始与完成反馈；`plan_action_started` / `plan_action_completed` 是规划过程事件，不会增加 mastery evidence。
- 课程学习步骤的完成状态会跨天保留，但不能代替挑战、检查点或独立复习的掌握证据。
- 规划偏好独立保存在 LocalStorage；计划执行事件进入现有学习档案，随 JSON 导出 / 导入。
- 规划引擎采用本地确定性规则与可解释优先级，不调用在线 LLM、不上传个人学习档案，也不自动写入虚假掌握分。
- `scripts/verify-learning-planner.mjs` 覆盖前置门控、时间预算、薄弱点优先级、间隔复习、计划反馈和证据隔离；Playwright 桌面 / 移动端验证真实页面。


## KNOWVERSE 3.0 · Personal Learning Platform

- 产品边界保持三条体验主线：原理实验室、沉浸式知识展厅、知识解谜世界；学习驾驶舱、复习工作台和主动规划属于横向 Learning Intelligence。
- `docs/product-architecture-v3.md`：产品定位、目标架构、实施阶段和验收标准。
- `docs/backend/implementation.md`：Supabase 项目、GitHub OAuth、个人账户白名单、IndexedDB Outbox 和云端同步激活手册。
- `supabase/migrations/`：个人学习档案 PostgreSQL Schema、RLS、白名单和 Push / Pull RPC。
- `assets/js/backend/`：PKCE Auth、IndexedDB 事件镜像、Outbox 与同步客户端。
- 云端默认关闭；配置 `assets/js/backend/public-config.js` 的 Supabase URL 与 Publishable Key 后，按后端手册创建 OAuth 应用并加入个人账户白名单。
- 当前挑战与复习引擎仍保留 LocalStorage 同步 API；IndexedDB 已作为事件镜像与 Outbox 使用。进行中的挑战 / 复习快照迁移和跨设备因果冲突处理属于后续阶段，不能误认为已经完成。


## React Native · New Architecture learning domain

The third complete knowledge domain is connected to all three learning pillars.

- Topic and learning map: 6 competencies, 12 diagnosed gaps, and 32 competency-targeted review variants.
- Lab: Fabric Render / Commit / Mount pipeline observatory.
- Gallery: interactive CSS 3D Build / Startup / Runtime architecture space.
- Puzzle: six-step architecture boundary challenge using the shared Challenge Engine.
- Implementation and official reference map: docs/react-native-learning-domain.md.
