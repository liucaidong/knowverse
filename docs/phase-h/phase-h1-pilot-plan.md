# Phase H1 ES Promise 真实学习试点计划

## 试点范围和图谱复用

使用 content/learning-map.json 的 Promise topic 和五个现有 competency，不增加平行系统或重复节点。

| 试点知识方向 | 已有节点 / 课程 | 已有 challenge |
| --- | --- | --- |
| Promise 状态与不可逆性 | lesson-01、lesson-02；resolve lock 语义与 thenable-adoption 衔接 | thenable-adoption |
| Promise Resolution Procedure | thenable-adoption / lesson-03 | thenable-adoption |
| Thenable 识别与采用 | thenable-adoption / lesson-03 | thenable-adoption |
| 链式调用与错误传播 | chain-error-propagation / lesson-05、lesson-06 | chain-error-recovery |
| 微任务调度 | microtask-scheduling / lesson-04 | microtask-fifo |
| 组合 API | combinator-semantics / lesson-08 至 lesson-11 | combinator-semantics |
| 复杂执行时序 | integrated-execution-model / lesson-14 | integrated-timeline |

五节点先修：thenable-adoption → microtask-scheduling → (chain-error-propagation, combinator-semantics) → integrated-execution-model。状态机和 catch/finally 是现有课程覆盖，不新增重复节点。

## D0 云端基线

截至 2026-11-03：cloud learning_events 0；strategy cold-start/evidence 0/history 0；projection sourceEventCount 0；无云端目标、计划、task、review 文档。promise-realm 旧游戏文档 stage=0、三个 done=false，只是存档不是掌握证据。用户本机 IndexedDB 未读取，必须由真实设备先检查，不能被云端状态替代。

## D1 真实学习

1. 真实设备打开 /agent/，核对既有目标/数据；不要重置。
2. 创建或确认一个 ES Promise 目标，关联 Promise topic 和上述五个现有 competency；每日预算按实际可投入时间填写。
3. 生成计划提案，检查前置依赖、分钟数和推荐依据；学习者明确接受。
4. 从计划打开课程；在标题下 reader task panel 点击开始；阅读后可暂停/恢复；完成由学习者点击确认。
5. 打开实际挑战并按真实理解答题；不为制造 gap 故意答错；提示使用如实记录。
6. 在 /progress/ 检查活动、attempt、hint、task 状态与 gap 关联。

## D2 薄弱点修复

只针对真实错误产生的 gap；从 /progress/#weak-points 进入针对性复习。提示辅助通过应为 pending-verification，不能提早关闭。若没有错误就继续学习，不要人为创建弱点。

## D3 独立验证

在 /review/ 进入原 competency / gap，换不同 variant、无提示独立作答。只有原 gapObservationId、不同 variant、hintsUsed=0 和完整 causationEventIds / targetGapEventIds 关联通过才能关闭。失败继续作为事实保留。

## D4–D7 延迟复习

按 D1 的真实日期顺延；等系统到期，不修改设备时钟或回填历史时间。至少 2 天后开展无提示回忆及不同变体验证。记录失败/通过、复习耗时、decisionId、原证据引用和下一轮排期。若 D1=2026-11-03，则 D4 是 2026-11-06；若实际起始日不同，日期随之顺延。

## 试点日志字段

真实日期、设备、goalId、planId/version、taskId、competencyId、challengeId、stepId、variantId、sessionId、hintsUsed、gapId、gapObservationId、review session、targetGapEventIds、causationEventIds、strategy decisionId、实际 durationSeconds、同步状态。只使用系统生成的 ID 和真实事件。

## 停止条件

任务与课程知识点/路由不匹配时不要提交；账户或同步冲突时停止第二台设备写入；课程页未显示 task panel 时不要把普通阅读当作计划任务完成；网络离线时保留本地事实并等待 Outbox 同步确认。
