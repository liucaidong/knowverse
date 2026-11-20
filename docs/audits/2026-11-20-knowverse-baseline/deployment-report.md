# 部署报告 · KNOWVERSE 2026-11-20 基线

- 日期：2026-11-20
- 结论：**未部署**。本轮属于审计 + 本地安全实施，未 push、未触发 Pages 部署、未执行生产迁移、未修改生产数据/Auth/Secrets。

## 发布前检查清单（PASS 表示已具备，不代表已发布）

| 检查项 | 状态 | 说明 |
|---|---|---|
| Git 工作区 | 有未提交变更 | 构建修复 + AGENTS.md + 审计文档，尚未 commit |
| Git diff 审查 | 待提交前完成 | 变更仅限脚本/文档，无业务数据源文件改动 |
| 本地构建结果 | PASS | 概念页/上下文/Shell/索引/图/打包全部成功且可复现 |
| 本地全量测试 | PASS | 见 test-report.md，全部本地组通过 |
| Migration 顺序与风险 | 无新迁移 | 未设计、未执行生产迁移；历史 provenance 风险已记录 |
| 回滚策略 | 具备 | 本轮变更均为本地文件；ZIP 可由脚本确定性重建；无数据变更需回滚 |
| 环境变量 | 未改 | 未读取/写入任何 secret |
| GitHub Pages 配置 | 现状正常 | `pages.yml` 显式 allowlist，最近部署 run success |
| OAuth 回调 | 现状正常 | `/auth/callback/` HTTP 200；PKCE 实现正确 |
| 生产依赖 | 无新增 | 未引入新依赖 |

## 生产环境当前实测

- 5 个核心路由 HTTP 200；`/auth/` 404 为预期；`/auth/callback/` 200。
- 最近 Pages 部署 run `43900143678`（HEAD `355a9dd`）success（历史 CI 记录）。

## 授权边界

以下属于需明确授权后才能在 staging 或生产执行的操作，本轮一律未做：

1. `git push origin develop`（会触发生产 Pages 部署）。
2. 生产 Supabase 任何写操作 / 迁移 / Auth 配置 / Secrets 变更。
3. Staging 真实账户下的 KV41-010 复现与修复验收。
4. 正式发布验收（生产真实学习闭环、AI Provider 真实调用、实体 iPhone Safari）。

## 获得授权后的推荐发布流程

1. 审查并提交本地变更（`scripts/package-fullstack-project.py`、`AGENTS.md`、审计文档）。
2. 本地全量测试再次 PASS（test-report.md 命令）。
3. 在 staging 完成 KV41-010 复现与修复验收（如适用）。
4. `git push origin develop` → 确认 Validate run success + Pages run success。
5. 生产验收：核心路由 200、关键资源哈希与本地一致、控制台错误 0、OAuth 登录与只读业务流。
6. 回填本报告为「已部署」并记录 run 编号、SHA 与验收证据。
