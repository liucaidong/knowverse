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


## 2026-11-03 · P0 合成学习者完整 E2E 增补

本节为后续新增验证，不覆盖前文记录的历史提交、历史 CI 运行或生产设备验收状态。

### 新增串联测试

- 新脚本：`scripts/e2e-phase-h1-pilot.mjs`。
- Playwright Chromium 独立浏览器上下文，无真实账户、无 Supabase 生产连接，独立 IndexedDB。
- 通过实际 UI 创建学习目标、设定预算、生成计划提案并接受。
- 通过课程 UI 完成开始、暂停、刷新恢复、继续和确认完成；断言 reader task 不形成 mastery evidence，且能解锁依赖检查点。
- 通过真实 checkpoint UI 记录一次合成错误，形成 gap observation。
- 通过 Review UI 走完提示辅助通过、任务保持待独立确认，再用不同变体且无提示的独立正确答案关闭同一 gap。
- 使用浏览器虚拟时钟前进 4 日验证到期复习调度。该模拟不代表真实经过 4 天，也不代表人类延迟回忆结果。
- 验证全流程无未捕获页面异常、无失败请求。

### 本次发现并修复的证据校验缺陷

`TaskOrchestrator.validateEvidence` 曾要求原始失败事件 ID 同时出现在 `review_started.targetGapEventIds` 与 `review_started.causationEventIds`。但二者语义不同：前者标识本次要修复的原始错误观察，后者标识复习过程的因果前序（例如上一轮提示辅助 attempt）。这个重复要求会使第二轮复习的合法独立通过无法完成任务。

现已修正校验器，分别检查精确目标事件引用与 Review started/attempt/pass 因果链，并在 `scripts/verify-phase-e.mjs` 增加实际 Review Engine + Task Orchestrator 的两轮复习回归：第一轮提示辅助通过不能关闭 gap；第二轮不同变体无提示通过完成任务并只关闭目标 gap。

### 增补验证结果

- Node 测试：160 例通过，0 失败（原 159 例 + 1 个 Phase E 两轮复习因果回归）。
- 浏览器 E2E：9 套共 28 例通过，0 失败：
  - e2e-learning-intelligence：2
  - e2e-site-navigation：9
  - e2e-learning-integration：4
  - e2e-promise-course-learning：2
  - e2e-phase-h1-pilot：1（新增）
  - e2e-cross-device-archive：1
  - e2e-learning-planner：4
  - e2e-learning-agent：2
  - e2e-react-native-domain：3
- 静态构建和站点校验：public content、static shell、search index、Monorepo graph、content routes、Mermaid、site architecture、Promise、Monorepo 和 Fullstack package/lockfile/native config 检查均通过。
- `.github/workflows/validate.yml` 已新增独立的 P0 synthetic H1 browser E2E 步骤。推送后须以 GitHub Actions 实际结果作为云端 CI 最终状态。

### 边界

以上是自动化机制验证，不是用户本人真实学习试点。E2E 中的答题由测试脚本驱动；虚拟时钟只是调度器模拟；跨设备档案测试采用隔离浏览器/测试后端。实际理解、真实 2/4/7 日回忆、实体 iPhone Safari、生产 OAuth 和真实网络环境的同步仍需独立验证。用户真实学习档案和云端数据未被本轮自动化测试读写。

## 系统功能审计增补 · 全站运行时路由烟测

- 新脚本：`scripts/e2e-system-route-smoke.mjs`。
- 从 `content/routes.json` 读取全部 44 条规范路由，包括相同页面上的锚点目标。
- 使用隔离 Chromium 浏览器上下文逐个加载，检查 HTTP 响应、页面非空、hash 目标存在、无页面加载失败状态、无未捕获 JavaScript 异常和无失败的同源资源请求。
- 本地结果：44/44 通过；0 页面异常、0 控制台错误、0 本地资源请求失败。
- 已接入 Validate 工作流，作为独立 Browser E2E 步骤。
- 当前浏览器 E2E 总计：10 个测试脚本、29 项测试通过；其中全站路由烟测在单项测试中覆盖 44 个规范路由。

本次审计范围聚焦系统自身的页面可运行性、核心任务工作流、学习事件/因果关系、任务持久化和复习闭环。真实设备同步和真实账户跨设备验收按本阶段决策暂缓，不纳入当前通过率。


## 系统功能审计 · 正在执行任务优先级

### 发现

当学习者有一个已接受计划、其中存在 `in_progress` 任务，同时因为新的学习事实生成了 `proposed` 新计划时，`/start/` 原先先判断 `current.proposal`，会把主按钮指向新计划提案。即使另一个任务已在执行，首页仍会要求先检查新计划，造成当前任务被打断。原先 nextTask 也只按 sequence 排序，因此较晚序号的 in-progress 任务可能被较早序号的 ready 任务遮挡。

### 修复

- `assets/js/learning-start.mjs` 现在先把现有任务按状态优先级排序：in-progress、failed、paused、ready；同状态再按计划 sequence 排序。
- 有 in-progress 任务时，首页先显示“继续当前任务”；新计划提案保留为次级入口，可继续查看和确认。
- 没有 in-progress 任务时，原有待确认计划、待执行任务和锁定任务的决策路径保持不变。
- 没有自动接受或丢弃新提案，也没有改动旧计划任务的数据。

### 回归

新增 E2E 同时建立较早序号的 ready 任务、较晚序号的 in-progress 任务，以及待确认的新计划提案；断言主入口仍指向正确 taskId 的正在执行任务，次级入口仍可查看计划。该测试先在旧逻辑上失败，再在修复后通过。站点导航与开始学习 E2E 套件当前 10/10 通过。

本次之后浏览器 E2E 总数更新为 30 项（10 个脚本）；44 条规范路由烟测仍纳入其中。Node 单元测试基线为 160/160。
