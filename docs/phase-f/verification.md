# Phase F — 实施与验证记录

## 交付范围

- 新增自适应间隔复习、遗忘风险、薄弱点趋势、目标预测、学习诊断和 Next Best Action 纯函数模块。
- 新增 Repository-backed Proactive Learning Engine，生成带 schema/algorithm version 和 source fingerprint 的可重建 projection。
- 复用 Task Orchestrator 创建确定性、可去重的到期复习任务；Review Workspace 继续使用原有因果证据校验。
- 接入现有学习成长驾驶舱与 Agent Workspace；加入目标专题里程碑和原始事件/派生风险时间线。
- 新增 Supabase migration，只扩展已有 archive document type constraint 和 sync_push_learning_documents allowlist；没有新建数据库表。
- 保留现有三条产品主线、导航层级和 Phase D/E 单一事实来源。

## 关键设计决策

1. Learning Events 仍是原始事实唯一来源；Learning Intelligence 仍是 mastery/gap 权威；Knowledge Map 仍是先修关系权威。
2. 投影只是可丢弃、可重建的缓存，放入现有 learningDocuments；沿用 IndexedDB v4、Outbox、LearningRepository 与 CAS。
3. 复习间隔按真实评估会话质量递推；提示、额外尝试和失败不会被当成独立高质量掌握证据。
4. 风险等级是调度优先级，不输出未经个人历史校准的遗忘概率。
5. 复习任务由 competency、gap、当前未解决原始错误集合或 due cycle 确定 task ID；跨设备写入时间基于来源证据确定。
6. 投影 CAS 冲突有限重读重算；非版本冲突不盲目重试。
7. 事件驱动只在页面打开或浏览器在线时运行；关闭浏览器后不承诺后台任务。
8. 目标、偏好和活动计划不会被模型或后台投影静默修改；计划仍须显式接受。

## 测试与构建

以下命令均在接管的 Mac 仓库中执行，最终代码版本全部通过：

- 静态构建：build-public-content、build-site-shell、build-search-index、build-monorepo-graph；生成结果复现检查通过。
- 内容与架构校验：validate-content、validate-v2、validate-site-architecture、validate-promise、validate-monorepo-deep、validate-monorepo-product。
- 原有站点、Promise、Monorepo、Learning Intelligence、LearningRepository、任务编排、计划、Agent 测试全部通过。
- Phase E 测试：16 项通过，包含 local Agent 与只读工具读取同一主动学习投影。
- Phase F 测试：12 项通过，覆盖会话归并、质量等级、稳定间隔、风险/先修传播、趋势、诊断、目标 forecast/milestone、NBA、Repository 投影、任务幂等、跳过历史、due 时间边界、并发刷新和 CAS 冲突重算。
- 浏览器 E2E：7 组脚本、16 项通过；覆盖 Chromium 桌面和 WebKit 移动视口。主动复习 E2E 从真实错误证据进入驾驶舱，领取带 taskId/gapId 的复习任务，经过失败、不同变体无提示通过，并验证 Task Orchestrator 完成状态及审计事件。
- 所有新旧核心模块 node --check 通过，git diff --check 通过。

## Supabase 核验

- 项目：knowverse（sxcpareycpokcyroufww），migration：20261102190100_phase_f_proactive_projection。
- migration 已应用；learning_archive_documents 继续启用 RLS，用户隔离与 authenticated 授权条件未放宽。
- sync_push_learning_documents 保持 SECURITY INVOKER 和空 search_path；authenticated 有执行权限，anon 无执行权限；新文档类型仅加入既有白名单。
- learning-agent Edge Function 未改变，verify_jwt 仍启用。

## 未验证事项与限制

- Playwright WebKit 移动视口不等于物理 iPhone Safari；本阶段未进行物理 iPhone 实机测试。
- 离线恢复/CAS E2E 使用浏览器隔离上下文；没有两台真实设备同时连接生产 Supabase 的实机冲突测试。
- 本阶段没有引入 Supabase Cron；关闭浏览器期间不会主动执行。
- 本地规则 Agent 已接入主动学习投影。云端 Provider 仍取决于用户的外部 API secret/configuration，本次未伪造其配置成功。
- GitHub Commit、push、Actions 与 Pages HTTP 的最终状态以本次提交后的远程结果为准。