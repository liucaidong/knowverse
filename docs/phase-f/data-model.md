# Phase F — 派生数据模型

## 原始事实
挑战、评估、复习、任务生命周期、目标审计和用户偏好沿用 Phase D/E。事件 append-only，显式 causationEventIds/targetGapEventIds 保留因果关系。掌握度、confidence、active gaps 仍完全由现有 Learning Intelligence 推导。

## 新增 projection 文档
类型 `proactive_learning_projection`，key `current`，写入 LearningRepository documents。字段：
- schemaVersion、algorithmVersions、sourceFingerprint、sourceEventCount、latestEvidenceAt、computedAt。
- schedules[]：competencyId、status、lastEvidenceAt、dueAt、intervalDays、stabilityDays、successfulReviewCount、failureCount、confidence、evidenceRefs。
- risks[]：competencyId、level、overdueDays、riskRatio、reasons、evidenceRefs、prerequisiteRiskRefs。
- trends[]：competencyId、direction、window summary、gap lifecycle、evidenceRefs。
- diagnostics[]：id、severity、title、reason、evidenceRefs、recommendation。
- goalForecasts[]：goalId、progress、remainingMinutesEstimate、earliestDate、latestDate、confidence、blockers、variables，以及按先修深度排序的 topic milestones（稳定掌握数量、阶段状态和阻碍）。
- timeline[]：基于真实目标、计划、任务、挑战、评估和复习事件的时间线；当前风险快照标记为 derived，不伪装成原始事件。
- nextBestActions[]：id、type、score、title、competency/topic、taskId、href、estimatedMinutes、reasons、evidenceRefs、expectedOutcome、deferImpact、confidence。

控制数组数量及字符串长度，确保 payload 不超过已有 65,536-byte archive 上限。不复制整份事件日志。

## 重建与缓存
指纹涵盖事件内容/ID、目标和偏好 revision、注册表提示版本、算法版本和小时计算桶。输入或算法版本变更、缓存损坏/缺失时，完全从事实重建。相同输入与 now 得到相同结果。

## 复习任务
沿用 `learning_task` 文档与既有字段；可附 scheduleId / dueAt。taskId 由 competency + gap + due cycle 确定。创建前查询同范围任务：活动任务复用、failed 任务可重试、同一 due cycle 完成任务不重复创建，新的有效评估形成新周期。

## 并发与离线
重复事件由事件 ID/fingerprint 幂等；同设备并发以 in-flight 合并；多设备 projection/current 采用 CAS，不使用 last-write-wins；冲突时有限重读/重算。离线事实/任务仍写本地 Outbox，网络恢复沿用既有 sync。删除目标保留事件和历史证据，投影只停止将其视为活动目标。
