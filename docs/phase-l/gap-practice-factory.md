# Phase L：Gap 驱动的 AI 补充练习工厂

- 日期：2026-11-04
- 入口：既有针对性复习工作台 `/review/`
- 数据策略：复用 `learner_profile` 私有文档；不新增 SQL 表、迁移、事件类型或正式 Assessment 变体

## 目标

当学习者出现仍未解决的具体 Gap 时，让 AI 帮助设计一份新的、开放式、未评分的补充练习。练习以当前能力点、Gap 和两个正式题目变体为知识锚点，但不能取代正式复习与独立评估。

## 体验路径

1. 正式挑战产生带 competencyId、gapId 的错误事件。
2. 学习者从该 Gap 进入复习工作台；系统重新读取事件并确认 Gap 仍未解决。
3. 系统解析该 Gap 对应的两个正式 Review Assessment 变体，提取必要的题目场景、选项和解释作为受限上下文。
4. 学习者勾选本轮授权后，请求只读 Learning Tutor 的 practice 模式；不授权时不发送请求。
5. AI 返回纯 JSON 候选草案；客户端按正式注册表和本地草案记录执行 Schema、来源、重复与近期题型校验。
6. 通过校验后保存为私有草案。学习者先写自己的推理，提交后才显示模型参考思路和自我检查要点。
7. 需要证明掌握时，仍使用正式复习工作台的注册 Assessment 变体，并由既有 Review Engine 写入独立评估事件。

## 候选题契约

每个候选必须有 title、taskType、prompt、stimulus、difficulty、expectedReasoning、exemplarAnswer、commonTrap、恰好两条 hints、2–4 个 rubric 检查点，以及恰好两个 sourceVariantIds。

允许 taskType：predict、trace、diagnose、transfer、explain。
允许 difficulty：foundation、intermediate、stretch。

客户端校验包含：

- 禁止额外字段或字段缺失。
- 两个来源必须是不同的正式变体，并属于当前 competencyId + gapId。
- 如果该 Gap 有近期未使用的正式来源，至少引用一个未近期使用的来源。
- 候选任务不能与来源题目完全重复（规范化空白和标点后比较）。
- 不允许与当前 Gap 已保存草案重复。
- 必须提供恰好两级提示和 2–4 个 ID 不重复的推理检查点。

候选不是正式题库对象：不创建正式 variantId、answer key、score 或 Assessment Registry 项，也不允许据此写入评估结果。

## 私有持久化

- 文档类型复用 `learner_profile`。
- 独立 key 前缀：`practice-candidate:`；purpose 为 `learning_practice_candidate`。
- 状态从 `draft` 变为 `attempted`；首次作答只保存一次，不覆盖。
- 使用既有 Learning Repository、账户隔离、文档 revision 与软删除 tombstone。
- 候选保存当前 competency/gap/topic、创建与更新时间、练习正文、学习者第一次作答与作答时间。
- 删除仅影响对应候选，不触碰 preferences 或其他学习档案。

## 评估与数据边界

- AI 草案及其参考答案都未经过正式评估审核。
- 学习者提交候选答案只更新私有候选文档，不追加 Learning Events V3。
- 候选没有正式 variantId，因此不能成为独立复习变体或 mastery evidence。
- 不写 mastery、confidence、Gap resolution、review history 或 plan task evidence。
- 只有正式 Review Engine 从 `content/review-assessments.json` 选择正式变体，才可创建 attempt / assessment_passed 事件。
- 每次 AI 生成前需要一次性明确授权；只发送当前 Gap、能力摘要和两个正式题目锚点，不发送任意页面全文。
- 正式评估关闭 Gap 后，候选生成入口禁用；历史草案仍可查看或删除。

## 代码与自动化

实现：

- `assets/js/learning-practice-candidates.mjs`：候选 Schema、JSON 解析、私有存储、首次作答和删除。
- `assets/js/review-workspace.mjs`：Gap 资格检查、单次 consent、AI 请求、候选展示、自我检查。
- `review/index.html` 与 `assets/css/review-workspace.css`：复习页候选练习面板。
- `assets/js/learning-agent/agent-provider.mjs` 与 `supabase/functions/learning-agent/index.ts`：只读 tutor practice 模式。

验证：

- `scripts/verify-learning-practice-candidates.mjs`：Schema、来源归属、近期来源、重复、私有存储、首次作答、软删除和无 Learning Event。
- `scripts/e2e-phase-l-practice-candidate.mjs`：
  - Chromium：Gap 绑定、明确授权、草案保存、作答、参考思路和事件数量不变。
  - Chromium：正式无提示独立复习纠正 Gap 后，候选生成禁用且不请求 AI。
  - WebKit 390px：移动端候选面板布局。

## 未完成 / 不作承诺

- 参考思路是模型输出，不代表题库审校或事实认证；本阶段不进行 AI 自动判分。
- 真实 AI Provider 回复仍依赖 Supabase 服务端环境变量、有效 JWT、获准账户与逐次授权。
- 浏览器 E2E 使用模拟 Provider 响应，只验证交互链路、权限边界和本地存储，不证明真实模型生成质量或学习效果。
- 成为正式评估题前仍需人工/规则审校、答案验证、独立 variant 注册与正式评估测试；本阶段没有自动发布能力。
