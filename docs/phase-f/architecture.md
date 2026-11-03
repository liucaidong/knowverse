# Phase F — 主动学习架构

## 权威边界
| 事实/职责 | 继续使用的权威模块 |
|---|---|
| 原始学习事实 | append-only Learning Events |
| 掌握度、置信度、gap、知识依赖 | Learning Intelligence + Knowledge Map |
| 目标生命周期 | Goal Manager |
| 计划 proposal / accepted revision | Plan Manager |
| 任务状态和完成证据 | Task Orchestrator |
| 领域数据访问 | LearningRepository |
| 本地持久化 | IndexedDB v4 |
| 云端同步 | Supabase archive + Outbox/CAS |
| 模型交互 | Agent（无数据库权限） |

不建立第二套事件、掌握度、知识图谱或任务系统。

## 新增模块
- `spaced-repetition-engine.mjs`：纯函数；按能力与学习会话从真实评估计算稳定天数、间隔、dueAt、生命周期。
- `learning-risk-engine.mjs`：纯函数；风险、趋势、停滞/过载/目标诊断和目标预测。
- `next-best-action.mjs`：纯函数；候选构建、确定性排序、证据和解释。
- `proactive-learning-engine.mjs`：应用服务；Repository 读取、Learning Intelligence 调用、派生组合、任务创建、投影缓存/CAS。
- 现有 progress 页面呈现驾驶舱；Agent workspace 在打开和事件到达时刷新投影。

纯算法不访问 DOM、IndexedDB、Supabase 或模型；时间通过参数输入。

## 数据流
```text
Repository events + goals/preferences/tasks + Knowledge Map
                         |
              deriveLearningInsights
                         |
       spaced repetition / risk / trends / forecast
                         |
                 Next Best Action
                         |
           versioned derived projection
                         |
              due review candidates
                         v
              Existing Task Orchestrator
                         |
             existing Review/Challenge flow
                         |
               append-only events → recompute
```

投影仅是可丢弃、可重建的缓存，不能成为学习事实或掌握度权威。包含 schemaVersion、algorithmVersions、sourceFingerprint、computedAt 和 evidenceRefs。

## 任务与同步
到期项经现有 Task Orchestrator 幂等创建。普通能力复习使用现有 assessment 证据门槛；具体 gap 使用现有 review 任务因果链。稳定 taskId 防止重复。Review URL 可带 taskId，执行前后仍调用原有 start/complete/fail。

本地使用 IndexedDB v4 learningDocuments/learningEvents/Outbox，不增表、不升级 DB version。仅增加一种 `proactive_learning_projection` 文档类型；Supabase migration 同步扩展 archive allowlist 和原 RPC 的相同 allowlist，不放宽 RLS/JWT/设备/CAS/大小限制。

## 事件与 Agent
相关 Repository 通知按 eventId 去重、短时合并；页面重新打开会读取权威事件并补算。投影重算不等于计划重建。新计划只经 Plan Manager 提案和用户确认。Agent 只能读取有限摘要；模型输出永远是不可信建议。
