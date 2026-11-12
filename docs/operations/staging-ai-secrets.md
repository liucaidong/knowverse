# KNOWVERSE Staging AI Secrets

在 KNOWVERSE 仓库根目录执行：

```bash
./scripts/configure-staging-ai.sh
```

脚本只允许写入 Staging Supabase 项目 `ypthoicwrfsblaidllyy`，不会使用默认 linked project，也不会修改生产项目。首次运行会在确认后通过 Homebrew 安装 Supabase CLI；未登录时会启动 Supabase 官方 CLI 登录流程。

脚本会隐藏 API Key 输入，要求 Learning Agent 与独立 Reviewer 使用不同模型，并要求再次输入完整 Staging Project Ref 才执行写入。Secrets 通过权限为 `0600` 的系统临时文件传给 Supabase CLI，结束时删除；仓库和 shell 历史不会保存密钥。写入后只核对变量名称，不读取或输出变量值。

必填变量：

- `AI_PROVIDER_API_KEY`
- `AI_PROVIDER_MODEL`
- `PRACTICE_REVIEWER_API_KEY`
- `PRACTICE_REVIEWER_MODEL`

可选变量（默认使用 OpenAI-compatible API base）：

- `AI_PROVIDER_BASE_URL`
- `PRACTICE_REVIEWER_API_BASE_URL`

脚本固定设置 `KNOWVERSE_CONTENT_REF=develop`。Reviewer 模型必须不同于 Learning Agent 模型；建议同时使用独立凭证。

脚本不会自动调用模型或触发可能计费的 AI 请求。配置成功后，再单独执行受控的 Staging AI 端到端验收。
