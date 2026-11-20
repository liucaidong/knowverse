# KNOWVERSE 生产配置操作手册

状态：操作指南（需授权项由维护者本人执行）。本手册只描述变量名、路径与步骤，**不包含任何密钥值**。AI 密钥不得写入聊天、Git 或任何提交物。

适用阻塞项：`KV41-004`（Production AI Provider secrets 缺失）、`KV41-007`（Auth leak-password protection 未开启）。
生产项目 ref：`sxcpareycpokcyroufww`（`knowverse`）。Staging ref `ypthoicwrfsblaidllyy` 已在 2026-11-20 确认全部 secrets 就位，不在本手册范围。

---

## 1. KV41-004 · 配置生产 AI Provider secrets

### 1.1 变量契约（来自源码，勿改名）

| 变量 | 用途 | 读取位置 | 必填 |
|---|---|---|---|
| `AI_PROVIDER_API_KEY` | 候选生成 / Tutor / Agent 的 Provider 凭证 | `learning-agent/index.ts:283` | 是 |
| `AI_PROVIDER_MODEL` | 候选生成模型 ID | `learning-agent/index.ts:284`、`practice-quality-review/index.ts:571` | 是 |
| `AI_PROVIDER_BASE_URL` | Provider API 根地址，默认 `https://api.openai.com/v1` | `learning-agent/index.ts:285` | 否 |
| `PRACTICE_REVIEWER_API_KEY` | 独立 Reviewer 凭证（须与生成侧隔离） | `practice-quality-review/index.ts:569` | 是 |
| `PRACTICE_REVIEWER_MODEL` | 独立 Reviewer 模型 ID | `practice-quality-review/index.ts:570` | 是 |
| `PRACTICE_REVIEWER_API_BASE_URL` | Reviewer API 根地址，默认同上 | `practice-quality-review/index.ts:572` | 否 |
| `KNOWVERSE_CONTENT_REF` | Reviewer 校验用的内容基线 ref，默认 `main` | `practice-quality-review/index.ts:188` | 否（建议 `develop`） |

### 1.2 硬约束（源码会直接拒绝）

- `PRACTICE_REVIEWER_MODEL` **必须不同于** `AI_PROVIDER_MODEL`，否则 Reviewer 返回 503（`index.ts:576`）。不得用生成模型替代独立审查。
- `PRACTICE_REVIEWER_API_KEY`、`PRACTICE_REVIEWER_MODEL`、`AI_PROVIDER_MODEL` 任一缺失，Reviewer 返回 503（`index.ts:574`）。
- Learning Agent 模型须支持 JSON object response format；Reviewer 模型须支持 `response_format: json_schema` 严格结构化输出。
- **practice 模式额外约束**：`tutorMode=practice` 时，模型须严格返回 11 字段练习对象（`title/taskType/prompt/stimulus/expectedReasoning/exemplarAnswer/commonTrap/hints/rubric/difficulty/sourceVariantIds`，其中 hints 恰好 2 条、rubric 2–4 条且字段精确）。该模型能力不足会返回 502 `AI_INVALID_OUTPUT`（见 KV41-011）。应选用能稳定输出严格 JSON schema 的生成模型，不要为过测放宽服务端校验。
- Base URL 必须是 HTTPS API 根地址（如 `https://api.example.com/v1`），不含查询参数/片段，不带 `/chat/completions`。
- 建议 Reviewer 使用独立凭证，隔离权限与额度。

### 1.3 执行（维护者本人，在 Supabase Dashboard）

1. 打开 Supabase Dashboard → 项目 `sxcpareycpokcyroufww`（**核对 ref，勿误选 Staging**）→ Edge Functions → Secrets。
2. 逐个添加上表变量。密钥值由维护者从凭证源填入，不经过聊天/仓库。
3. `KNOWVERSE_CONTENT_REF` 填 `develop`（与当前发布分支一致）。
4. 保存。Edge Functions 会热加载新 secrets，无需重新部署函数。

等价 CLI 方式（可选，仅当已具备生产写权限并明确授权）：

```bash
# 通过 0600 权限的临时 env 文件传入；终端不回显值
supabase secrets set --env-file <0600-env-file> --remote=sxcpareycpokcyroufww --yes
supabase secrets list --remote=sxcpareycpokcyroufww   # 只列名称/摘要
```

> 仓库脚本 `scripts/configure-staging-ai.sh` **仅允许 Staging**，不可用于生产。

### 1.4 只读验证（配置后，不产生模型调用费用）

```bash
supabase secrets list --remote=sxcpareycpokcyroufww   # 确认上表变量名全部出现
```

判定：7 个变量名均出现即通过。CLI 只显示名称与摘要，不显示值——不要尝试导出值。

真实模型链路验收（会产生 Provider 费用）**单独确认后**再做：Staging 侧参考 `scripts/e2e-hosted-learning-agent.mjs`（含 5 次真实调用：401 拒权、Reviewer history 只读、Tutor、practice 生成、Socratic、Agent 模式）。生产侧应复用同一断言集，但把 projectUrl 断言改为生产 ref 前须先取得明确授权；当前脚本硬编码拒绝非 Staging ref。

---

## 2. KV41-007 · 开启 Auth leaked-password protection

背景：Security Advisor 报告 `auth_leaked_password_protection` WARN（2026-11-04 审计 AUD-P2-009 首次记录，2026-11-20 基线仍为 WARN）。该功能通过 Have I Been Pwned 校验弱口令，属 Auth 配置变更，需维护者授权。

1. Supabase Dashboard → 项目 `sxcpareycpokcyroufww` → Authentication → Settings。
2. 找到 **Password protection** / **Leaked password protection**（或 Security Advisor 对应建议项）。
3. 开启开关并保存。
4. 验证：Authentication → Security Advisor 中该 WARN 消失；再跑一次只读 advisor 检查确认无回归。

未执行原因：AGENTS.md 安全边界禁止擅自修改生产 Auth 配置；本手册只提供步骤，不代操作。

---

## 3. 相关但默认不动

- **KV41-005（Phase N 迁移时间戳差异）**：本地 `20261113041514` 与生产 `20261113153515` 函数体语义/MD5 已比对一致，仅时间戳不同。**不建议**为对齐时间戳执行生产迁移或改写历史版本。如坚持对账，仅做只读比对。
- **实体设备 / 生产真实闭环**：见 `docs/operations/physical-device-acceptance.md`。

---

## 4. 完成定义

| 项 | 完成标准 | 当前状态 |
|---|---|---|
| KV41-004 | 7 变量名在生产 secrets 清单出现 + 受控真实调用通过 | 未配置（需授权） |
| KV41-007 | Advisor WARN 消失 + 只读复查通过 | 未开启（需授权） |
| KV41-005 | 语义已比对一致 | 已记录，不改动 |
