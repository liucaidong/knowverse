# Phase F — 事件驱动规划

## 触发
评估/挑战/复习（attempt、completed、assessment_passed、review_started、hint_revealed）；目标 lifecycle；偏好更新；任务 created/in_progress/paused/completed/failed/skipped/cancelled；dueAt 到期；页面重新打开和当前计划过期。

## 处理
验证事件 envelope → eventId 去重 → 短周期批处理 → 读取 Repository 事件/目标/偏好/任务 → 计算 fingerprint、algorithm versions 和时间桶 → 复用或重建派生投影 → 为 due/relearning 项目幂等创建任务 → CAS 保存投影 → 必要时创建 plan proposal → UI 刷新。

## 幂等和并发
事件 ID 和不可变事件记录防止重复应用；projection/current 用单文档 CAS；任务 ID 由 competency + gap + due cycle 稳定生成；同范围活动任务复用，失败任务保留并允许 retry。事件重算进行中到达时需排队处理；CAS 冲突有限重读/重试，不覆盖他设备更新。错误不得回滚原始事件或删除历史。

## 计划关系
调度和 NBA 可以自动刷新；已接受计划、完成任务和事件不被静默覆盖。新计划写作 proposal，带原因、版本和 supersedes 指针；用户接受才更新 activePlanId、创建任务。拒绝和替换均留历史。

## 运行范围
GitHub Pages 无常驻服务。浏览器在线时处理事件；关闭期间不执行。重开时从真实事件恢复并补算。本阶段不加 Cron/后台定时器，也不把 setTimeout 描述成服务器调度。
