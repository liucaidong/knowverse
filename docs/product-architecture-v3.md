# KNOWVERSE 3.0 · Personal Learning Platform 产品与技术实施方案

版本：3.0 · 2026-11-01  
基准仓库：`liucaidong/knowverse`  
产品定位：个人智能学习系统

## 1. 产品定位与核心目标

KNOWVERSE 不再以知识笔记或互动作品目录为最终定位，而是成为一个能够持续管理个人学习过程的系统：

**建立知识结构 → 选择学习方式 → 产生可验证证据 → 诊断薄弱点 → 定向复习 → 独立验证 → 重新规划。**

用户购买的不是更多页面，而是持续回答三个问题：

1. 我需要学习什么？
2. 我究竟掌握了多少？
3. 下一步最值得做什么？

## 2. 产品架构决策

### 2.1 三条产品主线保持稳定

| 主线 | 用户价值 | 典型交互 | 质量标准 |
|---|---|---|---|
| 01 原理实验室 | 理解机制 | 可编辑代码、参数控制、单步运行、状态快照 | 与真实运行结果或明确标注的教学模型一致 |
| 02 沉浸式知识展厅 | 建立直觉和空间认知 | WebGL、镜头叙事、结构关系、空间交互 | 视觉效果必须表达知识，不做无意义装饰 |
| 03 知识解谜世界 | 将知识迁移到新问题 | 关卡、假设、推理、实验、无提示挑战 | 结果可判定、错因可定位、与能力点有关系 |

三条主线是体验方式，不是学科分类。Promise、Monorepo、React Native 等知识领域可以同时拥有三种体验，但不强制每个主题都做 3D 游戏。

### 2.2 学习智能引擎是横向平台能力

不把学习驾驶舱、复习工作台和主动规划包装成第四、第五条主线。它们共同构成贯穿所有产品的学习系统：

- Knowledge Registry：知识专题、课程、能力点和前置关系。
- Work Registry：互动作品、体验主线、评估类型和能力点关联。
- Learning Event Log：挑战、提示、检查点、复习和探索事件。
- Mastery Reducer：掌握度、置信度、状态、薄弱点生命周期。
- Review Scheduler：间隔复习和具体误区的独立验证。
- Adaptive Planner：按紧急程度、前置门控和时间预算选择下一步。
- Learning Archive：本地持久化、云端事件同步和备份。

### 2.3 AI 导师是智能服务，不另建平行产品

未来 AI 导师需要在知识阅读、原理实验、沉浸展厅和解谜挑战里被调用。统一接口至少包括：

- Explain：结合当前知识节点和个人掌握状态讲解。
- Diagnose：分析用户推理过程和错误类型。
- Evaluate：给出结构化评价候选，不直接写掌握证据。
- Generate Review：生成候选复习变体，先经过 Schema 和质量验证。
- Multimodal Context：理解书页、屏幕、图像、语音和摄像头帧。

模型不能替代事件 reducer 或成为掌握度裁判。

## 3. 当前仓库基线

截至 2026-11-01 main 分支：

- 3 条体验主线，14 件已上线作品：原理实验室 7、展厅 3、解谜世界 4。
- 12 个知识专题、92 条可检索内容记录、22 张 Mermaid 全景图。
- 学习图谱当前覆盖 Promise 5 个能力点与 Monorepo 4 个能力点。
- 19 个薄弱点、40 个针对性复习场景、12 个非挑战作品检查点、2 个结构化挑战作品。
- V2 学习事件、掌握度与置信度分离、gap 生命周期、独立 Review Session 和确定性主动规划。
- 学习档案仍以当前浏览器 LocalStorage 为兼容事实源；尚无真实账户或生产云同步。

## 4. 目标技术架构

```text
KNOWVERSE Experience Layer
  ├── 01 原理实验室
  ├── 02 沉浸式知识展厅
  └── 03 知识解谜世界
             │
             ▼
Learning Intelligence
  ├── Knowledge / Work Registry
  ├── Event Contract + Append-only Log
  ├── Mastery / Gap Reducer
  ├── Review Scheduler
  └── Adaptive Planner
             │
             ▼
Application & Data Platform
  ├── Auth Service
  ├── IndexedDB Local Archive + Outbox
  ├── Sync Engine
  └── Supabase PostgreSQL + RLS + RPC
             │
             ▼
Future AI Services
  ├── Explain / Diagnose / Evaluate
  ├── Review Generation
  └── Multimodal Learning Context
```

### 内容与个人数据分界

继续放在 Git 的公共静态资产：

- 知识文章、专题注册表、全景图源文件与备份。
- 作品注册表、课程路径、挑战定义、检查点和复习变体。
- 公开产品文档、工程测试与数据库 Migration。

放在个人本地 / 云端档案：

- 学习事件、挑战尝试、提示次数、独立复习结果。
- 设备信息、用户偏好、复习 Session 和进行中的挑战快照。
- 未来私人书籍、图片、试卷和个人 AI 学习上下文。

不把个人学习记录提交到仓库，也不把静态课程内容复制到个人数据库。

## 5. 实施阶段与验收标准

### Phase A · 三主线与学习智能契约（本次持续维护）

目标：冻结产品边界，确保所有作品使用一致的知识和学习协议。

交付：
- 单一作品注册表声明 pillar、knowledge_ids、competencyIds、assessment。
- 学习探索事件不作为 mastery evidence。
- 能力点前置关系是有向无环图；每次图谱变更执行完整性验证。
- 任何评估来源都携带稳定 workId、topicId、competencyId 和 variantId。
- 新作品必须有明确体验目标和可判定检查点或挑战。

验收：
- 注册表无悬空引用、重复 ID、未知主线或缺失评估。
- 三条主线作品按知识专题反向关联。
- 同一事件集合在同一 reducer 版本下产生确定结果。

### Phase B · 本地优先后端基础（本次代码交付，云端待配置）

目标：建立账户、设备、个人事件同步和最小安全数据库。

交付：
- GitHub OAuth PKCE。
- Supabase 用户白名单和 RLS。
- 设备注册、事件 Push / Pull RPC。
- IndexedDB 事件镜像、Outbox、设备序号和同步游标。
- 页面发布白名单，隔离 Migration 和后端工程文件。
- 不配置云端时继续本地运行。

当前存储边界：挑战与复习引擎使用当前 LocalStorage 快照完成同步式现场读取；IndexedDB 专注于 Outbox、设备序列、游标和云端 CAS 文档。事件历史只有一份本机权威副本，不维护双事件镜像或旧键迁移状态。

验收：
- 相同事件安全重试不重复插入。
- 相同事件 ID 不同内容产生冲突。
- Outbox 仅在云端确认后移除。
- Pull 合并成功后才推进游标。
- 未授权用户不能访问个人事件。
- 断网时本地学习可继续，恢复后可补传。

### Phase C · 快照恢复与因果一致性

目标：让 Mac 与 iPhone 之间恢复的不只是历史事件，也包括进行中的挑战、复习会话和精确薄弱点状态。

交付：
- 将挑战状态、Review Session 和本地事件仓库迁移至 IndexedDB。
- 所有涉及持久化成功的接口异步化，UI 只在事务提交后显示保存成功。
- 单一当前 schema 的学习事件日志、IndexedDB Outbox 与 CAS 文档持久化。
- Event Schema V3：causation_event_ids、gap_observation_id、target_gap_event_ids。
- 快照 revision 乐观锁，禁止 Last Write Wins 静默覆盖。
- 跨设备 gap reducer 明确处理无法排序的并发证据。

验收：
- Mac 离线挑战完成后，iPhone 登录同一用户可恢复事件与当前状态。
- 同一挑战跨设备并发修改可发现 revision 冲突。
- 只有针对目标 gap 的独立、无提示、不同变体验证才能关闭该 gap。
- 无法确定因果顺序时进入待重新验证，不静默标为纠正。

### Phase D · 第三个完整知识领域

推荐 React Native 新架构。

交付：
- Build、Startup、Runtime 三层知识地图。
- JSI、TurboModules、Fabric、CodeGen、Hermes 之间的关系和前置链。
- 实验室提供机制与调用链实验；展厅表达架构生命周期；解谜世界评估迁移应用。
- 建立专属 competency、gap、checkpoint、review variants。

验收：
- 新领域不修改 Promise / Monorepo reducer 核心逻辑。
- 仅通过内容注册表与评估契约即可加入学习驾驶舱。
- 前置图谱能够递归门控推荐，评估结果可跨设备重放。

### Phase E · AI 导师与多模态服务

交付：
- 独立服务端 AI API 代理，密钥不进入浏览器。
- 用户级额度、请求长度限制、超时、重试和日志脱敏。
- 解释、诊断、评估候选和复习题生成。
- 结构化输出 Schema、课程来源引用和质量校验。
- Mac 大屏阅读 + iPhone 摄像头 / 音视频上下文。
- 书页讲解、作业批改、试卷审阅和持续辅导。

验收：
- 模型不可直接写入 mastery evidence。
- AI 生成题必须先经过注册表/Schema 校验。
- 断网或额度耗尽时，原有学习体验正常。
- 用户可查看 AI 评价所依据的能力点、答案规则和引用材料。

### Phase F · 私人学习资料中心

交付：
- 私有对象存储、文件元数据、哈希、MIME 和访问控制。
- RLS / 短时签名 URL。
- PDF、图片、讲义、试卷和笔记的专题关联。
- 独立于 PostgreSQL 的对象备份与恢复。

## 6. 产品优先级与范围控制

| 优先级 | 内容 | 规则 |
|---|---|---|
| P0 | 当前三条主线稳定、学习事件完整、本地备份 | 不允许数据丢失 |
| P0 | 账户、授权、Outbox、增量同步和安全策略 | 必须通过安全与幂等测试 |
| P1 | 挑战 / 复习快照恢复和因果字段 | 再扩大学科前完成 |
| P1 | React Native 第三个知识领域 | 用来验证可扩展性 |
| P2 | AI 导师、多模态阅读与批改 | 后端安全与个人档案稳定后 |
| P2 | 私人文件中心 | 需要单独的文件备份设计 |

禁止：
- 增加平行的第四、第五条体验产品主线。
- 同时铺开十几个知识领域但缺少评估闭环。
- 用访问次数、停留时间或模型自评直接计算掌握度。
- 把模型供应商密钥放进静态页面。
- 在没有真实双端验证前宣称同步和冲突处理完成。
- 为了换技术栈而重写已经稳定的 Promise / WebGL 教学作品。

## 7. 产品指标

不以作品数量或页面访问量作为核心指标，优先观察：

- 评估证据覆盖率：有明确能力点和判定结果的作品比例。
- 独立验证率：提示辅助后能否在新变体上独立通过。
- Gap 复发率：已纠正误区在后续学习中再次出现的比例。
- 规划执行率：计划行动完成率和计划后重新评估的结果。
- 前置门控正确率：未满足前置能力时是否能正确暂缓下游推荐。
- 跨设备事件一致率：两端事件 ID 集合及 reducer 输出是否一致。
- 数据恢复成功率：从 JSON 备份或云端恢复后派生状态是否一致。

## 8. 架构原则

1. 事件是事实，掌握图谱是可重算的派生结果。
2. 领域规则独立于 UI 和云服务。
3. 三条体验主线共享知识与学习契约，不强制统一视觉形态。
4. 本地先写入，云端确认后才清理 Outbox。
5. 任何数据迁移必须可回滚、可校验、保留原档。
6. AI 负责辅助教学，不拥有掌握度裁决权。
7. 个人学习记录默认私有，公共 Git 只保存公共内容和代码。


## 9. 全站导航、内容关系与账户边界（2026-11）

### 9.1 导航不是目录堆叠

全站一级导航固定为三个用户目标：

- **知识体系**：以学科/专题为中心组织权威知识内容。
- **实践体验**：以三条产品主线组织理解、体验和应用方式。
- **学习成长**：展示个人学习证据、薄弱点、复习和研究历程。

一级名称始终导航到分区总览；箭头按钮只负责展开二级入口。知识专题列表直接从 `content/knowledge.json` 生成，导航分组从 `content/navigation.json` 生成。页面不得再各自声明主导航或在运行时追加重复的一级链接。

### 9.2 内容是单一事实源，关系由注册表表达

`content/knowledge.json` 定义专题；`content/search-metadata.json` 提供文章定位元数据；`content/works.json` 通过 `knowledge_ids` 维护体验作品与专题的关系；`content/learning-map.json` 定义已经建模的能力点和先修边。专题页展示文章入口、先修结构和三条主线下的相关作品；文章页只展示所属专题和相关入口，不复制其他页面正文。

只有真正录入 `learning-map.json` 的先修边才是正式学习门控。当前未建模的专题必须明确显示“尚未定义先修图谱”，不得仅根据文章编号推断因果关系。挑战与检查点产生学习事件，学习智能引擎据此计算掌握状态、薄弱点和复习计划，页面访问或菜单点击不构成掌握证据。

### 9.3 GitHub 登录是全站共享身份，不是页面授权

浏览器会话保存在 KNOWVERSE 站点同源存储中，因此同一站点下所有页面共享认证状态。公开知识、文章和互动作品不要求登录；登录的产品用途是关联个人学习档案与云端同步。GitHub OAuth 仅请求 `read:user` 基础身份信息，并不授予应用访问用户仓库的读写权限。身份认证完成也不代表自动获得云端同步资格，云端仍由账户白名单、RLS 和受控 RPC 授权。未登录时本地学习不受影响。

登录从任意页面发起后，完成 OAuth 会返回原页面；退出会清除全站共享账户会话，不删除本机学习数据。

## 10. KNOWVERSE 3.0 全站信息架构与 Concept / Competency 落地（2026-11-02）

本节记录 3.0 第一轮实现，不代表后续 AI 和多模态规划已上线。

### 10.1 三个产品入口与静态 Shell

全站只保留「知识体系 / 实践体验 / 学习成长」三个一级入口。一级名称进入分区总览，箭头按钮只负责展开二级菜单；GitHub 账户是导航最右侧的唯一账户控件，登录、身份、同步提示和退出均归入同一个账户面板。

`content/navigation.json` 通过 `routeId` 引用 `content/routes.json`。`scripts/build-site-shell.mjs` 在构建时生成静态导航、账户入口、搜索容器与页脚；`assets/js/site-shell.mjs` 只负责行为绑定、当前路由状态和账户状态，不再替换旧导航。这样关闭 JavaScript 后，分区入口仍存在。

常规内容与工具页面共享静态 Shell。三个全屏沉浸场景保留原画布和专用控制器，并提供统一退出入口；OAuth callback、自动化 fixture 和教程中的嵌入式示例工程不注入公共导航。

### 10.2 Canonical Route 与内容注册表

新增 `content/routes.json`，定义稳定 route ID、canonical path 和页面类型。导航项使用 route ID，不重复维护 URL。`content/concepts.json` 定义 Concept 独立对象；`content/sources.json` 定义来源对象；Concept 通过显式 ID 连接文章、作品、Competency、Checkpoint、Review Assessment 和来源。

`content/knowledge.json` 仍然只负责 Topic 级事实；`content/works.json` 通过 `knowledge_ids` 和 `learning.competencyIds` 连接专题及能力；`content/learning-map.json` 继续作为 Competency 与先修 DAG 的唯一事实源。

### 10.3 Concept 与 Competency 必须分开

Concept 是可解释、可引用、可连接的知识对象。Competency 是学习者必须表现出来、能够被评估的能力。一个概念可以支持多项能力；能力也可以跨多个概念组合评估。Assessment / Evidence 是评价输入和事实记录，不与 Concept 或 Competency 合并。

第一轮登记 16 个 Concept，其中 15 个与既有 Competency 建立一对一映射；另补充 Promise 状态机与解决权概念，以表达现有教材已有但旧能力图中缺少的知识节点。先修边严格从 `learning-map.json` 映射，不从章节顺序推断。

### 10.4 来源与覆盖透明

第一轮登记 13 条规范和官方文档来源，并由 Concept 引用。12 个专题中 Promise、Monorepo 和 React Native 已建立正式能力模型；其余 9 个专题标记为 `content-only`。它们仍可阅读和探索，但不能因为已有文章就显示虚构的先修关系、掌握状态或覆盖率。

### 10.5 构建与验收

- `scripts/build-public-content.mjs` 从注册表生成专题目录卡片、Concept 页面、来源与覆盖说明。
- `scripts/build-site-shell.mjs` 为公共页面生成统一静态 Shell，并保留实验工具的原始工作区结构。
- `scripts/validate-site-architecture.mjs` 校验 route、Concept、Competency、作品、评估、来源引用、先修 DAG、页面覆盖与静态账户入口。
- `scripts/verify-site-shell.mjs` 测试三分区、嵌套菜单、全站唯一账户和构建幂等性。

以下能力不计入本轮交付：AI 导师代理、模型供应商密钥托管、多模态私人资料中心、连续视频辅导和未完成的跨设备实机验收。它们保持为后续阶段，不在首页冒充为已经上线。

Concept 页面与全站搜索共用同一稳定 ID。scripts/build-search-index.py 从 content/concepts.json 派生概念搜索记录，不单独维护重复的标题、摘要和专题映射。
