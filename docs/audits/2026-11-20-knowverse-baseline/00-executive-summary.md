# KNOWVERSE 4.x — 2026-11-20 基线审计执行摘要

- 审计日期：2026-11-20
- 仓库：`liucaidong/knowverse`
- 工作目录：`/Users/geeker/ai-projects/knowverse`
- 审计分支：`develop` @ `355a9ddab68ad33eda5b8087e6e9ccd54aa60495`
- 生产 Pages：`https://liucaidong.github.io/knowverse/`
- 生产 Supabase：`sxcpareycpokcyroufww`；Staging：`ypthoicwrfsblaidllyy`
- 审计性质：只读审计 + 本机安全修复。未写生产数据、未改 Auth/Secrets、未执行迁移、未部署。

## 一句话结论

KNOWVERSE 的工程骨架、内容覆盖与本地学习闭环在 2026-11-14（4.1）基础上保持稳定且真实可运行；本轮**实机复跑**了几乎所有自动化入口并全部通过，确认 4.1 报告中的多数 P2 修复有效。当前仍有 1 项 P1（KV41-010，云端复习任务生命周期闭合）与多项需要授权的外部阻塞未完成，因此**不得宣告整体达标**。本轮修复了 1 项真实的构建可复现性缺陷。

## 与 2026-11-04 / 2026-11-14 历史的对比

| 维度 | 2026-11-04 | 2026-11-14 (4.1) | 2026-11-20 (本轮实检) |
|---|---|---|---|
| 专题/Concept/Competency | 12 / 16 / 15 | 12 / 35 / 34 | 12 / 35 / 34（一致） |
| Gap / Review Assessment | 31 / 72 | 51 / 115 | 51 / 115（一致） |
| Canonical routes | 44 | 63 | 63（一致） |
| Node 单测 | 245 | 247 | 本轮分组实跑全绿（见 test-report） |
| 浏览器 E2E | 42 | 19（本地） | 本轮本地组全绿（见 test-report） |
| 学习证据来源追踪 | 未实现 | 已修复 | 稳定 |
| P1 云端闭环 | 阻塞 | KV41-010 open | 仍未闭合（需 staging 真实账户） |
| AGENTS.md | 无 | 无 | 本轮建立 |
| 构建可复现性 | — | — | 发现并修复 `.DS_Store` 打包污染 |

## 本轮真实发现

- **FIXED（P2/P3，构建可复现性）**：`scripts/package-fullstack-project.py` 会把本机 macOS `.DS_Store` 打进交付 ZIP，导致 CI（Ubuntu）与本地（macOS）产物字节不一致。已加入噪声文件过滤并验证：重打包回到 48 文件、无 `.DS_Store`、与 HEAD 二进制一致、`validate-fullstack` 通过。
- **P3 观察（未改）**：仓库提交的 `data/search.json` 与当前源码重建结果存在 58 处 body 差异，起因是站点外壳把「知识总览」导航文案注入 `<main>`，被搜索索引当作正文提取。生产 CI 每次部署重建索引，不影响线上正确性；修改提取逻辑会影响 134 条记录，属产品决策，记录不改。
- **P1 被阻塞（KV41-010）**：本地因果链单测（`verify-phase-e.mjs`）已覆盖「无提示独立验证」全链并通过；该问题仅在 Staging 云端真实账户时序下复现。历史上用户已冻结同步机制范围，本轮不在无凭证、无法复现、无法验证的前提下改动核心因果校验（避免为通过测试降低标准）。
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
