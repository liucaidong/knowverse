# KNOWVERSE 学习智能系统 3.1

版本：3.1.0 · 2026-11-02

## 产品目标

将 KNOWVERSE 从“挑战记录面板”升级为持续工作的个人学习闭环：

**知识掌握图谱 → 学习证据 → 薄弱点诊断 → 个性化复习 → 独立验证 → 成长档案。**

系统不以页面浏览、点击次数或完成关卡数量代表掌握程度。只有明确映射到知识能力点的挑战评估通过，才进入掌握度证据；课程阅读、原理实验室操作和展厅探索仅作为学习活动保留。

## 产品入口

- 学习驾驶舱：`/progress/`
- 独立复习工作台：`/review/`
- 掌握图谱：`content/learning-map.json`
- 复习变体注册表：`content/review-assessments.json`
- 统一学习事件与分析：`assets/js/learning-progress.mjs`
- 独立复习会话引擎：`assets/js/review-engine.mjs`
- 三条产品线活动采集：`assets/js/learning-activity.mjs`

## 数据与事件模型

学习事件使用 Event Schema V3。公共字段：

- `id`：幂等事件标识。
- `eventSchemaVersion`：事件结构版本。
- `at`：ISO 时间。
- `topicId / challengeId / stepId`：来源定位。
- `competencyIds`：与知识能力点的显式关系。
- `sessionId / sessionType / variantId`：区分挑战轮次、独立复习与题目变体。
- gapId：可选的精确概念误区 ID。
- gapObservationId：一次错误观察的稳定 ID；错误 attempt 默认使用自身 event ID。
- targetGapEventIds：复习会话明确针对的错误事件 ID 集合。
- causationEventIds：事件显式因果前序，最多 20 项。
- scorePct / attempts / hintsUsed：可解释的验证质量字段。

V3 不再通过客户端墙上时钟或合并后的事件数组顺序推断因果。旧 V2 事件进入 V3 envelope 时保留 event ID，并使用空因果引用；不能证明的历史因果关系不会补造。

已支持事件类型：

| 事件 | 含义 | 是否进入掌握度证据 |
|---|---|---|
| `attempt` | 提交一次挑战答案 | 否；可产生 gap 诊断 |
| `hint` / `hint_revealed` | 展开提示 | 否；用于独立性评估 |
| `completed` | 原挑战知识点关卡通过 | 是 |
| `review_started` | 开始独立复习 | 否 |
| `assessment_passed` | 独立复习题验证通过 | 是 |
| `activity` | 原理实验室、展厅或页面交互 | 否 |

**学习活动和掌握证据明确分离。** 探索三维场景、运行实验或打开课程不会直接让知识点涨分。当前 17 件作品关联到 12 个知识专题、15 个 competency；14 个 checkpoint 与 3 个结构化 challenge 入口负责产生可验证证据。

## 本机学习日志与云端归档（Phase D）

Phase D 使用两层数据库：IndexedDB v4 是当前设备完整学习数据库，Supabase PostgreSQL 是已同步数据的云端权威存储。领域引擎通过 assets/js/backend/learning-repository.mjs 统一读写；业务模块不直接操作浏览器 Storage API 或云端 REST。

本地数据库包含 learningEvents（完整追加式事件日志）、learningDocuments（挑战现场、活动复习现场和规划偏好）、outbox（待服务端确认的本机事件）、syncMetadata 与 devices（账户绑定、设备 ID、游标、同步状态与 lease），以及 conflicts 和 migrationMetadata。

一次学习动作产生的事件、状态文档和 Outbox 在同一个 IndexedDB transaction 内提交。文档使用 localRevision 乐观锁；多标签页过期写入会失败，不会静默覆盖。事件历史按索引游标读取，不做固定条数截断。相同时间戳下按服务端序列、设备 ID 与设备序列稳定排序。

云端正常同步由 sync_commit_learning_batch 在一个 PostgreSQL 事务里提交事件和文档；文档 CAS 冲突使整批回滚。只有服务端确认后才清理 Outbox。显式「从云端恢复」保持 pull-only，不会先上传本机未同步内容。冲突保留 local / remote 两份版本，必须由用户明确选择。

本机数据库绑定单一账户。Repository 在每次业务读写时检查当前 Supabase 会话和本机绑定账户；切换到账户 B 时不会读取或覆盖账户 A 的本机学习数据。建议不同账户使用不同浏览器 Profile。认证会话和 PKCE 始终独立于学习数据迁移。

Phase C 的旧 LocalStorage envelope 只通过一次性迁移器读取：验证 allowlist、SHA-256 指纹、原子导入、回读核验和迁移标记后，才清理旧学习键。Promise Realm 的独立存档也纳入迁移；Auth / PKCE 键不会被清理。详见 docs/backend/phase-d-migration.md。

重要数据仍应及时同步到云端并导出备份；浏览器可能受站点配额和用户清理影响。详细数据模型见 docs/backend/phase-d-local-database.md 与 phase-d-supabase-data-model.md。

## 掌握度和置信度

掌握度（Mastery）与置信度（Confidence）是两个独立指标：

- **掌握度**：最近最多 6 次有效完成 / 复习证据的时间加权表现，采用近期性与时间衰减。
- **置信度**：证据数量、跨日期分布、验证变体多样性与无提示比例的透明组合值。它表示当前结论有多少独立证据支持，不是统计学置信区间。

知识状态：

1. 待验证：尚无成功评估证据；不等于 0 分。
2. 需要补强：有未解决 gap，或最近表现低于阈值。
3. 正在建立：已有一定成功证据，但未达到初步掌握门槛。
4. 初步掌握：掌握度达到初步阈值，但独立证据仍不足。
5. 稳定掌握：至少两次独立验证、跨两个日期、至少两种变体、最近两次无提示、掌握度不低于 85 且最新表现不低于 80，并且没有未解决的 gap。

任何新的关键错误都会使相关知识点回到“需要补强”，不允许稳定掌握与关键未解决 gap 并存。所有阈值属于可解释产品策略，可版本化调整，不宣称是科学测量。

## 薄弱点生命周期

每一个错误通过稳定的 `gapId` 追踪，生命周期：

**发现 → 待复习 → 复习中 → 已纠正 / 待独立确认 → 已独立纠正。**

重要规则：

- 同一 competency 的任意后续成功不会清除 gap。
- 必须进入 Review Session，并对同一个 `gapId` 作针对性验证。
- 提示辅助通过会进入“已纠正 · 待独立确认”，仍在复习队列内。
- 同一题目变体重复答对不算独立验证。
- 需要不同变体、无提示的验证通过，才能解除对应 gap。
- 后续再次答错会重新打开该 gap，重新安排优先复习。

**Gap 生命周期由显式事件因果决定，不依赖事件到达顺序或客户端时间戳。** 针对性 Review 开始时冻结当前未解决错误的 event ID；后续 attempt / assessment_passed 必须引用该 Review Session 的 started 与正确 attempt。下一轮 Review 会把上轮 review attempt 作为因果前序，重复同变体不能成为独立验证。多设备离线并发产生同变体结果时，因为缺乏先后因果，也不会错误地当成两种独立证据。

## 独立 Review Session

`review/index.html` 是与原始 Challenge Campaign 隔离的复习工作台：

- 可从知识点或具体 gap 打开。
- 使用 `content/review-assessments.json` 的题型变体，不重置或覆盖原挑战。
- 当前覆盖 Promise、Monorepo、React Native 三个正式能力图谱，共 15 个 competency、31 个 gap 和 72 个针对性复习变体。
- 同一 competency 的两种变体均映射其可诊断 gap，使定向复习可以真正切换题型。
- 每次复习保存 sessionId、sessionType、variantId、答案、尝试、提示和结果。
- 复习通过、失败、提示和会话开始都进入统一事件历史。

## 个性化复习调度

复习队列综合考虑：

- 未解决 gap 的严重程度与重复次数；
- 是否提示辅助通过、是否等待独立确认；
- 知识掌握度及近期表现；
- 距离上次验证的时间；
- 该知识点被多少下游能力点依赖。

队列分为薄弱点优先和周期复习。没有完成证据但存在错误 gap 的节点也会进入队列。每项计划都有可解释的优先级输入，并可直接打开对应 review session。

## 三条产品线接入策略

| 产品线 | 记录内容 | 掌握度规则 |
|---|---|---|
| 原理实验室 | 访问与交互活动；对应实验提供知识检查点 | 普通运行不计掌握；无提示 checkpoint 通过才形成证据 |
| 沉浸式知识展厅 | 访问与场景交互；关联检查点 | 空间探索不计掌握；通过检查点才形成证据 |
| 知识解谜世界 | 活动记录、结构化 Challenge 或独立 3D 作品检查点 | 只有映射 competency 的挑战 / 检查点通过形成 mastery evidence |

活动记录不采集用户输入的代码、文本内容或表单内容。

## 验证策略

CI 包含：

- 当前事件 schema 校验、事件去重和完整历史保留测试；
- gap 精准匹配、提示辅助、不同变体与独立验证状态测试；
- mastery / confidence、状态升级和降级、gap-only review queue 测试；
- 15 个 competency、31 个 gap、72 个 review variant 的注册表和因果闭环校验；
- 乱序合并、V2→V3 envelope 规范化、同 ID 篡改拒绝、并发同变体不计独立验证；
- Playwright Chromium 桌面端和 WebKit 手机视口的浏览器端闭环测试；
- 原有 Promise、Monorepo、内容路由、搜索索引及作品工程回归。

WebKit 手机视口属于浏览器引擎的自动化视口测试，不等同于对真实 iPhone Safari 设备的人工验收。

## 数据安全与非目标

- 云端身份由 Supabase Auth GitHub OAuth 提供，写入由白名单、RLS 与受控 RPC 保护。
- 不把个人学习事件写入仓库静态 JSON。
- 不生成没有验证题的虚假掌握分。
- 不把三个产品主线重写为一个大型应用；采用统一事件协议与轻量采集模块。
- 当前学习事件与可恢复现场均以 IndexedDB v4 为本机权威，事件 + 文档 + Outbox 原子提交；云端 Push 使用单一 PostgreSQL 批次 RPC，Restore 为 pull-only，账户切换由 Repository 拒绝。实体 Mac / iPhone Safari 与真实双账户 JWT RLS 仍需人工验收。


## 统一作品学习接入（2026-11-01）

### 单一作品契约

`content/works.json` 是每件作品的唯一学习接入入口。每个 live work 必须声明 `activityTracking: true`、`competencyIds`，以及 `assessment.type`（`challenge` 或 `checkpoint`）和对应的入口 ID。页面只加载 `assets/js/learning-integration.mjs`；集成层根据当前路由匹配 work 注册表，统一加载活动采集与检查点。

### 事件来源与证据等级

| 来源 | 事件 | 用途 | 能否增加掌握度 |
|---|---|---|---|
| 页面浏览 / 控件交互 | `activity` | 探索轨迹 | 否 |
| 答题错误 | `attempt` | 精确薄弱点诊断 | 否 |
| 原挑战关卡通过 | `completed` | 挑战证据 | 是 |
| 无提示知识检查通过 | `assessment_passed` | 检查点证据 | 是 |
| 定向复习通过 | `assessment_passed` | 薄弱点独立验证 | 是，并可按规则解除 gap |

探索事件仅保留作品 ID、知识专题 ID、路由、控件标识和动作类型；不采集代码编辑内容、文本输入、表单值或个人内容。

### 检查点规则

14 个 checkpoint 为对应作品注册无提示检查点。检查点使用独立的 `sessionType=checkpoint` 和稳定 `variantId`。答错可登记 gap，但 checkpoint 成功不能关闭已有 gap；只有 Review 工作台中不同变体、无提示的独立验证才能完成 gap 生命周期。三件挑战型作品继续由 Challenge Engine 产生 campaign 证据。

### Monorepo 缓存能力

新增 `build-cache-integrity`，位于 `build-topology` 之后。新增两个 gap：`build-cache-input-coverage`（缓存键遗漏环境变量、配置或工具链输入）和 `build-cache-stale-output`（把 cache hit 错当成产物必然正确）。为每个 gap 提供 A/B 两种不同复习变体。该能力由缓存实验与作品检查点评估，不会伪装成现有三关 Monorepo 解谜游戏的一部分。

### 当前存储边界

IndexedDB v4 是本机 canonical learning database；学习事件追加式保存，挑战现场、活动复习和偏好作为版本化文档保存。所有领域读写通过 LearningRepository，使用异步 API。Phase C LocalStorage 仅用于一次性迁移，旧事件 schema 不进入运行时双读/双写。Supabase 以原子批次 RPC 同步事件和文档；显式云端恢复为 pull-only，CAS 冲突保留双方版本。实体设备验收见 docs/backend/phase-d-real-device-acceptance.md。

## 主动学习规划系统（2026-11-01）

### 架构与输入

`assets/js/learning-planner.mjs` 是纯规则决策层，读取：

- `learning-map.json`：能力点、前置依赖、课程与实验入口；
- `works.json`：作品、产品线、检查点与挑战资源关系；
- `challenges.json` / `learning-checkpoints.json`：可验证的不同评估变体；
- `deriveLearningInsights()`：掌握分、置信度、gap 生命周期、复习时间和历史 evidence；
- 用户本地偏好：每日可用时间与优先专题。

规划不依赖在线 LLM。它必须确定性地输出“为什么推荐、为什么暂缓、去哪里执行、预计需要多久”，保持离线可用和可测试。

### 决策优先级

按高到低生成候选行动：

1. **修复 gap**：活动误区、重复错误和待独立确认优先，直接打开指定 `gapId` 的 Review。
2. **到期复习**：使用既有间隔复习调度，依据最近证据、掌握状态和下游影响安排。
3. **薄弱能力练习**：对 weak / building 节点推荐尚未使用的检查点、实验或挑战。
4. **独立变体验证**：对初步掌握但证据数量不足的节点选择未使用过的 checkpoint 或 challenge step；已使用的 challenge step 不冒充新变体。
5. **基础课程**：无有效 evidence 的节点先学课程；标记课程学习完成后，下一步切换为练习。

未解决 gap 会阻止相应知识点继续向上推进。前置门控递归检查整个祖先链：每个前置能力必须至少达到 initial，且没有 active gap；不是只检查直接父节点。

### 时间预算与计划构建

用户可选 15 / 25 / 40 / 60 分钟。每个候选动作带估算耗时和优先理由，规划器贪心选择最多三个不重复能力点，且“当天已完成耗时 + 当前计划耗时”不超过每日预算；完成一步后仅用剩余预算重新规划。优先专题只提供优先级加权，不会压过更紧急的薄弱点纠正。

当今天的行动被标记完成，规划器会重新计算剩余行动。课程学习完成状态跨天保留，以便下一步进入练习；练习本身仍须有真实 challenge / checkpoint evidence 才会改变掌握图谱。

### 事件和证据隔离

新增两种过程事件：

- `plan_action_started`：开始执行一项建议；
- `plan_action_completed`：用户确认已完成计划步骤。

事件包含 planDate、actionId、competencyId、资源入口和行动类型，保存在当前学习事件日志并随 JSON 档案导出。但这些事件不属于 `completed` 或 `assessment_passed`，因此不会被掌握度算法计为评估证据。规划偏好单独保存在 `knowverse:learning-plan:preferences`。

### 可解释性与安全边界

每个行动呈现规则原因，包括 gap 生命周期、重复错误、复习到期、前置条件、下游依赖、优先专题和预算。暂不引入 LLM、自主更改知识状态、账号或云端档案；未来可将模型用于解释或提出候选资源，但必须经过本地规则验证，且不能直接写入 mastery evidence。

### 验收

- Node 测试：空档案根节点、递归前置门控、gap 优先、到期复习、时间预算、专题偏好、完成反馈、跨天课程进度和 evidence 隔离。
- Playwright：Chromium 桌面端验证“课程 → 练习”动态切换；WebKit 移动视口验证预算、专题偏好持久化和布局。
