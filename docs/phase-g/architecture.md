# KNOWVERSE Phase G：学习策略自校准与深度个性化系统

**实施状态：** 2026-11-03
**版本：** Learning Strategy v1 / Proactive Projection v3 / Spaced Repetition v2
**产品归属：** 主动学习系统能力升级，不新增第四条产品主线

## 1. 当前架构审查与 Phase F 复用

| 既有模块 | 既有职责 | Phase G 处理 |
| --- | --- | --- |
| Learning Events / learning_events | 追加式学习事实、事件去重 | 唯一事实流；增加策略审计和反馈事件 |
| Learning Intelligence | 掌握度、信心、薄弱点、先修关系 | 继续推导，画像和行为不得直接改写掌握度 |
| Learner Profile | 学习时长、频率、专题和模式偏好 | 扩展 preferences，新增 personalizationMode |
| Spaced Repetition | 根据复习质量计算稳定性和下次复习 | 保留原算法，加入证据门槛控制下的个人间隔倍率 |
| Learning Risk / Next Best Action | 风险、趋势、诊断和行动排序 | 消费校准后的复习队列 |
| Proactive Learning Engine | 投影、缓存、幂等任务生成 | 整合策略模型与效果观察 |
| Planner / Goal Manager | 计划提案、目标、计划版本 | 注入策略快照，仍需用户接受计划 |
| Task Orchestrator | 任务状态机、完成证据校验、CAS | 新任务 Schema v2 要求结果事件绑定准确 taskId；历史 v1 任务沿用原校验规则，策略决策 ID 不降低证据门槛 |
| Review Engine | 无提示独立复习、变体和因果链 | 将决策 ID 写入关联复习证据 |
| LearningRepository | IndexedDB、Outbox、Supabase、CAS | 继续承载本地/云端一致语义 |

接管时 main 与 origin/main 均为 aeddcf78d2fce6a234d617ec4efdd93adaadea8e，工作区干净。Phase F 已有 learner_profile 和 proactive_learning_projection 文档类型。生产 Supabase 公开表均启用 RLS；learning_events 没有事件类型枚举白名单，原子同步 RPC 继续验证用户、设备、V3 事件信封和文档 CAS。

## 2. Phase G 范围与非目标

新增核心模块 assets/js/learning-strategy-engine.mjs，承担证据分类、质量/可信度、策略参数校准、效果分层、档案持久化和反馈写入。Proactive Learning Engine 调用它并升级 Projection；Planner、Task Orchestrator、Review Engine 贯穿相同决策 ID；驾驶舱与 Agent 展示和消费策略投影。

不新增事实表、掌握度表、任务表或独立画像中心；不将点击、任务完成或提示辅助答对当成独立掌握；不把相关性说成因果；不让 LLM 越过规则修改掌握状态；不假设 GitHub Pages 有后台常驻任务；不更改 RLS 或匿名权限。

## 3. 系统架构

~~~mermaid
flowchart TD
  A[学习行为与计划] --> B[Learning Events V3]
  B --> C[证据提取与去重]
  C --> D[类型 / 质量 / 时间衰减]
  D --> E[样本门槛与可信度]
  E --> F[Learner Strategy Profile]
  F --> G[策略效果分层]
  G --> H[受限参数校准与审计]
  H --> I[Proactive Projection v3]
  I --> J[复习调度 / 风险 / Planner / Agent]
  J --> K[计划提案与任务执行]
  K --> L[挑战 / 独立复习 / 延迟验证]
  L --> B
  H --> M[(learner_profile / strategy)]
  I --> N[(proactive_learning_projection / current)]
  M --> O[LearningRepository / Outbox / CAS]
  N --> O
~~~

策略模型和决策使用确定性 JavaScript 规则。模型只可辅助讲解和教学内容，不得绕过任务完成证据、独立掌握证据或参数边界。

## 4. 核心数据流

1. 活动进入现有 Learning Events V3；任务与复习事件仍由原引擎记录。
2. 策略引擎按事件 ID 去重，过滤无效时间、未来事件及窗口外事件。
3. 将证据分类为行为、过程、独立能力、延迟回忆、跨题型迁移和长期稳定性。
4. 结合样本门槛、质量、时间衰减和矛盾信号计算可信度。
5. 达到门槛后，生成有限幅度的参数变化和可解释决策。
6. 决策 ID 贯穿计划提案、任务状态事件和关联复习评估。
7. 复习间隔和难度仅在各自知识点的独立样本达到门槛后进行校准；样本不足或证据退出 180 天窗口时清除该节点的旧参数并恢复 Phase F 默认行为，不借用其他节点的数据。
8. 后续事件按决策 ID 汇总推荐、执行、能力、长期结果和用户反馈。
9. 新证据触发下一轮校准；同一输入不会重复累计策略审计。

## 5. 数据模型与数据库决策

| 存储 | 类型 / Key | Phase G 用途 |
| --- | --- | --- |
| Learning Events V3 | 原事件流 | 策略审计、反馈及计划/任务/复习事件的决策 ID |
| Archive Documents | learner_profile / preferences | 保存 personalizationMode: adaptive/default |
| Archive Documents | learner_profile / strategy | 保存策略参数、证据摘要、置信度、最近决策和有限历史 |
| Archive Documents | proactive_learning_projection / current | 保存策略投影、调度和效果摘要 |

策略文档仅保存有限证据摘要和最多 12 条决策历史，不复制完整事件流。现有归档文档已经支持 learner_profile、用户作用域、注册设备、修订号、CAS 和原子同步；策略档案属于可重建派生文档，不需要独立 SQL 表。因此 Phase G 不新增迁移、不变更表结构/索引/约束/RLS，事件沿用 schema version 3 与既有同步 RPC。

## 6. 安全、同步和并发

- 档案写入沿用 learner_profile 现有文档白名单。
- 审计事件经同一 LearningRepository 进入本地库和 Outbox。
- 文档写入使用 expected revision；冲突后最多重新读取并计算两次。
- 决策 ID 由来源指纹、前后参数和算法版本确定性生成。
- 同步失败只延迟云端确认，不把未确认内容视为云端已提交。
- CAS 单元测试不等于两台物理设备同时连接生产的并发验收。
- AI Provider 不拥有策略档案写权限。

## 7. 用户控制与产品体验

策略能力嵌入主动学习驾驶舱：显示模式、证据量、可信度、参数、最近调整、证据引用和验证目标。用户可切换默认/个性化模式并对最近建议提交“有帮助/不合适”反馈。Agent 读取相同投影；Planner 仍生成待确认提案，用户接受后才生成正式任务。用户时间预算不会被策略提高。

## 8. 限制

180 天窗口外事件不参与校准，窗口内采用 60 天半衰期；关联观察不是受控实验；当前干预分类不宣称识别固定学习风格。真实双设备并发、物理 iPhone Safari、生产模型 Provider Secret 不能由本次自动测试推定为已验证。GitHub Pages 关闭后不会继续后台校准，重新打开时由已同步事实重新计算。
