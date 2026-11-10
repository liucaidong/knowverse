# KNOWVERSE 内容清单与内容质量审核报告

**审计日期：** 2026-11-04  
**正式内容来源：** content/ Registry 与 knowledge/ Markdown 正文

## 1. 统计口径

正式发布登记/资源记录共 **281 条**，由以下资源组成：12 Topic registry descriptors、74 Markdown index 页面、16 Concept、15 Competency、31 Gap、17 Work、3 Challenge world、14 Challenge step、14 Checkpoint、72 Review Assessment、13 Source。该数字包含元数据和学习模型记录，不等于独立 HTML 页面数。

另有 13 份 knowledge/ 非 index Markdown 支持文件，以及 51 份 docs/ 内部工程/阶段文档。合计 64 条补充/内部资源单独盘点，不计入正式公开学习页。

## 2. 草稿、候选与非发布资产

- 正式发布 manifest 中候选条目：0。
- 生产 practice candidate quality records：0。
- 正式 Registry 中未识别到独立 DRAFT 或 DEPRECATED 内容记录；没有单独的 draft/deprecated 内容 Registry。
- 候选生成源码和 E2E fixture 存在，但没有持久化候选内容资产。本结论仅针对当前仓库/正式 Registry 与生产审核记录，不排除仓库外存在未登记草稿。

## 2. 内容分类统计

| 内容类型 | 数量 |
|---|---:|
| challenge_step | 14 |
| challenge_world | 3 |
| checkpoint | 14 |
| competency | 15 |
| concept | 16 |
| interactive_work | 17 |
| learning_gap | 31 |
| markdown_lesson_page | 74 |
| reference_source | 13 |
| review_assessment | 72 |
| topic_registry | 12 |

## 3. 专题知识覆盖矩阵

结构覆盖满分 5 分，只衡量五层是否存在：公开页面、Concept/Competency、显式先修关系、Checkpoint/Review、官方来源。该分数不代表技术准确性或教学质量。

| 专题 | Markdown 页面 | Concept | Competency | Gap | Checkpoint | Review Assessment | 关联作品 | 来源 | 结构覆盖 |
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

**结论：** 只有 Promise、Monorepo、React Native 三个专题有完整五层结构覆盖。其他九个专题有公开页面，但没有正式 Concept/Competency/Gap/Review 图谱。Creative 有若干关联作品，但作品链接不能代替能力模型和评估。


## 4. 内容发布与可访问证据

- 74/74 个 index.md 页面有 HTML 对应文件，生产 GET 200。
- 17/17 个登记 live 作品页面生产 GET 200。
- 13/13 个官方来源 URL HEAD 请求返回 200。
- 44/44 canonical routes 生产 HTTP 200。
- validate-v2 检查 3501 个本地链接和 22 个 Mermaid panorama。
- 72 道 Review Assessment 规范化完全相同题干检查没有发现重复组；语义近似题未做相似度审查。
- 72/72 Review Assessment 均未登记 difficulty 字段。

## 5. 核心专题资产

| 专题 | Markdown 页 | Concept | Competency | Gap | Checkpoint | Review | 作品关联 | 来源 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Promise | 24 | 6 | 5 | 14 | 8 | 30 | 9 | 4 |
| TypeScript Monorepo | 18 | 4 | 4 | 5 | 4 | 10 | 5 | 4 |
| React Native | 8 | 6 | 6 | 12 | 2 | 32 | 3 | 5 |

Promise 有 20 个 Lesson，调试工作台 13 场景并做 Node 原生 Promise 差分。Monorepo 有 10 个学习单元，manifest graph 为 5 节点、7 边、3 层构建。React Native 有 7 章，原生 app build 和实体设备执行没有本次可验证证据。

## 6. 练习与评估内容

| 项目 | 数量/结果 |
|---|---:|
| Review Assessment | 72 |
| Checkpoint | 14 |
| Challenge worlds / steps | 3 / 14 |
| Review 结构字段检查通过 | 72/72 |
| Review 缺少 difficulty | 72/72 |
| 规范化完全相同题干重复组 | 0 |

结构检查只证明题目具有标题、题干、选项、合法 answer option ID、解释和提示等基本字段，不证明答案技术上正确、解析无歧义或难度合理。

## 7. 内容质量评分（0–5）

| 维度 | 评分 | 证据依据 |
|---|---:|---|
| 技术准确性 | 未评分 | 没有逐条核验 74 页面、72 题和 51 文档；保持 UNVERIFIED。 |
| 内容完整性 | 3.0 | 页面资产存在，但正式学习图谱只覆盖 3/12 专题；是结构判断，不是语义评分。 |
| 知识体系合理性 | 3.0 | 16 Concept、15 Competency、31 Gap 结构清楚，但集中在三个专题。 |
| 前置/后续关系 | 4.0 | 显式先修 DAG 验证通过；正式图谱只覆盖 15 个能力节点。 |
| 工程实践价值 | 3.5 | Promise native differential 和 Monorepo manifest graph 有工程证据；RN 真机未验证。 |
| 教学表达质量 | 未评分 | 未逐段审阅所有页面的表达、节奏和认知负荷，不给伪精确分数。 |
| 代码与案例质量 | 3.5 | 关键 Promise 案例和 Monorepo graph 经过执行验证，不能外推到所有代码块。 |
| 练习和测评质量 | 3.5 | 72 Review +14 Checkpoint，结构映射有效；难度缺失、语义未逐题复核。 |
| 参考资料质量 | 3.5 | 13 条来源可达且多为官方资料；覆盖仅三专题，来源版本和引用锚点未逐条核验。 |
| 内容关联与复用 | 3.5 | 稳定 ID 关系可校验；其余九专题尚未建立正式图谱。 |

“未评分”代表缺乏逐条语义审校证据，不等于内容默认错误。技术准确性、教学表达质量不应伪造分数。

## 8. 重复、缺失、过时与错误

- **重复：** 完全相同的规范化 Review prompt 检查为 0 组；语义近似重复未运行相似度检测。
- **缺失：** 9/12 专题缺正式能力图谱；72 道 Review 题缺 difficulty；其他九专题没有正式 source registry 映射。
- **过时：** 来源 URL 可达，但本次未完成全部内容的版本时效检查，不能报告确认过时内容的数量。
- **技术错误：** 未完成逐条专家事实核验，不能报告确认错误条数；技术准确性字段保持 UNVERIFIED。
- **关系失联：** Concept/Work/Competency/Gap/Assessment/Checkpoint/Source 的 ID 引用扫描未发现悬空引用；不代表语义关系必然正确。

## 9. 内容建设优先级

1. Promise、Monorepo、React Native 三条课程逐页逐题语义审校。
2. 为 72 道 Review Assessment 增加经审核的难度、题型和认知目标。
3. 选择 AI Agent、AI 教育、数据库/模型基础设施等高价值专题建设正式图谱。
4. 为其他专题补充权威来源与具体引用锚点。
5. 对互动作品的代码、案例、可视化和反馈增加可运行证据。

content-inventory.json 保存每个资源的唯一 ID、文件路径、路由、学习目标、关联、完整性、准确性、来源、问题及建议。问题证据见 audit-issues.json。
