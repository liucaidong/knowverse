# Phase H1 学习效果指标定义

## 共同口径

所有指标从 Learning Events V3 和版本化档案推导；按 eventId / taskId / planId / sessionId / variantId 去重；使用事件发生时间。分母为 0、未同步或样本不足时显示“样本不足”，不显示伪造百分比。activity / 浏览 / AI 讲解 / 阅读确认 / task completed 都不等于 mastery evidence；提示辅助单独统计。

## 指标

### 学习计划执行率
已完成的去重 plan task 数 ÷ 学习者已接受计划正式创建的 task 总数。分子按 taskId 唯一 completed；被拒绝的提案不进分母；跳过、失败、暂停和取消保留在分母但不计完成。来源 learning_plan_accepted、learning_task_completed 和 task documents。

### 独立通过率
无提示独立通过数 ÷ 有效独立验证结果数。结果必须是有效 assessment_passed / challenge completed，independent=true、hintsUsed=0，且 competency / variant 关联有效；同一 session+variant 只算一次。提示辅助结果单列。来源 Learning Intelligence assessment / challenge / review events。

### 延迟复习成功率
无提示独立通过的有效延迟 review 数 ÷ 有效延迟独立 review 结果数。sessionType=review，距同 competency 前次评估至少 2 天，具备有效 variant、session 和原始证据因果关联。同一 review session 不重复计数。

### 薄弱点修复率
已通过针对性独立验证关闭的 gap observation 数 ÷ 有效 gap observation 数。优先用 gapObservationId，按 competencyId+gapId 隔离；必须无提示、不同 variant、对准原 targetGapEventId 且 causation 链完整。提示辅助只进入 pending-verification。

### 跨变体通过率
无提示独立通过的不同有效 variant 数 ÷ 有效独立验证的不同 variant 数。按 competencyId 隔离；variant 缺失不构成新变体。

### 推荐接受率
去重 learning_plan_accepted 数 ÷ 去重 learning_plan_generated 数，按 planId。Next Best Action 单项 actionId 要另算，不与计划提案混合。接受不等于执行或掌握。

### 学习耗时
Task Orchestrator 实际执行区间 durationSeconds 总和 ÷ 3600，按 taskId 汇总。开始到 pause / resume / complete 的执行片段累计，暂停期间不计；不用浏览时间或计划估算代替。尚未结算的活动区间不计，异常关闭的最后区间需说明可能不完整。

### 策略调整次数
按 decisionId 去重统计真实 learning_strategy_calibrated 事件；要求有效 evidenceRefs、样本门槛以及真实参数变化。feedback 不是调整；刷新 projection 不是调整；冷启动或冷却期不计。

## 目前样本状态

| 指标 | 工程路径 | 当前云端样本 |
| --- | --- | --- |
| 计划执行率 | taskId / accepted plan | 样本不足，无已接受 plan/task |
| 独立通过率 | assessment / completed + hintsUsed | 样本不足，learning_events=0 |
| 延迟复习成功率 | Review Engine + 时间间隔 + 因果链 | 样本不足 |
| gap 修复率 | gapObservationId + Review chain | 样本不足 |
| 跨变体通过率 | competencyId + variantId | 样本不足 |
| 推荐接受率 | plan generated / accepted | 样本不足 |
| 学习耗时 | task transition durationSeconds | 样本不足 |
| 策略调整次数 | decisionId + evidenceRefs | 当前 0，cold-start 正常 |

H1 仅定义口径与证据来源，不建设 H2 完整评估中心。
