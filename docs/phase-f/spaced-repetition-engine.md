# Phase F — 自适应间隔复习引擎

## 目标
输出可解释的「稳定天数」与下次复习日期，不输出未经校准的遗忘概率。设计借鉴稳定性/难度的间隔思想，但不是 FSRS 拟合模型。掌握度和 gap closure 仍由 Learning Intelligence 独占。

## 事件归并
按 competencyId、sessionId、sessionType 归并 attempt、assessment_passed、completed、hint_revealed/hint。一轮会话内多次 attempt 不算多次独立复习。会话有有效 pass 则以 pass 的 scorePct、提示和 attempts 计算质量；无 pass 且存在错误 attempt 视为失败。浏览、Agent 对话、普通 task completed 不计入调度质量。

## 0–5 质量等级
- 5：score ≥95、无提示、首次通过。
- 4：score ≥85、无提示；或高分但有一次额外尝试。
- 3：score ≥70，或使用提示后通过。
- 2：score ≥60。
- 1：低分/辅助性成功。
- 0：本轮仅有失败 attempt。
提示、额外尝试和 independent=false 只能降低质量，不能提高质量。

## 稳定天数递推
S 是下一次复习间隔估算，不是概率，上限 60 天：
- 首次失败：S=0.5，下一次验证不晚于 1 天；若 Learning Intelligence 已记录 active gap，则立即进入 relearning / due now；若没有形成 gap 证据，则保持 learning，等到 dueAt 再进入 relearning。
- 质量 1–2：S=max(0.5, previousS×0.55)，至少安排 1 天。
- 质量 3：S=max(1, previousS×1.35)。
- 质量 4：S=max(2, previousS×1.8)。
- 质量 5：S=max(3, previousS×2.3)。
有 active gap 时必须 relearning / due now，普通成功不能绕过 gap 的独立因果验证。dueAt 从学习事件 occurredAt 推导，不从页面加载时间推导；间隔按 0.5 天取整。

## 状态
new：无有效评估；learning：初步证据；scheduled：未来 dueAt；due：到期但未超过一个计划间隔；overdue：超出一个完整间隔；relearning：最近失败或 active gap；stable：至少 3 次质量≥4的独立验证、跨日期和变体且无 active gap。稳定仍有下一次复习。

## 置信度
low：少于两次有效验证或单一日期/变体；medium：至少两次且日期/变体有差异；high：至少四次独立验证、至少两个日期和两种变体。它描述证据充分程度，不是成功率。

## 风险和边界
风险结合 elapsed/interval、mastery/status、active gaps、连续失败和先修风险。必须测试无效/未来日期、时间倒流、重复 event ID、缺失 score、同 session 多 attempt、提示、跨日、单一变体、部分 gap 解决、小样本和间隔上限。未知数据降级 confidence，不制造数值。
