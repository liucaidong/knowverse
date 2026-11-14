# KNOWVERSE 4.1 — 全站回归与生产验收

## 1. 本地完整构建

在独立 Git worktree（commit `e3de364a546c6e503be5499dbb9fc178862a2eca`）执行 `.github/workflows/pages.yml` 的完整构建步骤：

1. `node scripts/build-public-content.mjs`
2. `python3 scripts/build-knowledge-context.py`
3. `node scripts/build-site-shell.mjs`
4. `python3 scripts/validate-content.py`
5. `node scripts/validate-site-architecture.mjs`
6. `python3 scripts/build-search-index.py`
7. `python3 scripts/build-search-index.py --check`
8. `python3 scripts/build-monorepo-graph.py`
9. `python3 scripts/build-monorepo-graph.py --check`
10. 按 Pages allowlist 组装 `_site`

结果：构建成功；47 条规范路由在 `_site` 中全部存在；5 个本阶段关键 JS 资源均包含在 `_site`；搜索索引 118 条、Monorepo 图 5 packages / 7 edges 均可复现。临时 worktree 已清理。

## 2. 自动化回归结果

| 验证类别 | 结果 | 证据 |
|---|---:|---|
| Node unit / contract / model | 245 / 245 通过 | `/tmp/knowverse-41-baseline/node-verify-final.log` |
| Chromium + WebKit E2E | 90 / 90 通过 | `/tmp/knowverse-41-baseline/browser-e2e-final.log` |
| 静态内容 / 架构验证 | 7 / 7 通过 | `/tmp/knowverse-41-baseline/static-validate-final.log` |
| 学习核心定向回归 | 92 / 92 通过 | `/tmp/knowverse-41-baseline/learning-core-targeted.log` |
| 学习闭环定向浏览器回归 | 13 / 13 通过 | `/tmp/knowverse-41-baseline/learning-loop-targeted-e2e.log` |
| Gallery 场景生命周期 | 5 / 5 通过 | `/tmp/knowverse-41-baseline/promise-universe-green.log` |
| 生产规范路由 | 47 / 47 HTTP 200 | 最终 Production HTTP route sweep |

测试数量存在重叠，不做跨套件相加。完整浏览器回归 90 项包含五个场景生命周期测试。

## 3. 本地构建产物与生产站点

- Production root：`https://liucaidong.github.io/knowverse/`，HTTP 200。
- 47 条 canonical route：47/47 HTTP 200。
- 本阶段关键资源：`learning-progress.mjs`、`learning-planner.mjs`、`learning-agent/plan-manager.mjs`、`learning-agent/task-orchestrator.mjs`、`gallery/exhibits/promise-universe/exhibit.js` 均 HTTP 200。
- 五个关键资源的本地与 Production SHA-256 完全一致。
- 功能代码首次完整部署 SHA：`e3de364a546c6e503be5499dbb9fc178862a2eca`，ref `develop`，environment `github-pages`。
- 随后的最终审计文档提交也触发 Pages 部署并成功；最终验收时，Pages deployment API 的最新 SHA 与 `develop` HEAD 一致。
- 对应功能代码部署 run `43615117032`、最终验收文档部署 run `43615500654` 均为 `completed / success`；较早的并发部署 run `5e323fd` 被后续更新取消。

## 4. 生产安全

- 没有执行 Production 写入、删除、Auth 修改、OAuth 修改、密钥修改或数据库迁移。
- Production 表 / RPC / Edge Function / Advisor 查询均为只读。
- Staging 云端 E2E 产生的合成数据只留在 Staging 测试账户；不删除、不覆盖。
- GitHub CI 未作为质量验收门槛；本地测试和本地完整构建已执行。Pages workflow 只用于发布，并在本次部署成功。

## 5. 未通过 / 未验证项

1. Staging initial sync 返回 `partial`、2 个 document conflicts、1 个 pending document；云端学习闭环与第二设备恢复验收未通过。同步机制调整因用户此前明确暂停而未修改。
2. Production Edge Function ACTIVE，但 AI Provider secrets 是否配置及真实模型请求未验证。
3. Production Phase N migration 时间戳与本地不同；SQL 语义等价性仍待逐函数核对。
4. 8/12 专题缺少正式 Competency / Gap 图谱，不能进行同等能力级掌握推断。
5. Supabase Auth leak-password protection Advisor 风险未修改，需单独授权。
6. 两个 unused index 仅观察，不删除。

## 6. Git 交付状态

- Branch：`develop`
- HEAD：最终验收文档所在的最新 `develop` 提交（以 Git 当前 HEAD 为准）
- `origin/develop`：与 HEAD 相同，ahead/behind `0/0`
- 工作区：干净
- Pages Production deployment SHA：与 HEAD 相同
