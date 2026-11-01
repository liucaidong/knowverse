# KNOWVERSE 学习智能系统 2.0

版本：2.0.0 · 2026-11-01

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

学习事件使用 schema V2。公共字段：

- `id`：幂等事件标识。
- `eventSchemaVersion`：事件结构版本。
- `at`：ISO 时间。
- `topicId / challengeId / stepId`：来源定位。
- `competencyIds`：与知识能力点的显式关系。
- `sessionId / sessionType / variantId`：区分挑战轮次、独立复习与题目变体。
- `gapId`：可选的精确概念误区 ID。
- `scorePct / attempts / hintsUsed`：可解释的验证质量字段。

已支持事件类型：

| 事件 | 含义 | 是否进入掌握度证据 |
|---|---|---|
| `attempt` | 提交一次挑战答案 | 否；可产生 gap 诊断 |
| `hint` / `hint_revealed` | 展开提示 | 否；用于独立性评估 |
| `completed` | 原挑战知识点关卡通过 | 是 |
| `review_started` | 开始独立复习 | 否 |
| `assessment_passed` | 独立复习题验证通过 | 是 |
| `activity` | 原理实验室、展厅或页面交互 | 否 |

**学习活动和掌握证据明确分离。** 探索三维场景、运行实验或打开课程不会直接让知识点涨分。当前 12 件非挑战作品已配置明确、可判定的无提示 checkpoint，并显式映射 competency；两件挑战作品由 Challenge Engine 提供结构化评估。

## 版本迁移与本地存储

当前实现采用浏览器 Local-first 存储：

- 当前主档：`knowverse:learning-progress:v2`
- 兼容旧档：`knowverse:learning-progress:v1`
- 活动中的复习会话：`knowverse:review-session:v1:*`
- 已完成复习历史由统一事件日志重建，并随学习档案 JSON 一起导出

V2 可以读取旧 V1 快照，并在新事件写入时升级为 V2。旧事件 ID、时间、分数、挑战和知识点关系会保留；无法从旧记录推断的 session / variant 元数据不伪造。导入接受 V1 和 V2 JSON，默认按事件 ID 去重合并。

事件日志不再按固定 5,000 条静默截断。浏览器存储仍受各浏览器的站点配额限制；写入失败会返回失败状态，不会假装已保存。建议定期导出 JSON 备份。导出文件包含个人学习记录，应由本人妥善保管，不要提交到公开仓库。

**部署限制：** GitHub Pages 是静态站点。本版本不提供账户、云同步或跨设备自动合并。Mac 与 iPhone 的浏览器存储相互独立，需使用 JSON 导出 / 导入。

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

判断复习前后顺序采用追加事件日志顺序，不依赖浏览器时间戳是否处于同一毫秒。

## 独立 Review Session

`review/index.html` 是与原始 Challenge Campaign 隔离的复习工作台：

- 可从知识点或具体 gap 打开。
- 使用 `content/review-assessments.json` 的题型变体，不重置或覆盖原挑战。
- 当前覆盖 Promise 五个 competency 与 Monorepo 四个 competency，19 个 gap、20 个 gap-competency 映射，共 40 个针对性验证场景。
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

- schema V1 → V2 迁移、事件去重和完整历史保留测试；
- gap 精准匹配、提示辅助、不同变体与独立验证状态测试；
- mastery / confidence、状态升级和降级、gap-only review queue 测试；
- 九个 competency、19 个 gap 和 20 组 gap-competency 映射的 40 个 review variant 注册表校验；
- Playwright Chromium 桌面端和 WebKit 手机视口的浏览器端闭环测试；
- 原有 Promise、Monorepo、内容路由、搜索索引及作品工程回归。

WebKit 手机视口属于浏览器引擎的自动化视口测试，不等同于对真实 iPhone Safari 设备的人工验收。

## 数据安全与非目标

- 不引入用户账户、云端数据库或第三方学习分析服务。
- 不把个人学习事件写入仓库静态 JSON。
- 不生成没有验证题的虚假掌握分。
- 不把三个产品主线重写为一个大型应用；采用统一事件协议与轻量采集模块。
- 当前事件主档仍为 LocalStorage V2，以兼容现有同步挑战 API；尚未迁移到 IndexedDB。大规模长期档案应定期导出备份，后续如升级异步 IndexedDB，需要同步重构 challenge store 的持久化接口。


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

12 件非挑战作品各自注册一个无提示检查点。检查点使用独立的 `sessionType=checkpoint` 和稳定 `variantId`。答错可登记 gap，但 checkpoint 成功不能关闭已有 gap；只有 Review 工作台中不同变体、无提示的独立验证才能完成 gap 生命周期。两件挑战型作品继续由 Challenge Engine 产生 campaign 证据。

### Monorepo 缓存能力

新增 `build-cache-integrity`，位于 `build-topology` 之后。新增两个 gap：`build-cache-input-coverage`（缓存键遗漏环境变量、配置或工具链输入）和 `build-cache-stale-output`（把 cache hit 错当成产物必然正确）。为每个 gap 提供 A/B 两种不同复习变体。该能力由缓存实验与作品检查点评估，不会伪装成现有三关 Monorepo 解谜游戏的一部分。

### 兼容与边界

V1/V2 档案迁移、LocalStorage、事件追加、导入导出和原有挑战存储键保持兼容。此阶段不引入用户账户、云端数据库、跨设备自动同步，也不把探索行为升级为掌握证据。


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

事件包含 planDate、actionId、competencyId、资源入口和行动类型，保存在现有 V2 事件日志并随 JSON 档案导出。但这些事件不属于 `completed` 或 `assessment_passed`，因此不会被掌握度算法计为评估证据。规划偏好单独保存在 `knowverse:learning-plan:preferences:v1`。

### 可解释性与安全边界

每个行动呈现规则原因，包括 gap 生命周期、重复错误、复习到期、前置条件、下游依赖、优先专题和预算。暂不引入 LLM、自主更改知识状态、账号或云端档案；未来可将模型用于解释或提出候选资源，但必须经过本地规则验证，且不能直接写入 mastery evidence。

### 验收

- Node 测试：空档案根节点、递归前置门控、gap 优先、到期复习、时间预算、专题偏好、完成反馈、跨天课程进度和 evidence 隔离。
- Playwright：Chromium 桌面端验证“课程 → 练习”动态切换；WebKit 移动视口验证预算、专题偏好持久化和布局。
