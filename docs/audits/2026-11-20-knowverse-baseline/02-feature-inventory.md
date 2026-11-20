# 02 · 功能清单（2026-11-20）

以 `content/routes.json`（63 canonical routes）+ `content/navigation.json`（4 个一级工作区）为骨架，结合历史 `feature-inventory.json` 与本轮实测分类。

## 一级工作区（4 个）

| 工作区 | 入口 | 职责 | 状态 |
|---|---|---|---|
| 开始学习 | `learning.start` / `learning.agent` | 学习驾驶舱、Personal AI Learning Agent（目标/计划/任务/离线恢复） | COMPLETED（本地 E2E 通过） |
| 知识库 | `knowledge.overview` | 12 专题、35 Concept、来源、全景图、能力图谱 | COMPLETED（覆盖边界公开声明） |
| 实践中心 | `experience.overview` | 原理实验室 / 沉浸展厅 / 知识解谜 三种方式，17 作品 | COMPLETED |
| 我的进度 | `learning.overview` | 今日计划、掌握图谱、薄弱点、复习工作台、历史、档案 | COMPLETED（云端闭环 P1 除外） |

## 核心功能状态

- 学习闭环：目标→计划→任务→证据→掌握→Gap→复习→再评估——本地合成学习者全链通过（4.1 记录 + 本轮单测/E2E 复核）。
- 页面上下文 AI Tutor：只读苏格拉底引导，契约测试 + E2E 通过；真实模型受 Production secrets 阻塞（BLOCKED）。
- Gap 定向 AI 练习候选 + Phase M 质量门禁：确定性校验、独立 Reviewer、不可覆盖审查记录、人工审批发布链——本地实现与测试通过；真实 Reviewer secrets / 审批闭环需配置（PARTIAL）。
- 跨设备同步：IndexedDB v4 + Supabase 原子批次 + RLS/RPC；PG17 集成测试（幂等/CAS回滚/跨账号隔离）本轮实跑通过；Staging 首设备恢复通过，第二物理设备/实体 iPhone Safari 未验（PARTIAL）。
- 搜索：确定性全文索引 134 条；可复现性通过。
- Monorepo / React Native 教学域：图依赖、affected closure、关卡门禁、原生配置校验通过。

## 分类汇总

- COMPLETED：导航/搜索/内容/三实践主线/本地学习闭环/规划/复习/反思/周回顾。
- PARTIAL：跨设备真实多端、AI 内容发布真实审批闭环。
- BLOCKED：Production 真实 AI Provider 能力、实体设备验收、云端 review task 闭合（KV41-010）。
- NEEDS_VERIFICATION：其余 8 专题的细粒度能力图谱（已补 12/12 覆盖，但深度不及前 3 专题）。

无 UI_ONLY（纯静态冒充功能）或 BROKEN（页面不可访问）项被本轮发现；`/auth/` 404 为预期（真实入口为全局账户控件与 `/auth/callback/` 200）。
