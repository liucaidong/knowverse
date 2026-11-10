# KNOWVERSE 功能与内容双清单关联审核报告

**审计日期：** 2026-11-04

## 1. 总体判断

核心三专题已将知识内容、Concept、Competency、作品、Checkpoint、Review Assessment、Gap 和学习事件关联，并在本地 E2E 中验证学习动作到掌握反馈。其余九个专题主要是可读内容和目录入口。生产 learning_events 为 0，真实 Supabase 双设备写入未验收，因此本地闭环已被自动化测试证明，生产数据闭环尚未被证明。

## 2. 核心映射矩阵

| 专题 | 页面 | Concept | Competency | Gap | Checkpoint | Review | 作品 | 来源 | 结构覆盖 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JavaScript · Promise (promise) | 24 | 6 | 5 | 14 | 8 | 30 | 9 | 4 | 5/5 |
| TypeScript · Monorepo (monorepo) | 18 | 4 | 4 | 5 | 4 | 10 | 5 | 4 | 5/5 |
| React Native · 新架构 (react-native) | 8 | 6 | 6 | 12 | 2 | 32 | 3 | 5 | 5/5 |
| AI · 多模态教育 (ai-education) | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| AI Agent · 系统工程 (ai-agents) | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| 模型 · 算力与工具 (model-infra) | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| 数据库 · 进化与内核 (database) | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| 金融学 · 案例与量化 (finance) | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| WebGL · 知识交互 (creative) | 4 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 1/5 |
| 数学 · 离散与线代 (math) | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| 语言 · 英语与东北话 (language) | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |
| 工程治理 · 开发工作流 (engineering) | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1/5 |

其余九专题合计 24 个 Markdown 页面，0 Concept、0 Competency、0 Gap、0 Checkpoint、0 Review、0 官方来源。作品关联是多对多关系，不应将专题关联数量简单相加为独立作品数量。

## 3. 已形成的本地学习闭环

- 16 个 Concept 和 15 个 Competency；显式先修 DAG 结构验证通过。
- 31 个 Gap 绑定 Competency；72 个 Review Assessment 和 14 个 Checkpoint 提供评估入口。
- 17 件作品有 knowledge_ids；学习事件/掌握度 reducer、Planner、任务管理、Review 和七日回顾本地 E2E 通过。
- E2E 明确验证私有反思和候选练习不直接成为 mastery evidence。

### 生产闭环中断点

- Supabase public.learning_events 为 0 行；user_devices 1 行，learning_archive_documents 3 行。
- 跨设备归档 E2E 使用 isolated/mock RPC，不是生产双账号/双设备验证。
- 未完成真实 GitHub OAuth、RLS 跨账号越权、Outbox 与 CAS 的生产验收。
- 因此不能证明生产环境的“活动 → 掌握度 → Gap → 下一步计划 → 独立复测”完整链路。

## 4. 有功能但内容结构不足

1. AI Tutor/Agent 的正式结构化上下文主要存在于三个图谱专题；其他九专题缺 Competency、Prerequisite 和 Assessment。
2. Mastery/Gap 引擎存在，但不能对未建模专题伪造掌握数据。
3. Planner 依赖先修和评估证据；未建模专题缺少可解释的正式学习路径。
4. AI Reviewer/发布门禁部分代码已实现，但生产质量记录为 0，manifest 为空。
5. 跨设备同步代码和 RLS 存在，真实双设备生产链路尚未证明。

## 5. 有内容但学习功能不足

九个专题具备公开页面，但没有正式 Concept/Competency/Gap/Review 图谱：

- AI 多模态教育
- AI Agent 系统工程
- 模型算力与工具
- 数据库内核
- 金融案例与量化
- WebGL/知识交互
- 数学
- 语言
- 工程治理

这些专题可以阅读和检索，但目前不能声称已支持同等级别的掌握评估、Gap 识别和定向复习。

## 6. 关系完整性检查

- 44 route IDs 均有本地 HTML 对应，生产 HTTP 200。
- Navigation route 引用未发现无效 ID。
- Concept → topic/article/work/assessment/source 引用未发现悬空 ID。
- Work → topic/competency/checkpoint 引用未发现悬空 ID。
- Competency prerequisites、Gap → Competency、Assessment → Competency/Gap 引用未发现悬空 ID。
- 先修 DAG 结构验证通过。
- Review prompt 完全相同重复组 0；语义近似重复未核验。

无悬空 ID 只证明引用可解析，不证明知识因果关系或评估题语义完全正确。


## 7. 功能与内容匹配评级

| 匹配层 | 当前状态 | 依据 |
|---|---|---|
| 功能入口 → canonical route | 强 | 44 routes 可访问；本地浏览器加载通过 |
| 专题 → 内容页 | 强 | 12 专题、74 Markdown index 页面可访问 |
| 内容 → Concept | 局部强 | 16 Concept 集中在三个专题 |
| Concept → Competency/先修 | 局部强 | 15 Competency、DAG 结构验证通过 |
| Competency → Work | 局部强 | 17 Works 绑定知识 ID，重点专题关联能力 |
| Work → Checkpoint/Review | 局部强 | 14 checkpoints、72 reviews，但仅三个专题 |
| Assessment → Event | 测试环境通过 | 本地 E2E 通过；生产 learning_events=0 |
| Event → Mastery/Gap | 测试环境通过 | reducer/Gap E2E 通过；生产链路未验证 |
| Gap → Planner/Task | 测试环境通过 | Planner/任务/复习 E2E 通过；生产个人数据未验证 |
| AI → 可靠知识上下文 | 部分 | 三专题映射较完整，其余九专题缺知识模型 |
| Candidate → Reviewer → Human → PR → Pages → Registry | 生产未证明 | 生产审核记录 0、manifest 0、prepare-pr skipped |

## 8. 下一阶段最优先的五项工作

1. 对齐 PR #11 与生产迁移账本。
2. 在 staging 使用真实模型验证 Tutor、Agent、Reviewer 和候选发布。
3. 在 staging 使用真实 Supabase 双设备验证 OAuth、RLS、事件、Outbox 与 CAS。
4. 把 2–3 个高价值未建模专题纳入正式知识图谱，并配套评估。
5. 对 74 个页面和 72 道题分批完成技术语义审校、难度校准和来源补齐。

## 9. 机器清单

feature-inventory.json、content-inventory.json、audit-issues.json 包含稳定 ID、证据、状态、问题和建议。
