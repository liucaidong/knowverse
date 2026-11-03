# Phase K：苏格拉底式教学与私有学习反思

- 日期：2026-11-03
- 范围：页面上下文 AI 导师 + 私有学习档案
- 数据策略：复用现有 learner_profile 文档；无新 SQL 表、迁移、事件类型或评估注册表

## 目标

把 AI 导师从“回答问题”扩展为“围绕当前能力点引导学习者自己推理”，并让学习者能够主动保存理解变化。该能力补充而不替代现有的知识图谱、独立评估、学习事件与掌握分析。

## 苏格拉底式导师

新增模式：苏格拉底引导。

- 每轮只提出一个简短问题，先读取学习者当前的解释或预测。
- 通过解释、预测、证据和边界条件推进推理；根据上一轮回答调整后续问题。
- 不一次生成问题清单，不直接交付完整推导或最终答案；学习者明确请求解释，或已经尝试但无法继续时，才逐步给出最小提示。
- 保持 tutor 服务端只读契约：模型输出只允许文本回复，所有工具建议与额外数据请求在服务端被丢弃。
- 云端请求仍需有效 JWT、已授权账户及逐条同意；摘录仍需第二次单独勾选。
- 对话不产生学习事件，也不更新学习计划、Gap、掌握度或置信度。

## 结构化反思档案

导师侧栏新增可折叠的自愿反思表单：

1. 开始前，我原本怎么理解？
2. 现在，哪一点理解发生了变化？
3. 还有什么不确定？
4. 准备怎样在新情境中验证？

只有学习者主动保存才会写入。四个字段各限制 2,000 字；至少填写一项。可查看当前能力点相关的最近五条记录，并进行编辑、删除。

### 持久化与同步

- 类型复用 learner_profile，独立 key 前缀为 learning-reflection:，与现有 preferences 等文档键隔离。
- 使用既有 IndexedDB / LearningRepository 账户边界、同步队列、跨设备冲突机制。
- 更新和删除均附带 expectedLocalRevision，检测过期写入，不以静默覆盖处理冲突。
- 删除采用同步安全的软删除文档；列表过滤 tombstone。
- 反思文本不进入 AI 上下文，不自动发送到云端 AI；仅随用户已授权的档案同步能力同步。
- 不追加任何 Learning Events V3 事件，不进入周回顾，不进入 mastery / confidence / gap reducer，不作为评估证据。

## 安全与边界

- 本功能没有放宽 learning-agent Edge Function 的 verify_jwt=true。
- socratic 只加入 tutor mode allowlist；不属于 Agent 工具模式。
- Tutor 仍接受受限的 scene/context 字段，不接受任意页面全文。
- 文档使用用户既有的 RLS / archive RPC 账户隔离；未新增公开表或权限策略。
- 反思内容是学习者自述，不由模型生成或评分；系统不会从反思内容推断掌握度。

## 自动化验证

- scripts/verify-learning-reflections.mjs：4 项，覆盖私有文档 round-trip、无 Learning Event、长度/非空约束、CAS 并发冲突、编辑和软删除隔离。
- scripts/verify-learning-tutor.mjs：覆盖 Socratic provider mode、上下文边界和服务端 tutor 工具剥离契约。
- scripts/e2e-phase-k-learning-loop.mjs：Chromium 桌面验证 AI 请求授权、单问模式、反思保存/编辑/删除和不产生掌握事件；WebKit 390px 验证移动端表单。
- 原有 Tutor 与 Weekly Review 浏览器回归继续保留。

## 未宣称完成的事项

自动化测试不替代真实学习者试点，也不证明 Socratic tutor 提高了学习效果。真实云端回复依赖 Supabase 服务端 AI Provider 环境变量及获准账户；用户账户级体验仍可后续单独验收。反思数据的云端双设备冲突行为由既有 archive sync 协议承载，本阶段以本地 CAS 与浏览器 E2E 验证其写入路径。
