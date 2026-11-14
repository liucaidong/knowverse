# KNOWVERSE 4.1 — WP0 基线与安全边界

- 日期：2026-11-14（项目工作区本地日期）
- Repository：`liucaidong/knowverse`
- Local：`/Users/geeker/ai-projects/knowverse`
- Branch：`develop`
- Production Pages：`https://liucaidong.github.io/knowverse/`
- Production Supabase ref：`sxcpareycpokcyroufww`

## 1. Git 与工作区基线

- WP0 初始检查分支为 `develop`，工作区干净。
- 初始 HEAD：`978df7d938505cc34afccbd7b3956f53b8f2274a`（`build: regenerate knowledge context before Pages deploy`）。
- 初始 `origin/develop` 与本地一致，ahead/behind 为 `0/0`。
- 审计期间发现一条现有 E2E 测试 locator 因同名导航链接与文章卡片产生 Playwright strict-mode 冲突。仅将 locator 改为 exact match；针对性测试 2/2 通过；修复已独立提交并推送：`9aebe924070dc9ecbc95267ae16e52e67d83b710`（`test: disambiguate AI Agent lesson link locator`）。该改动不改变产品代码或用户数据。
- 推送后 `develop` 与 `origin/develop` 同步，ahead/behind `0/0`。

## 2. 项目构建与测试入口

- 根目录无根 `package.json`；项目是静态站点 + 原生浏览器 ES modules + Supabase 后端函数，测试入口位于 `scripts/`。
- 生产 Pages 工作流为 `.github/workflows/pages.yml`：构建 Concept、知识上下文、站点 Shell、搜索索引、Monorepo 图，再以显式 allowlist 组装 `_site`；排除 `.env*`、`supabase/`、`scripts/`、`.git/`、`node_modules/`。
- 内容 / 架构校验入口：`scripts/validate-content.py`、`scripts/validate-v2.py`、`scripts/validate-promise.py`、`scripts/validate-monorepo-deep.py`、`scripts/validate-monorepo-product.py`、`scripts/validate-fullstack.py`、`scripts/validate-site-architecture.mjs`。
- 自动化测试使用 Node test runner 与 Playwright；当前本地安装 Chromium、WebKit 浏览器。并发运行会影响部分 WebKit 异步等待用例，浏览器回归采用 `--test-concurrency=1` 复核。

## 3. 基线验证（本地真实执行）

- `node --test scripts/verify-*.mjs`：244 个测试通过，0 失败，0 跳过。
- 静态内容与架构校验：全部通过；V1 内容注册 12 个专题、17 个作品、17 条唯一实时路由；V2 扫描 6,663 条本地链接、22 个 Mermaid 全景图、118 条搜索记录；Promise 课程 20 课；Monorepo 课程 10 章、11 个 Mermaid 图；全栈教程结构检查通过。
- 架构校验输出：4 个导航工作区、12 个专题、19 个 Concept、18 个 Competency、3 个体验支柱、17 个作品、17 个来源、47 条规范路由、118 条搜索记录、141 个静态 Shell 页面、3 个沉浸式场景出口。
- 浏览器回归首轮 89 项中 88 通过、1 失败；失败 1 是并发运行下 WebKit 计划持久化等待超时。该用例单独执行 3/3 通过；已启动串行完整回归，最终结果以串行日志为准。
- 初始 AI Agent lesson locator 冲突已修复，针对性 Chromium/WebKit 2/2 通过。

## 4. 生产 Pages 核对

- 生产站点首页 HEAD 请求 HTTP 200。
- 生产首页 HTML 与当前本地 `index.html` SHA-256 一致（`cc9fa70a1b6b7275d16e471f97fc4ca8c818fa9d26b2c255b6e0befacd2141e5`）。
- 这只能证明首页静态内容一致，不能单独证明全部资源、全部路由或最新 Git commit 已部署；后续 WP5 将检查规范路由、关键资源和发布提交。

## 5. Supabase 项目身份与安全

- 所有本次生产结构查询均显式指定 `sxcpareycpokcyroufww`；没有写入、迁移、删除或修改任何生产数据。
- 仓库 `supabase/config.toml` 的 `project_id` 为 `knowverse`；本地 `supabase/.temp/linked-project.json` 指向 `knowverse-staging`（`ypthoicwrfsblaidllyy`）。因此绝不使用当前 CLI link 作为生产目标；生产管理操作必须显式选择 Production ref。
- Production 已登记 13 条 migration；本地也有 13 个 migration 文件。Phase N migration 名称相同，但版本时间戳不同：本地 `20261113041514`，Production `20261113153515`。必须核对迁移内容 / RPC 定义，不能仅凭数量和名称认定完全一致。
- Production 两个 Edge Functions 均为 ACTIVE 且 `verify_jwt=true`：`learning-agent`（version 10）、`practice-quality-review`（version 4）。函数版本号不是源码一致性的证明，后续需核对部署来源与实际运行能力。
- Production 表结构包含 `profiles`、`user_devices`、`user_sync_state`、`learning_events`、`user_document_sync_state`、`learning_archive_documents`、`practice_candidate_quality_records`，以及 private schema 的授权与审核员管理表。
- 只读行数快照：`user_devices=2`、`learning_events=8`、`learning_archive_documents=6`、`practice_candidate_quality_records=0`；`profiles=0`、`user_sync_state=0`、`user_document_sync_state=0`。这些数字是审计时快照，不是完整用户档案数量，也不得据此清理数据。
- `learning_events` 是 append-only 学习事实；掌握度、置信度、Gap 与计划由版本化客户端 reducer 派生。`learning_archive_documents` 保存挑战 / 复习 / 学习者偏好 / 目标 / 计划 / 任务 / Agent 会话等版本化文档。正式掌握证据不得由 AI Tutor、AI Reviewer 或阅读任务伪造。

## 6. 明确安全边界

- 不清空或覆盖 Production 数据；不更改 Auth / OAuth / 密钥；不执行不可逆迁移。
- 不把测试写入现有真实账户；闭环验收使用隔离浏览器存储与 Staging 合成账户 / 本地隔离数据库。
- 不执行跨浏览器同步频率、标签页等待或调度机制改动（该范围已明确暂停）。
- GitHub Actions 不作为执行依赖；本地可完成的检查均在本机执行。
- 生产只读结构、迁移和 RPC 核对可继续；任何生产 schema 变更必须先形成兼容性方案和单独审批证据。

## 7. 当前基线风险 / 待核验

1. Production Phase N migration timestamp 与本地不同，需核对其实际 SQL 语义是否等价。
2. Production Edge Function 虽 Active/JWT-gated，但真实 AI Provider 调用与独立 Reviewer 能力不能从部署状态推断；此前 N2 审计记录指出 Provider secrets 未配置，必须重新核实，不得假设已解决。
3. 生产 `learning_events` 只有 8 条、档案文档 6 份；需要以真实事件 payload 追踪完整因果链，不能只根据汇总计数认定闭环成立。
4. `learning_plan_generated` 曾出现 `unclassified` topic，需要核对事件生产者与归类逻辑。
5. 浏览器回归在并发模式出现 WebKit 异步等待超时；串行复核结果未出前不能宣告全套浏览器回归通过。

## 8. 基线证据位置

- 本机临时日志：`/tmp/knowverse-41-baseline/node-verify.log`
- 静态验证日志：`/tmp/knowverse-41-baseline/static-validate.log`
- 浏览器并发首轮日志：`/tmp/knowverse-41-baseline/browser-e2e-rerun.log`
- 浏览器串行复核日志：`/tmp/knowverse-41-baseline/browser-e2e-sequential.log`
- 临时日志不含密钥，不纳入仓库；仓库只保留审计摘要和可复现命令。
