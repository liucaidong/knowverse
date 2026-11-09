# Phase M：AI 练习题质量审查与正式题库准入

- 页面入口：既有针对性复习工作区 `/review/`
- 服务端：Supabase Edge Function `practice-quality-review`
- 官方题库：`content/review-assessments.json`
- 评估事实：现有 Review Engine 与 Learning Events V3，不改变其权威语义

## 1. 目标和证据边界

Phase M 将 Phase L 的开放式补充练习扩展为受控准入工作流：

```text
AI 候选练习 → 确定性校验 → 独立 AI Reviewer → 修改 / 重新审查
   → 真实授权人工批准 → 正式题库待发布 PR → 人工合并
   → GitHub Pages 部署 → 核验线上 registry → registered
   → 现有 Review Engine 正式测评 → Learning Events V3
```

必须区分：
- **候选练习**：原始开放式题目和首次作答，保存在个人私有文档中，不是正式 Assessment。
- **机器审查通过**：程序规则和独立 Reviewer 未发现阻止进入人工审查的问题，不是正确性证明。
- **人工批准**：只有真实 `content_admin` 审核员可执行；批准但未注册的题目仍不能进入正式测评。
- **已注册题目**：正式题库及公开 Pages 实际 JSON 已包含与待发布快照一致的题目。

候选生成、作答、自我检查、确定性校验、Reviewer 意见和人工审批均不写入 Learning Events V3，不得更新 mastery / confidence，也不得关闭 Gap。只有正式注册题目由现有 Review Engine 执行后，才会按原规则产生正式评估事件。

## 2. 现有正式测评契约

当前 `content/review-assessments.json` 的 Review Assessment 字段为：
`id`、`competencyId`、`topicId`、`gapIds`、`title`、`prompt`、`code`、`options`、`answer`、`hints`、`explanation`；正式题目提供 `difficulty`（`foundation` / `intermediate` / `stretch`）、`sourceHref` 和 `sourceLabel` 作为题目难度与教学来源元数据；Promise 课程题目另保留 `lessonId` 作为单元级索引。Review Engine 要求 `answer` 对应某个 `options[].id`；带有难度元数据的题目必须同时提供合法难度和有效知识来源路由。

Phase L 原始候选是开放式题目，因此不会直接转为带唯一答案的选择题。Reviewer 必须另行给出更窄、具有单一可辩护答案的 companion Assessment；原始开放式候选仍保留为私有档案内容。该 companion 仍需人工审核。

稳定正式 ID：`review-ai-<candidateId>`。发布脚本校验 schema、唯一 ID、competency / Gap 映射、答案与选项关系。

## 3. 服务端确定性校验

服务器不能仅相信浏览器传来的 JSON 或“历史候选题列表”：
1. 通过 Supabase JWT 验证的 user identity 确认调用主体。
2. 用受 RLS 约束的用户 client，从该用户的 `learning_archive_documents` 读取 `learner_profile / practice-candidate:<candidateId>`。
3. 将候选上下文、原始来源锚点及完整 exercise 与私有文档快照比对；未同步、已删除或不一致均拒绝审查。
4. 从同一用户的私有文档服务器端读取历史候选，进行重复检查；不依赖前端上报列表。
5. 读取 GitHub `main` 中的官方 `learning-map.json` 和 `review-assessments.json`，缓存 120 秒。

规则包括：
- competency 必须存在于指定 topic 下；Gap 必须存在并映射到该 competency。
- 必须恰好引用两个不同官方来源题；两个 ID 与创建候选时独立保存的 Phase L 原始锚点完全一致，且均属于当前 competency / topic / Gap。
- 校验标题、prompt、预期推理、参考答案、常见误区、两级提示、2–4 个 rubric 项、taskType 和 difficulty。
- 规范化文本相似度检查官方题目和历史候选；完全重复或高度相似时阻断，较弱的相似匹配作为 Reviewer 警告。
- 检测凭证泄露、明显破坏性命令、下载后直接交给 Shell 执行等高风险内容。
- 代码执行状态显式标记 `not_run`；本阶段不会在浏览器主线程或 Edge Function 内执行任意 AI 代码。

浏览器端确定性校验模块只用于即时反馈；服务端检查、官方来源快照和哈希才是审批依据。

## 4. 独立 AI Reviewer

Reviewer 仅能在确定性校验通过后运行。服务端要求专用 Reviewer API Key、Reviewer 模型名和生成模型名；拒绝 Reviewer 与生成模型同名。默认使用 OpenAI-compatible HTTPS `/chat/completions` 接口，并对结果作严格 JSON Schema 校验。

必需 Supabase Function Secrets：
- `PRACTICE_REVIEWER_API_KEY`
- `PRACTICE_REVIEWER_MODEL`（必须不同于 `AI_PROVIDER_MODEL`）
- `AI_PROVIDER_MODEL`

可选：`PRACTICE_REVIEWER_API_BASE_URL`（默认 OpenAI-compatible HTTPS endpoint）。

结果包括 `reviewId`、`candidateId`、`reviewerVersion`、`reviewedAt`、`verdict`、`riskLevel`、`overallAssessment`、`findings`、四个质量维度、`suggestedRevisions`、`reviewerLimitations` 和 `registrationAssessment`。每条 finding 包含 category、severity、description、evidence、suggestedFix。

Reviewer 必须主动查找反例、遗漏前提、歧义、多解空间、答案推理漏洞、教学问题、来源不一致、代码语义问题和题型兼容性问题；不能确认的内容标注 `unverified`。

**`pass` 仅表示未发现阻止进入人工审核的问题，不代表题目已被证明正确。** 当前没有隔离代码沙箱；不得宣称 Promise / 事件循环代码已经实际执行验证。超时、供应商错误、无效 JSON 或缺少配置会留下可追踪错误并恢复至可重试状态，不会批准或注册题目。

## 5. 候选题生命周期

状态保存在服务端审查记录的 `state` 追加记录中：

| 状态 | 含义 |
|---|---|
| `draft` | 未完成服务端确定性校验 |
| `validation` | 正在校验，或已通过、等待独立 Reviewer |
| `machine_review` | 独立 Reviewer 执行中 |
| `machine_reviewed` | Reviewer verdict 为 pass，等待人工批准 |
| `needs_revision` | 确定性校验或 Reviewer 要求修改 |
| `approved` | 真实审核员已批准，尚未发布 |
| `registration_pending` | 已准备正式发布，等待 PR / Pages 核验 |
| `registered` | Pages 实际题库核验通过 |
| `rejected` | 被机器 Reviewer 或已授权的人工审核员拒绝 |
| `deleted` | 未进入机器审查批准阶段的候选已删除 |

Postgres RPC 使用 advisory lock 和 expected status 检查并发状态转换。每次 validation、review、approval、rejection、publication PR 和注册都新增记录，旧记录不可覆盖。候选内容修改仅允许在尚未机器审查通过或进入审批/发布的阶段；修改后必须重新校验和审查。

## 6. 不可覆盖记录和访问隔离

新增：
- `private.practice_content_reviewers`：独立内容审核员名单，`role = content_admin`；只能由受信任数据库管理员配置。
- `public.practice_candidate_quality_records`：用户隔离的审查、状态、审批和发布审计记录。

Phase L 的 `learner_profile` 私有文档允许学习者本人更新，因此不能承担不可覆盖的审批事实。独立表由 RLS 保护；authenticated 角色没有 INSERT / UPDATE / DELETE 权限，service_role 仅被授予 SELECT，直接 INSERT / UPDATE / DELETE 均被撤销。写入只能通过受限 SECURITY DEFINER RPC 完成；RPC 的 EXECUTE 权限仅授予 service_role，且校验状态转换、审核员、审批证据和发布证明。追加与状态变更 RPC 仅授予 service_role。质量记录不暴露给其他学习者。

不得把 `private.authorized_users` 的普通云端档案访问权限混作审核员权限。服务端从已验证 JWT 获取 user_id，检查独立名单；浏览器自报角色无效。

## 7. 人工审批

批准必须同时满足：
- 当前状态是 `machine_reviewed`。
- 最新 validation 与 Reviewer pass 记录的候选哈希一致。
- reviewId 匹配。
- 当前 JWT 身份对应的 user_id 已在私有审核员名单中启用。
- 用户明确勾选风险告知并执行批准动作；默认不勾选。
- 数据库 RPC 再次验证审核员角色、reviewId、pass 记录及合法状态转换。

审批提示必须告知：AI 审查不是事实证明；注册后题目会进入正式测评，学习者作答可能影响掌握度评估。未授权用户看不到可用的审批按钮；直接调用接口也必须由服务端拒绝。

## 8. 正式题库安全注册

GitHub Pages 是静态站点。浏览器不能修改 `content/review-assessments.json`，也不会得到 PAT / service-role key。

人工批准后，`prepare_registration` 只追加待发布快照并返回受保护工作流入口。维护者在 GitHub Actions 手动触发 `Publish Approved Practice Candidate`：
1. 从 Supabase 不可变审计重新核对 validation、独立 Reviewer、人工批准、哈希和状态。
2. 验证新题目契约、ID 唯一性、官方 competency / Gap 映射。
3. 将正式题目和追踪 manifest 写入 Git 分支，创建 PR，不自动合并。
4. 追加 publication PR 审计。
5. 维护者审阅并合并；原有 Pages workflow 部署。
6. 仅在成功的 main Pages workflow 后，独立核验工作流读取线上 `/content/review-assessments.json`，与仓库题目逐字段比较。
7. 核对待发布快照、候选哈希、审批记录和 Review 记录后，调用幂等 finalizer 写入 `registered`。

相关脚本：
- `scripts/prepare-approved-practice-publication.mjs`
- `scripts/record-practice-publication-pr.mjs`
- `scripts/verify-and-register-published-practice.mjs`

必需 GitHub Repository Actions Secrets：
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

若 Secrets 未配置，流程 fail closed / 保持 pending；不回退为浏览器凭证，也不伪造 registered。

## 9. Edge Function 安全

- 函数名：`practice-quality-review`
- `supabase/config.toml` 保持 `verify_jwt = true`。
- 使用 `withSupabase({ auth: "user" })`；用户私有档案读取走 RLS user client，受保护审计写入走 service-role RPC。
- 限制请求和候选快照大小，校验 Origin / HTTP 方法，响应采用 no-store / nosniff。
- 不覆盖原有 `learning-agent` 函数；其 JWT 验证继续保持开启。
- service-role key、Reviewer API Key 不得进入公开 JS、HTML 或静态资源。

## 10. 测试命令

```bash
deno check supabase/functions/practice-quality-review/index.ts
node --check assets/js/learning-practice-quality-review.mjs
node --check assets/js/learning-practice-quality-validator.mjs
node --check assets/js/review-workspace.mjs
node --test scripts/verify-learning-practice-candidates.mjs
node --test scripts/verify-learning-practice-quality.mjs
node --test scripts/verify-phase-m-audit-order.mjs
node --test scripts/e2e-phase-l-practice-candidate.mjs
node --test scripts/e2e-phase-m-practice-quality.mjs
```

E2E 使用 Mock Reviewer 仅验证页面交互、生命周期、权限门禁、重复注册和响应式布局；不代表真实模型质量或生产 Reviewer 可用。真实云端 Reviewer 需独立 Secrets 和不同模型；真实人工审批需管理员单独 provision `content_admin`；发布需配置 GitHub Actions Supabase Secrets 并人工合并 PR。

## 11. 部署检查表

- Supabase 六条 Phase M 迁移与本地 migration 文件名/版本完全一致。
- Edge Function ACTIVE 且 `verify_jwt=true`。
- Reviewer Secrets 完整，模型与生成模型不同。
- 至少一名审核员由数据库管理员单独授权。
- GitHub Repository Actions Secrets 已配置。
- Validate 与 Pages workflow 成功。
- 线上 Pages assessment JSON 包含新题目后，才将状态标记为 registered。

最终验收必须分别核对真实 Reviewer 请求记录、审核员 user_id 的独立授权、PR 审计、Pages 实际 JSON 和注册 RPC 返回；浏览器 Mock E2E 不覆盖这些生产凭证和外部动作。

Mock 测试、静态检查和代码推理不得描述为真实 AI 模型审查、真实人工审批或生产注册成功。
