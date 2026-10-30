# 历史会话笔记 · 主题总览

> 来源：2026-10-30 已恢复的个人知识库 v1 DOCX 内容摘录；这是一份既有摘要，不是原始对话逐字稿。

ES Promise 从原理到工程实践

专题 01 / JavaScript 与 ECMAScript

# 主题定位

状态机、Promise Resolution Procedure、微任务队列、链式返回、组合 API 与边界案例；保留逐题诊断和待巩固项。

# 关键词

Promise · thenable · resolution · 微任务 · Event Loop · allSettled · race · finally · AggregateError · async/await

# 当前状态

进行中｜第14课后复习

# 学习目标

从原理解释 Promise 状态机、resolution procedure、任务调度和 API 行为；能用代码独立推导日志顺序、状态与错误传播。

# 核心概念：状态与解决过程

Promise 只有 pending / fulfilled / rejected 三种状态，状态落定后不可反转。resolve(x) 不等于立即 fulfilled；当 x 是 thenable 或 Promise 时，要经过采用与后续的解决流程。

# 核心概念：微任务

同步代码先执行；队列中的 Promise reaction jobs、queueMicrotask 回调按各自实际入队顺序执行。区分「注册 then」「Promise 落定」「任务入队」「任务执行」。

# 核心概念：链式调用

每次 then/catch/finally 一般返回新的 Promise。回调显式 return 值可决定下游兑现值；无 return 则返回 undefined；throw 会导致下游拒绝；返回 Promise/thenable 时下游跟随其最终结果。

# 组合 API 对照

all：全部兑现才兑现，遇拒绝则拒绝；allSettled：等待全部落定并按输入顺序给出状态；any：首个兑现胜出，全部拒绝时给 AggregateError，其 errors 保留输入顺序；race：首个落定结果胜出。

# 重点边界

thenable 的 then 属性读取与 then 方法调用并非同一时机；同一个解决流程一旦采用 resolve(inner)，晚到的 reject/throw 不可再改变结果；finally 可能通过返回拒绝 Promise 覆盖原链命运。

# 最新复习状态（2026-10-24）

课程已到第14课，并开始每周螺旋复习。用户对状态判断和组合 API 有积累，但对「resolved 与 fulfilled 区别」「采纳 inner 时机」「微任务实际入队时机」仍应反复验证；不能仅据选择题正确认定已掌握。

# 微任务例题：复盘顺序

复杂 thenable + inner + race + M1/M2 代码题中，需使用逐帧时间线而不是仅凭输出猜测。之前纠错版指出：get 同步、call 异步；inner fulfilled 后，p 并非必然同一时刻 fulfilled；race 的日志时间不等于 race 本体落定时间。

# 巩固策略

每轮题目只给一题，先不展示答案；用户回答后按「执行顺序 → 任务入队 → Promise 状态 → 错误传播 → 工程启示」分层诊断。建议为每道题记录选项、原始推理、漏洞和再测结果。

# 已有可复用资料

Library 已有 promise_a_b_microtasks_animation.html 与 promise_microtask_corrected_animation.html；是可检查的重要示例文件，但不代表整个课程已完整归档。

# 原始资料与可信度

会话：2026-10-12 至 10-24，《ES Promise 从原理到工程实践》与螺旋复习

Library：promise_a_b_microtasks_animation.html

Library：promise_microtask_corrected_animation.html

本专题由可恢复历史对话线索组织而成；未读取的原始聊天/文件正文不作完整性声明。

# 后续维护记录

最后整理：2026-10-30 ｜待补充：原始链接、复习结果、新增案例、验证日期。
