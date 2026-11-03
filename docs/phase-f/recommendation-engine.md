# Phase F — Next Best Action 引擎

## 输出
每项包含 id/type/title、competencyId/topicId、taskId/href、estimatedMinutes、score、reasons、evidenceRefs、expectedOutcome、deferImpact、confidence。href 只能来自现有注册表/站内路由。

## 候选
- ready / in_progress / paused / failed 任务：继续、恢复、重试。
- relearning / due / overdue 能力点。
- 未解决 gap。
- 高风险上游先修。
- active goal 范围内需训练/验证节点。
- 无先修阻塞的新知识。
没有真实资源或入口时不生成可执行按钮。

## 确定性评分
基准 20 分：
- relearning +24，overdue +22，due +16。
- 风险 critical +26，high +19，moderate +9。
- unresolved gap +16，重复次数额外 min(8,count×2)。
- active goal priority×3，临近 deadline 额外 0–10。
- 下游影响 min(10,downstreamCount×2)。
- 已开始任务 +22，paused/failed 恢复 +15。
- 估计耗时超过当日预算 -12。
新知识仅获基础分，不压过高风险复习。同分按 dueAt、耗时、competencyId 稳定排序。

## 解释
证据引用必须是实际 eventId/goalId/taskId/依赖 ID；明确掌握度来源、失败事件、逾期长度或任务停滞。不声称精确学习损失/遗忘概率。置信度 low/medium/high 反映事件样本和资源完整度。用户动作走现有任务/复习流；跳过、重试和计划确认均由用户发起。
