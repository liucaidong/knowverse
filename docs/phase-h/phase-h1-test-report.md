# Phase H1 实际测试报告

日期：2026-11-03；环境：macOS、Node.js v26.10.0、Playwright Chromium / WebKit。

## 静态构建

- build-public-content.mjs 成功：2 catalogues、16 concept pages。
- build-site-shell.mjs 成功：139 pages、16 search overlays、135 shared footer sets。
- build-search-index.py 成功，113 records；--check 可复现。
- build-monorepo-graph.py 成功：5 packages、7 edges；--check 可复现。
- validate-content.py：12 topics、17 works、17 live routes、3 pillars。
- validate-v2.py：6,773 local links、22 Mermaid panoramas、113 search records。
- validate-site-architecture.mjs：3 nav groups、12 topics、16 concepts、15 competencies、43 canonical routes。
- validate-promise.py：20 Promise lessons + 5-stage challenge。
- validate-fullstack.py、package-fullstack-project.py、native lockfile/config 检查均通过，ZIP 重建包含 48 个源文件。

## Node 测试

实际执行合计 159 例、0 失败（新增复习页本地优先/云同步文案回归）：

| 套件 | pass |
| --- | ---: |
| verify-site-shell | 2 |
| verify-public-content | 2 |
| verify-promise-quest | 8 |
| verify-challenge-engine | 8 |
| verify-local-learning-database + verify-learning-state-storage | 17 |
| verify-backend-contract | 14 |
| verify-learning-progress | 8 |
| verify-learning-intelligence | 14 |
| verify-learning-integration（含 Promise 路由、复习页数据保存说明） | 8 |
| verify-react-native-domain | 2 |
| verify-learning-planner | 15 |
| verify-phase-e | 16 |
| verify-phase-f | 12 |
| verify-phase-g | 19 |
| verify-e2e-async-wait | 3 |
| Monorepo starter graph | 3 |
| verify-monorepo-labs | 5 |
| device-proxy + device-faults | 3 |
| 合计 | 159 |

覆盖：mastery unverified、活动/浏览隔离、事件幂等、IndexedDB 原子事务、账号隔离、migration、CAS、gap 因果链、提示/变体、先修和预算、任务/目标状态、Phase G 冷启动与冷却。

## 浏览器 E2E

8 套共 22 例通过，0 失败：

- e2e-learning-intelligence：2
- e2e-site-navigation：4
- e2e-learning-integration：4
- e2e-promise-course-learning（H1 新增）：2
- e2e-cross-device-archive：1
- e2e-learning-planner：4
- e2e-learning-agent：2
- e2e-react-native-domain：3

新增 Promise E2E 实测 Chromium：开始、暂停、刷新恢复、继续、确认阅读完成；断言当前任务 evidenceEventIds 为空、无 assessment/mastery event，且依赖阅读的挑战任务由 locked 自动变为 ready。WebKit 390px 视口检查面板可见且不溢出。所有这些使用隔离测试上下文，不写生产 Supabase。

## 本地浏览器说明

本机 Playwright 1.64.1 期待 Chromium 1248 / WebKit 2370；缓存中已有 1243 / 2359。下载镜像网关返回 400，停止重复尝试；只在用户浏览器缓存目录建立 revision alias，使当前 Playwright 使用缓存浏览器通过测试。项目未添加新依赖或浏览器二进制；GitHub Actions 会按 CI 安装步骤下载匹配版本。该兼容方式是本地测试环境说明，不改变仓库。

## Supabase 只读安全验证

6 张 public 业务表全部启用 RLS；anon 对 public 学习表无 SELECT；learning_events 不允许 authenticated UPDATE/DELETE；archive documents 不允许 DELETE；migration history 与仓库 5 项一致。未执行 DDL、DML、migration、reset 或清空数据。private.authorized_users policy 为空但没有 anon/authenticated 表权限；Auth leaked password protection 仍未启用。

## GitHub Actions / Pages

H1 实施提交：`c395c8cd4009cd642e533289a3a410db651f8619`（feat(phase-h): prepare evidence-driven Promise learning pilot）。

- Validate KNOWVERSE Content #129：success，run id 41608366189；完整工作流 55 steps，无失败：https://github.com/liucaidong/knowverse/actions/runs/41608366189
- Deploy KNOWVERSE to GitHub Pages #94：success，run id 41608366168：https://github.com/liucaidong/knowverse/actions/runs/41608366168
- 生产 HTTP：/、/progress/、/agent/、/review/、/knowledge/promise/lesson-03/、/assets/js/learning-integration.mjs、/content/learning-map.json 均为 200。
- 生产 `assets/js/learning-integration.mjs` SHA-256 = `9ae3aa40023833414296480cc03ef267a2affa992137a9b649c3059af9fb55f3`，与实施提交文件一致；生产 `review/index.html` SHA-256 = `942366473c07105909661df23ae9e6bce4850be8a98b3809d42147d24ddb3b64`，与实施提交文件一致。
- 线上 lesson-03 已加载共享 Learning Integration；复习页生产文案包含“本地优先 / 同步到云端档案”，不再出现“仅本机”。

Phase G 的 Validate #128 / Pages #93 是历史冻结基线，不能与上述 H1 CI 结果混淆。
