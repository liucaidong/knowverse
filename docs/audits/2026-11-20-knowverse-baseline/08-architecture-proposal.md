# 08 · 架构评估与建议（KNOWVERSE 4.x）

## 对 PART 6 六大领域映射的评估

用户蓝图提出 6 个领域：Knowledge Space / Learning Planning / Interactive Laboratory / Mastery Assessment / Personal Learning Profile / Adaptive Learning Engine。本轮审计认为**现有架构已实质覆盖，且划分合理**：

| 目标领域 | 现有承载 | 评价 |
|---|---|---|
| Knowledge Space | `content/knowledge.json`/concepts.json + knowledge/ + 专题页 | 已统一内容/Concept/来源/关系；保持 |
| Learning Planning | Agent 的 goal-manager/plan-manager/task-orchestrator + planner engine | 目标→计划→任务版本化；保持 |
| Interactive Laboratory | works.json + lab/gallery/puzzles + Promise 调试台 | 三种实践主线；保持 |
| Mastery Assessment | learning-checkpoints/review-assessments + review-engine + 掌握 reducer | 证据驱动、独立验证；保持 |
| Personal Learning Profile | Learner profile + 版本化 archive documents + 反思/周回顾 | 长期档案、多设备同步；保持 |
| Adaptive Learning Engine | spaced-repetition / risk / strategy / NBA / proactive projection | 可解释自适应；保持 |

结论：**不机械新建六个独立系统**。现有模块边界与数据模型已经在 4.1 完成领域划分，强制拆分只会制造重复模块、违反 PART 3 原则 6。维持现状，聚焦未闭合的闭环与授权阻塞。

## 需要改进的具体点（按优先级）

1. **P1 云端复习任务闭合（KV41-010）**：需在 staging 真实账户复现后，核对 review-workspace 提交成功分支与 task-orchestrator.complete 的因果验证，确保无提示独立通过生成 `learning_task_completed`，提示辅助通过保持未完成。**禁止放宽校验来换取通过。**
2. **构建可复现性**：本轮已修复 `.DS_Store` 打包污染；建议 CI 增加产物确定性断言（如 ZIP 哈希基线）。
3. **搜索正文提取**：导航文案进入 `<main>` 被当作正文；建议站点外壳为搜索索引提供专用正文容器或 `data-search-skip` 标记，再重生成 134 条记录（产品决策）。
4. **外部配置**：Production AI Provider secrets、leak-password protection——需用户授权后处理。

## 数据模型（PART 8）结论

候选实体（User/Knowledge/Course/LearningObjective/Plan/Task/Activity/Evidence/Assessment/Mastery/Weakness/ReviewSchedule/Profile）已由现有 `learning_events`（append-only）+ `learning_archive_documents`（版本化）+ 注册表覆盖，职责分离且可追溯。**不建议无意义重建数据库**。仅在生产 migration 需变更时先做兼容性方案与回滚验证。
