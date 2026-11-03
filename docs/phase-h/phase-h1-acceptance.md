# Phase H1 验收状态与 H2 准入

结论：工程建设已完成，自动化验证已完成，真实学习试点已准备；真实学习数据尚待学习者采集，Phase H1 真实试点未验收完成。

## 验收表

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| Phase G Annotated Tag 冻结 | 完成 | phase-g-stable-20261103 -> d31532e72b5aacd3097cfe34596c5d47a6690862 |
| 真实学习闭环代码审计 | 完成 | 目标/画像/planner/challenge/gap/review/strategy/sync 源码 + Supabase 只读核验 |
| Promise 阅读任务断链修复 | 完成 | 20 节 integration + route/类型/知识点校验 |
| 阅读完成不作为掌握证据 | 自动验证通过 | evidenceEventIds 为空，无 mastery assessment event |
| Node 核心测试 | 完成 | 158 passed / 0 failed |
| Chromium / WebKit E2E | 完成 | 22 passed / 0 failed |
| D0 云端基线 | 完成 | 0 cloud events、3 archive docs、cold-start |
| D0 本机 IndexedDB 检查 | 待真实设备 | 未读取用户现有浏览器 profile |
| D1 目标/接受计划/真实阅读/答题 | 待学习者 | 禁止自动代做 |
| D2 gap 修复 | 待真实错误 | 不人为制造 gap |
| D3 不同变体无提示验证 | 待学习者 | 需要真实评估事件 |
| D4-D7 延迟复习 | 待真实日期 | 不允许回填记录 |
| 真实 Mac / iPhone 生产同步 | 待设备验收 | 自动化 fixture 不是实机证据 |
| H2 | 暂不准入 | 生产云端没有真实学习样本 |

## H1 真实试点完成条件

1. 一个真实 ES Promise 目标存在且绑定现有知识图谱。
2. 学习者接受一个计划并产生正式任务。
3. 至少一个真实课程阅读任务完成，且 execution / mastery 清晰区分。
4. 至少一个真实挑战或 checkpoint 产生可追溯评估事件。
5. 若出现错误，按原 gap 进行 targeted repair；没有错误时不伪造。
6. 至少一个不同 variant、无提示的独立验证。
7. 至少一次间隔 2 天以上的真实延迟复习。
8. 真实设备同步检查无重复事件、旧数据覆盖或跨账户泄漏。
9. 指标分子和分母可回溯到真实事件，样本不足显式显示。

## H2 准入门槛

至少完成一个真实 D1-D7 周期；两个不同日期的独立验证和不同 variant 有可追溯证据；延迟复习以真实时间通过；gap（如存在）按原观察关闭；生产同步无重复/CAS 丢失/账户串扰；指标具备样本量和限制说明。达到这些条件后，再基于试点数据决定 H2 评估中心的最小设计。本期不提前建设。
