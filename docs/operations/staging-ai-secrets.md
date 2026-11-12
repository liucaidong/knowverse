# KNOWVERSE Staging AI Secrets

## 1. 填写配置文件

首次执行脚本时，如果本机配置文件不存在，脚本会自动从模板生成：

`config/staging-ai-secrets.json`

模板来源：

`config/staging-ai-secrets.json.example`

请直接编辑生成的 `config/staging-ai-secrets.json`，一次性填写 4 个必填字段：

- `AI_PROVIDER_API_KEY`
- `AI_PROVIDER_MODEL`
- `PRACTICE_REVIEWER_API_KEY`
- `PRACTICE_REVIEWER_MODEL`

两个 Base URL 字段可留空（默认 OpenAI API）：

- `AI_PROVIDER_BASE_URL`
- `PRACTICE_REVIEWER_API_BASE_URL`

文件采用标准 JSON 格式，保留双引号和逗号。API Key 只写在本机配置文件中，不要提交到 Git，也不要粘贴到聊天。

## 2. 执行

```bash
cd /Users/geeker/ai-projects/knowverse
./scripts/configure-staging-ai.sh
```

也可以指定其他 JSON 文件：

```bash
./scripts/configure-staging-ai.sh --config /absolute/path/to/staging-ai-secrets.json
```

脚本会先读取并校验本地文件，再检查 Supabase CLI、登录状态和 Staging 项目权限。写入前仍要求输入完整 Project Ref：

`ypthoicwrfsblaidllyy`

## 3. 安全边界

- 只允许写入 Staging Supabase 项目 `ypthoicwrfsblaidllyy`（`knowverse-staging`），不会使用默认 linked project，也不会修改生产项目。
- 只接受已验证参数语义的 Supabase CLI v3；首次运行会在确认后通过 Homebrew 安装官方 CLI。
- 本机配置文件权限设为 `0600`，并由 Git 忽略规则排除；写入 Supabase 时通过权限为 `0600` 的系统临时文件传递，退出时删除。
- 终端只显示变量名称，不显示 API Key 或配置值。
- 两个模型 ID 必须不同；建议 Reviewer 使用独立凭证。
- Base URL 必须为有效 HTTPS API 根地址，例如 `https://api.example.com/v1`。不要填写 `/chat/completions`、查询参数或片段。
- Staging Edge Functions 在云端运行，因此 `localhost` / `127.0.0.1` 指向云端函数自身，不是你的 Mac；不应将本机 HTTP 地址配置为远端 Staging Provider。
- Learning Agent 模型需要支持 JSON object response format；Reviewer 模型需要支持 `response_format: json_schema` 严格结构化输出。
- 脚本不会自动调用模型或触发可能计费的 AI 请求。配置成功后，再单独执行受控的 Staging AI 端到端验收。
