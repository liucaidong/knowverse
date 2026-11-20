# KNOWVERSE — 工程规则 (AGENTS.md)

本文件固化 KNOWVERSE 的长期工程规则、架构、安全要求、Git 工作流与测试标准。
来源：`README.md`、`docs/adr/`、`docs/audits/`、`docs/phase-*/`，并经 2026-11-20 仓库实检校准。
新会话或自动化 Agent 在本仓库工作前必须阅读本文件。

## 1. 项目身份

- 个人智能学习系统（Personal Intelligent Learning System），核心是**证据驱动的学习闭环**：
  Knowledge → Objective → Activity → Evidence → Mastery → Weakness → Adaptive Plan → Review → Reassessment。
- 仓库：`liucaidong/knowverse`；生产 Pages：`https://liucaidong.github.io/knowverse/`。
- 生产 Supabase：`sxcpareycpokcyroufww`；Staging Supabase：`ypthoicwrfsblaidllyy`。
- 根目录**无** `package.json`：这是静态站点 + 原生浏览器 ES modules + Supabase Edge Functions 的混合仓库。
  测试入口集中在 `scripts/`（Node test runner + Playwright + Python 校验器 + PG17 Docker 集成测试）。

## 2. 不可逾越的安全边界

1. 生产数据库只读。禁止 INSERT/UPDATE/DELETE/DDL、清空或回写历史学习事件。
2. 禁止修改生产 Auth / OAuth / Secrets / Edge Function 配置；禁止读取或输出 secret 值。
3. 生产迁移、生产数据变更、正式发布须有明确用户授权，且先设计回滚策略。
4. `supabase/.temp/linked-project.json` 指向 **Staging**，绝不用它推断或操作生产；生产操作必须显式指定 ref `sxcpareycpokcyroufww`。
5. 真实闭环验收只用隔离浏览器存储、本地合成数据库或 Staging 合成账户；不得向真实账户写测试数据。
6. 用户数据严格隔离：RLS + `auth.uid()` + allowlist；任何功能不得绕开用户数据边界。
7. 不把页面访问、视频停留、AI 自评或动画通关伪造为掌握证据；AI 只能产出候选，不写掌握事实。
8. 不执行跨浏览器同步频率、标签页等待或调度机制改动——该范围已明确暂停，除非用户解除冻结。
9. 保护用户未提交工作与历史审计资料：不覆盖、不删除、不 `reset --hard`、不强推、不重写历史。

## 3. Git 工作流

- 当前仓库实际只有 `develop` 一个长期分支（无 `main`）；生产 Pages 直接由 `develop` 推送触发部署。
  任何 push 到 `develop` 都会触发 CI（`.github/workflows/validate.yml`）与 Pages 部署（`.github/workflows/pages.yml`）。
- 开发前：`git status` / `git branch` / `git rev-parse HEAD` / 检查未提交与未跟踪文件 / 核对 `origin/develop`。
- 提交前必须检查 `git diff`，确认不覆盖用户工作，且相关测试通过。
- push 属于会触发生产部署的动作，须在自验证通过后执行；不擅自 force push / 删除分支 / 历史重写。
- CI 优先在 PR 阶段运行；本地能完成的检查先在本机执行。

## 4. 数据与架构原则

1. 一个知识对象只有一个 canonical ID 和一个事实来源；注册表在 `content/*.json`。
2. Concept（知识对象）、Competency（待验证能力）、Assessment/Evidence（学习结果事实）三者不合并。
3. 只有显式 `prerequisite_of` 影响学习门控；`related_to` 不代表先修。
4. 公共知识/作品在 Git；个人事件、私人资料、偏好在个人档案（IndexedDB + Supabase 同步）。
5. 本地学习不要求登录；认证不等于云端授权。多设备冲突显式处理，禁止静默 Last Write Wins。
6. `learning_events` 是 append-only；掌握度/置信度/Gap/计划由版本化 reducer 派生。
7. 同步须幂等、CAS 保护、可追溯；冲突整批回滚，不允许部分提交。

## 5. 测试标准（必须真实执行，禁止造假）

- 禁止删除失败测试、跳过测试、屏蔽错误或伪造通过结果来制造成功。
- 未执行的测试必须标记 `NOT RUN`；被外部条件阻断的标记 `BLOCKED` 并说明原因。
- 核心校验入口（在仓库根目录执行）：

```bash
# 静态内容 / 架构
python3 scripts/validate-content.py
python3 scripts/validate-v2.py
node scripts/validate-site-architecture.mjs
node --test scripts/verify-site-shell.mjs scripts/verify-public-content.mjs

# 学习引擎 / 后端契约（需要 fake-indexeddb）
node --test scripts/verify-learning-*.mjs scripts/verify-phase-*.mjs scripts/verify-backend-contract.mjs

# 数据库（需要 Docker/PG17）
bash scripts/verify-supabase-migration-replay.sh
bash scripts/verify-supabase-sync-isolation.sh

# 浏览器 E2E（需要 Playwright + Chromium/WebKit）
node --test scripts/e2e-site-navigation.mjs scripts/e2e-system-route-smoke.mjs

# 构建可复现性（重建后再 --check）
node scripts/build-public-content.mjs
python3 scripts/build-knowledge-context.py
node scripts/build-site-shell.mjs
python3 scripts/build-search-index.py && python3 scripts/build-search-index.py --check
python3 scripts/build-monorepo-graph.py --check
python3 scripts/package-fullstack-project.py && python3 scripts/validate-fullstack.py
```

- 完整 test matrix 以 `.github/workflows/validate.yml` 为准；本机依赖：Node 22、Python 3、Deno 2、Docker（PG17）、Playwright 浏览器。
- `npm` 在本机是 `pnpm` 的 shim，`npm install --no-save` 不可用；不要为此生成根 `package.json` 污染工作区。
- 构建产物确定性：ZIP 时间戳固定、`_site` 显式 allowlist、搜索索引可复现；本地 `.DS_Store` 等元数据不得进入产物。

## 6. 文档与审计

- 审计目录：`docs/audits/<YYYY-MM-DD>-*/`，保留历史审计用于对比，不覆盖。
- 报告必须区分：已完成 / 已测试 / 已提交 / 已部署 / 未完成 / 被阻塞 / 需要授权。
- 能力状态如实声明，不把规划中能力写成已上线；覆盖边界公开说明，不为数量伪造知识图谱/统计。

## 7. 已知外部阻塞（截至 2026-11-20，需用户授权或凭证，不得擅自处理）

- KV41-010（P1）：Staging 云端「无提示独立复习通过后 review task 仍 in_progress」，仅云端时序复现，本地因果链单测全绿；需 staging 真实账户复现后再改核心因果验证，禁止为通过测试放宽校验。
- Production AI Provider secrets 未配置：真实模型能力不可宣称已通过。
- Supabase Auth leak-password protection 未开启：需单独授权。
- 实体 iPhone Safari、第二物理设备、生产真实学习闭环：未验收。
- Production Phase N migration 时间戳与本地不同：语义已比对，但未执行迁移、不得擅自修正历史版本。
