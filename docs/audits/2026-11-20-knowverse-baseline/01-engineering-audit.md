# 01 · 工程结构审计（2026-11-20 实检）

## 工程形态

- 根目录无 `package.json`；静态站点（GitHub Pages）+ 原生浏览器 ES modules（`assets/js/**/*.mjs`）+ Python/Node 构建与校验脚本 + Supabase Edge Functions（Deno）。
- 前端入口：`index.html`、`404.html`；各工作区为独立 HTML 目录（`knowledge/`、`works/`、`progress/`、`review/`、`start/`、`gallery/`、`lab/`、`puzzles/`、`agent/`、`auth/callback/` 等）。
- 数据契约：`content/*.json`（navigation/routes/knowledge/concepts/learning-map/works/learning-checkpoints/review-assessments/sources/challenges）。
- 构建：`scripts/build-public-content.mjs`、`build-knowledge-context.py`、`build-site-shell.mjs`、`build-search-index.py`、`build-monorepo-graph.py`、`package-fullstack-project.py`。
- 校验：`scripts/validate-*.py|mjs`、`verify-*.mjs`、`e2e-*.mjs`（共 35 个 E2E 脚本）。
- CI：`.github/workflows/validate.yml`（PR/push develop 全量校验）、`pages.yml`（部署）、`monorepo-*.yml`、`publish-approved-practice-candidate.yml`。

## 依赖与工具（本机实测）

Node v22.22.2、npm shim→pnpm 12.7.0、Python 3.13.12、Deno 2.9.8、Docker 29.8.2、supabase CLI 3.1.0、gh 2.103.3。Playwright 与 Chromium(1243/1248/1254)/WebKit(2359) 均已安装。`fake-indexeddb` 可解析。注意：`npm --no-save` 在本机为 pnpm shim 不支持，未为此生成根 `package.json`。

## 构建可复现性

- 静态 Shell 161 页、知识上下文 99 页、概念页 35、搜索索引 134 条、Monorepo 图 5 包——均由注册表确定性生成。
- 本轮发现并修复：`package-fullstack-project.py` 未过滤 macOS `.DS_Store`（详见 `00-executive-summary.md` FIXED 项）。
- `build-search-index.py --check` 在按 CI 顺序重建后通过；单独对提交态直接 `--check` 会失败（索引漂移，见 P3 观察）。

## 技术债与风险

| 项 | 级别 | 说明 |
|---|---|---|
| 无根包管理清单 | P3 | 依赖靠 CI 临时 `npm install --no-save`；本机需预置 fake-indexeddb/Playwright。属有意设计（静态站点），非缺陷。 |
| 搜索索引把导航文案当正文 | P3 | 站点外壳知识总览文案进入 `<main>`，被提取进 body；需产品决策，未改。 |
| 构建产物漂移需 CI 顺序保证 | P3 | 未在重建前直接 `--check` 会失败；CI 顺序正确，线上不受影响。 |
| 测试脚本数量大（94 个） | P3 | 覆盖充分但维护成本高；历史审计已记录，暂不重构。 |

## 结论

工程结构清晰、职责边界明确、构建链路确定性总体良好。无 P0；本轮修复 1 项可复现性缺陷；其余为 P3 观察项。
