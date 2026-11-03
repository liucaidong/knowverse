# Phase F — 验收记录

最后核验：2026-11-03。下列 [x] 只代表相应代码路径与列明的自动化测试/远程数据库检查已验证。WebKit 移动视口不是物理 iPhone，浏览器隔离上下文不是两台真实设备。

## 产品功能
- [x] 基于真实评估事件计算个体间隔、稳定天数和复习状态；会话归并、提示/重试/失败/变体规则有测试。
- [x] 到期、逾期和 active gap 复习进入既有 Task Orchestrator；确定性 task ID、事件证据集合与重复刷新去重有测试。
- [x] 复习成功/失败经过现有 Review Engine、Task Orchestrator 因果证据门槛；浏览器 E2E 完成真实任务闭环。
- [x] 风险结合间隔、掌握状态、active gap、失败和先修依赖；没有展示未经校准的遗忘概率。
- [x] 薄弱点趋势基于 assessment/attempt 历史事件；不把页面访问或 Agent 对话当成学习证据。
- [x] 诊断覆盖停滞、重复失败、复习积压、学习过载、提示依赖和目标时间偏差。
- [x] 长期目标显示估算区间、置信度、时间变量、知识阻碍和按先修深度计算的专题里程碑。
- [x] Next Best Action 提供证据、解释、时间、延后影响和站内真实入口；Agent 本地规则和只读工具读取同一投影。
- [x] 事件驱动刷新有 event filter、去重/合并、in-flight 排队、CAS 投影；活动计划不被静默替换。
- [x] 驾驶舱、队列、风险、趋势、诊断、目标阶段和学习时间线已接入现有学习成长页面；Agent 摘要接入现有 Agent 页面；无第四顶层导航。
- [x] 时间线区分原始事件与系统派生风险快照。
- [x] 在线期间按下一 due 边界刷新；关闭浏览器不执行后台代码，重新打开后从真实事件补算。

## 数据与安全
- [x] 投影有 Schema/算法版本、source fingerprint、时间边界失效和可重建规则；v2 投影包含 timeline。
- [x] 域数据访问沿用 LearningRepository；新增文档复用 IndexedDB v4、Outbox、archive CAS，无新表和数据库版本升级。
- [x] Supabase migration 20261102190100_phase_f_proactive_projection 已应用；原表 RLS、用户隔离、authenticated JWT、active-device、payload 限制和 CAS 约束保持不变。
- [x] 远程 SQL 核验：sync_push_learning_documents 保持 SECURITY INVOKER / 空 search_path；authenticated 可执行，anon 不可执行；allowlist 已加入新文档类型。
- [x] Agent 不直接读写数据库；模型上下文使用有限投影摘要；模型输出仍通过原工具校验与用户确认边界。
- [x] 多次同事件/同 gap 证据和并发刷新不会重复推进间隔或无界创建复习任务（纯单元/集成和浏览器测试）。
- [x] 学习事件、原始错误、目标和任务历史不因投影重建或重规划删除。
- [ ] 两台真实设备同时在线并连接生产 Supabase 的冲突恢复尚未做物理设备实测；本地 repository/CAS 和 Playwright 隔离上下文测试不能替代此验证。

## 自动化验证
- [x] Phase F 纯算法、Repository、任务幂等、跳过历史、due 边界、并发刷新和投影 CAS 冲突恢复测试：12 项。
- [x] Phase E 学习者画像、目标/计划/任务/Agent 安全及主动投影 Agent 测试：16 项。
- [x] Phase D 学习存储、Learning Intelligence、复习证据链、计划、站点静态验证全回归。
- [x] Chromium 桌面 + WebKit 移动视口 E2E：学习驾驶舱、自动复习任务、答错/不同变体无提示通过/任务完成、Agent、计划、导航、离线恢复和 React Native 产品线。
- [x] 数据库 migration、RLS、函数授权和 Edge Function JWT 配置已远程核验。
- [x] 生产代码语法检查、生成器可复现性、内容验证与 git diff --check 通过。
- [ ] 物理 iPhone Safari 和真实第二台设备云端同步尚未测试。
- [ ] 云端模型 Provider 是否可用取决于用户外部 API 配置；本地规则模式可用，不将云端 Provider 描述为已配置。

## 交付
- [x] 设计、算法、数据模型、安全、事件管线、实施和验收文档已建立。
- [ ] 最终 Git Commit / push / GitHub Actions / Pages 生产 HTTP 验证待交付。