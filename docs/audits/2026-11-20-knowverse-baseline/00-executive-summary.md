# KNOWVERSE 4.x — 2026-11-20 基线审计执行摘要

- 审计日期：2026-11-20
- 仓库：`liucaidong/knowverse`
- 工作目录：`/Users/geeker/ai-projects/knowverse`
- 审计分支：`develop` @ `355a9ddab68ad33eda5b8087e6e9ccd54aa60495`
- 生产 Pages：`https://liucaidong.github.io/knowverse/`
- 生产 Supabase：`sxcpareycpokcyroufww`；Staging：`ypthoicwrfsblaidllyy`
- 审计性质：只读审计 + 本机安全修复。未写生产数据、未改 Auth/Secrets、未执行迁移、未部署。

## 一句话结论

KNOWVERSE 的工程骨架、内容覆盖与本地学习闭环在 2026-11-14（4.1）基础上保持稳定且真实可运行；本轮**实机复跑**了几乎所有自动化入口并全部通过。本轮**修复了长期未闭合的 P1（KV41-010）**——被复用学习档案中，历史任务已解决的薄弱点观察被误判为当前复习任务仍需重新验证，导致无提示独立通过后任务永久停留 in_progress；已用确定性回归测试（RED→GREEN）和 staging 真实环境插桩双重验证。另有 1 项构建可复现性缺陷已修复。剩余阻塞均为需要用户授权的外部配置/实体设备验收，因此**仍不得宣告整体达标**。

## 与 2026-11-04 / 2026-11-14 历史的对比

| 维度 | 2026-11-04 | 2026-11-14 (4.1) | 2026-11-20 (本轮实检) |
|---|---|---|---|
| 专题/Concept/Competency | 12 / 16 / 15 | 12 / 35 / 34 | 12 / 35 / 34（一致） |
| Gap / Review Assessment | 31 / 72 | 51 / 115 | 51 / 115（一致） |
| Canonical routes | 44 | 63 | 63（一致） |
| Node 单测 | 245 | 247 | 本轮分组实跑全绿（见 test-report） |
| 浏览器 E2E | 42 | 19（本地） | 本轮本地组全绿（见 test-report） |
| 学习证据来源追踪 | 未实现 | 已修复 | 稳定 |
| P1 云端闭环 | 阻塞 | KV41-010 open | 已修复（taskId 口径对齐 + 回归测试） |
| AGENTS.md | 无 | 无 | 本轮建立 |
| 构建可复现性 | — | — | 发现并修复 `.DS_Store` 打包污染 |

## 本轮真实发现

- **FIXED（P2/P3，构建可复现性）**：`scripts/package-fullstack-project.py` 会把本机 macOS `.DS_Store` 打进交付 ZIP，导致 CI（Ubuntu）与本地（macOS）产物字节不一致。已加入噪声文件过滤并验证：重打包回到 48 文件、无 `.DS_Store`、与 HEAD 二进制一致、`validate-fullstack` 通过。
- **P3 观察（未改）**：仓库提交的 `data/search.json` 与当前源码重建结果存在 58 处 body 差异，起因是站点外壳把「知识总览」导航文案注入 `<main>`，被搜索索引当作正文提取。生产 CI 每次部署重建索引，不影响线上正确性；修改提取逻辑会影响 134 条记录，属产品决策，记录不改。
- **FIXED（P1，KV41-010）**：根因是 `validateEvidence` 把同一 competency+gap 的**全部历史**失败尝试都当作当前复习任务必须验证的未解决观察；被复用的学习档案中，旧任务已解决的观察没有对应本任务的通过事件，导致 `unresolved` 永不为空、`complete()` 永久抛错。修复为按 taskId 排除其他任务已解决的观察，与 review-engine 生成 targetGapEventIds 的口径一致，且不放宽因果链。用确定性回归测试（干净 DB 注入历史已解决失败）复现 RED、修复后 GREEN；staging 真实环境插桩确认 `complete()` 成功写入 learning_task_completed。详见 `audit-issues.json`。
- **外部阻塞**：Production AI Provider secrets 缺失、Auth leak-password protection 未开启、实体 iPhone Safari / 第二物理设备 / 生产真实学习闭环未验收、Production migration 未执行（时间戳差异已记录）。

## 交付物索引

- `01-engineering-audit.md` 工程结构审计
- `02-feature-inventory.md` 功能清单
- `03-content-inventory.md` 知识内容审计
- `04-database-audit.md` 数据库审计
- `05-auth-security-audit.md` 认证与安全审计
- `06-ux-ia-audit.md` UX 与信息架构审计
- `07-production-audit.md` 生产环境审计
- `08-architecture-proposal.md` 架构评估与建议
- `09-remediation-roadmap.md` 整改路线图
- `audit-issues.json` 结构化问题登记
- `implementation-report.md` / `test-report.md` / `deployment-report.md`（仓库根 `docs/` 同级交付）
