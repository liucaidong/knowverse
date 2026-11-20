# 05 · 认证与安全审计（2026-11-20）

## 认证实现（代码审计）

- `assets/js/backend/auth.mjs`：Supabase Auth + OAuth PKCE。实测存在 `crypto.subtle` 校验、`code_verifier` 生成/存储/清理、`grant_type=pkce` token 交换、`redirect_to` 回调。PKCE 流程实现正确。
- 账户白名单与 allowlist 由服务端/DB 控制；认证不等于云端授权。
- Session/token：由 Supabase 管理；历史 N2 记录 session refresh 尚未在实体设备完整验收。

## 用户数据隔离（本轮实跑）

- `verify-supabase-sync-isolation.sh`（PG17 真实 RLS/RPC）：账号 B 无法读取账号 A 的学习事件与档案文档，不能伪造 `expected_user_id` 或借用设备 ID，跨账号写入被拒——PASS。
- `verify-backend-contract.mjs`、`verify-phase-m-publication-security.mjs`、`verify-phase-m-audit-order.mjs` 本轮全绿：审核记录不可覆盖、发布权限受控、审计链有序。

## Secrets 与配置

- `config/staging-ai-secrets.json` 存在但已被 `.gitignore`，`git ls-files config/` 仅跟踪 `staging-ai-secrets.json.example`——无密钥入库风险。本轮未读取任何 secret 值。
- 生产 AI Provider secrets 缺失（4.1 记录）：真实模型能力不可宣称，BLOCKED。
- 生产 Auth leak-password protection 未开启：需用户单独授权，本轮未改 Auth 配置。

## 前端权限边界

- 全局账户控件统一；公共知识与个人数据分离；RLS 为最终数据边界。
- AI Tutor/Reviewer 只读或产候选，不写掌握证据（产品原则 7）。

## 结论

认证与 RLS 隔离实现正确、测试充分，无 P0。剩余均为需授权的外部配置（AI Provider secrets、leak-password protection）或实体设备验收，不属代码缺陷。
