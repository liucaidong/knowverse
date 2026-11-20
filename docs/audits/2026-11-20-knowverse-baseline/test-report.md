# 测试报告 · KNOWVERSE 2026-11-20 基线

- 执行日期：2026-11-20
- 环境：Node v22.22.2 / Python 3.13.12 / Deno 2.9.8 / Docker 29.8.2 / Playwright (Chromium+WebKit) / supabase CLI 3.1.0
- 说明：所有测试在本机真实执行。RC=0 且 fail=0 记 PASS；未执行记 NOT RUN；无凭证/需授权记 BLOCKED。

## 1. 静态内容与架构校验

| 测试 | 命令 | 结果 | 证据 |
|---|---|---|---|
| V1 内容注册 | `python3 scripts/validate-content.py` | PASS | OK: 12 topics, 17 works, 17 routes, 4 linked pillars |
| V2 页面/链接 | `python3 scripts/validate-v2.py` | PASS | 9990 local links, 22 Mermaid, 134 search records |
| 站点架构 | `node scripts/validate-site-architecture.mjs` | PASS | 4 nav groups, 12/35/34, 63 routes, 157 shell pages, 3 exits |
| Promise 深度 | `python3 scripts/validate-promise.py` | PASS | 20 lessons + challenge |
| Monorepo 课程 | `python3 scripts/validate-monorepo-deep.py` / `-product.py` | PASS | 10 chapters, 5-pkg graph, 7 edges |
| Promise 工作台布局 | `node scripts/verify-promise-workbench-layout.mjs` | PASS | layout + obsolete CSS removed |

## 2. 构建可复现性

| 测试 | 命令 | 结果 | 证据 |
|---|---|---|---|
| Deno 类型检查 | `deno check supabase/functions/practice-quality-review/index.ts` | PASS | RC=0 |
| 概念页/知识上下文/Shell | `build-public-content.mjs` / `build-knowledge-context.py` / `build-site-shell.mjs` | PASS | 35 concept pages / 99 contexts / 161 shell pages |
| 搜索索引 | `build-search-index.py` 后 `--check` | PASS | current: 134 records（注：提交态直接 --check 失败，见 KV20-002） |
| Monorepo 图 | `build-monorepo-graph.py --check` | PASS | current: 5 packages |
| 全栈打包 | `package-fullstack-project.py` + `validate-fullstack.py` | PASS | 48 files, no .DS_Store, validate RC=0 |
| Native 配置/lockfile | `verify-lockfile.mjs` / `verify-native-config.mjs` | PASS | RC=0 |

## 3. Node 单元测试（分组真实执行，全部 PASS）

| 组 | 测试数 | 结果 |
|---|---:|---|
| verify-site-shell | 2 | PASS |
| verify-public-content | 2 | PASS |
| verify-promise-quest | 8 | PASS |
| verify-monorepo-product | 1 | PASS |
| verify-challenge-engine | 9 | PASS |
| verify-local-learning-database | 14 | PASS |
| verify-learning-state-storage | 3 | PASS |
| verify-backend-contract | 14 | PASS |
| verify-archive-conflicts | 10 | PASS |
| verify-learning-progress | 8 | PASS |
| verify-learning-intelligence | 14 | PASS |
| verify-learning-integration | 11 | PASS |
| verify-learning-tutor / reflections / practice-candidates / practice-quality | 4/4/6/8 | PASS |
| verify-phase-m-audit-order / publication-security | 7/8 | PASS |
| verify-learning-weekly-review / react-native-domain | 6/3 | PASS |
| verify-learning-planner / phase-e / phase-f / phase-g | 16/18/12/19 | PASS |
| verify-ai-agent-learning / e2e-async-wait | 2/3 | PASS |
| monorepo starter `tests/*.test.mjs` | 3 | PASS |
| device-proxy / device-faults | 3 | PASS |

合计 Node 单元断言组：全部 fail=0（与 4.1 的 247/247 基线一致；本轮按组实跑）。

## 4. 数据库集成（真实 PG17 / Docker）

| 测试 | 命令 | 结果 | 证据 |
|---|---|---|---|
| Migration replay | `verify-supabase-migration-replay.sh` | PASS | 空库与 seeded 库各 13/13；SUCCESS |
| 同步隔离/RLS | `verify-supabase-sync-isolation.sh` | PASS | 原子提交/幂等/CAS回滚/跨账号拒绝；SUCCESS |

## 5. 浏览器 E2E（本地，Playwright）

| 测试 | 结果 |
|---|---|
| e2e-site-navigation (12) / e2e-system-route-smoke (1) | PASS |
| e2e-learning-intelligence (2) / -integration (4) / -tutor (4) / -planner (4) / -agent (3) | PASS |
| e2e-ai-agent-learning (2) / phase-k (2) / phase-l (3) / phase-m (5) | PASS |
| e2e-weekly-learning-review (3) / promise-course (5) / phase-h1-pilot (1) | PASS |
| e2e-cross-device-archive (1) / react-native-domain (4) | PASS |

本地浏览器 E2E 组全部 fail=0。

## 6. 生产与需授权项

| 测试 | 状态 | 原因 |
|---|---|---|
| 生产路由 HTTP | PASS | 5 核心路由 200；/auth/ 404 为预期；callback 200 |
| 生产关键资源哈希逐项复验 | NOT RUN | 沿用 4.1 结论，本轮未逐资源复验 |
| 生产浏览器控制台错误采集 | NOT RUN | 本轮未单独采集（本地 E2E 错误 0） |
| Staging 云端 KV41-010 | BLOCKED | 需 staging 凭证 + 真实账户；本地因果链单测全绿 |
| 生产真实学习闭环 / AI Provider / 实体设备 | BLOCKED | 需授权与凭证，未写生产数据 |

## 结论

本轮能本地真实执行的工程测试（静态校验、构建可复现性、Node 单测、PG17 集成、本地浏览器 E2E、生产 HTTP）全部 PASS。剩余为需授权/凭证的验收项（BLOCKED）与两项 NOT RUN 的历史依赖项。未通过任何删除测试、跳过或屏蔽错误的方式制造成功。
