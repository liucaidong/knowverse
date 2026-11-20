# KNOWVERSE 推翻重做 · 完整任务清单（Goal 执行版）

> 版本：2026-11-20 ｜ 基线 tag：`p0-baseline-2026-11-20`（commit `056df32`）｜ 当前分支：`develop`（单分支，push 即生产部署）
> 配套：`docs/product/goal-mode-prompt-2026-11-20.md`（可独立运行的自动执行提示词）
> 说明：本清单把交付方案的 13 项待确认全部转为**默认决策**，使执行不再等待人工确认；硬边界即使被授权也不执行，标注 BLOCKED 后继续下一任务。

---

## 0. 当前状态（起点）

- 交付方案已认可、已提交已 push；P0 四个护栏任务已完成但**未提交未 push**。
- 未提交内容：`M docs/operations/production-configuration-runbook.md`（PROD_AUTHORIZED 标记）；新增 `assets/js/flags.mjs`、`supabase/functions/_shared/flags.mjs`、`scripts/verify-flag-skeleton.mjs`、`scripts/tooling/`（baseline-snapshot.json + ref-guard.mjs + freeze-boundary-guard.mjs）。
- P0 全量校验已通过（10 项 RC=0 + 构建可复现 + secret 扫描 NO）。

---

## 1. 默认决策（替代逐项询问）

| # | 原待确认项 | 自动决策（不等待确认） | 依据 |
|---|---|---|---|
| 1 | 新定位 | ✅ 已认可：问题驱动理解工作台，推翻重做 | 用户 2026-11-20 确认 |
| 2 | MVP 领域 | **Promise / JS 运行时** | 交付方案推荐，存量实验最成熟 |
| 3 | 生产 AI secrets / 真实模型验收费用 | **不配置、不调用生产**；AI 验收仅在 Staging 合成账户 | 硬边界（生产只读）+ D10 |
| 4 | Note 跨端 | MVP 不做，纯本地 IndexedDB；P4+ 再评估 | D6 |
| 5 | UI 框架 | **原生 ESM + JSDoc**；不引入构建工具 | D8 + AGENTS.md 禁根 package.json |
| 6 | note_type 枚举 | 最小集 `feynman / concept_map / self_quiz / reflection` | 合理默认，后续可扩展 |
| 7 | 追问轮次 / 重试 / 熔断 / 样本量 | 轮次 N=3；suggest 重试≤3；converse 重试≤2；熔断连续失败 5；评测样本≥200；兜底场景≥100 | 方案建议值，写入测试报告可回溯调整 |
| 8 | flag 命名 | 沿用 `supabase/functions/_shared/flags.mjs` 的 6 个 flag | P0 已建同源定义 |
| 9 | 错误码命名 | **不强行统一**；canonical + 旧码别名并行 | 程不宕建议，避免破坏双轨客户端 |
| 10 | SSE | P1 不启用（普通请求 + 流式待 P3 评估） | 降低 MVP 复杂度 |
| 11 | 覆盖率 / mutation / LLM-judge | 分支覆盖≥80%；mutation 用 Node 内置断言变异抽检；LLM-judge + ≥10% 人工抽检 | 方案建议值 |
| 12 | 生产迁移授权例外 | **不走**；如阶段确需生产迁移则标 BLOCKED | D2 生产只读 |
| 13 | 实体设备验收 | **BLOCKED**（无设备访问权），清单已交付用户 | 硬边界 |

> 所有默认值写入对应实现与测试报告，标注"自动决策、可回溯调整"；不编造指标。

---

## 2. 横切规则（每个阶段都必须执行）

1. **实现前**：从当前 HEAD 建阶段 tag 回退点（命名 `p1-start-2026-11-20` 等）。
2. **实现中**：仅按本清单改动；任何"为过测放宽校验"的改动立即回滚（No-Go）。
3. **验证**：跑 P0 全量校验（ref-guard / freeze-guard / flag-skeleton / validate-content / validate-v2 / site-architecture / verify-site-shell / public-content / KV41-010 / learning suite）+ 本阶段新增测试 + 构建可复现 `--check`；全部 RC=0 才算通过。
4. **安全**：secret 泄漏扫描（对照 `config/staging-ai-secrets.json` 值）；生产只读确认；数据/search.json 若被 build 改动须还原。
5. **提交**：每阶段独立 commit，显式中文规范 message；自验证通过后 push develop（触发生产部署，已预授权）。
6. **状态**：PASS / FAIL / NOT RUN / BLOCKED 如实标注；BLOCKED 写明前置条件；禁止 FAIL 改标 BLOCKED。
7. **日志**：追加 `.workbuddy/memory/YYYY-MM-DD.md`（append-only）。
8. **不停顿**：遇到阻塞不询问用户，标 BLOCKED 后继续下一任务；只有全部任务结束或硬边界阻断才停止。

---

## 3. 阶段任务

### 阶段 0 · 收尾 P0（起点）

| ID | 任务 | 验收 | 产出 |
|---|---|---|---|
| T0.1 | 提交并 push P0 护栏（含手册标记） | 全量校验通过 + push 成功 | commit + 工作区干净（除 .workbuddy） |

### 阶段 P1 · 新 IA + 首屏（E1）

| ID | 任务 | 验收 | 产出 |
|---|---|---|---|
| T1.1 | 建路由 manifest 单一事实源（Promise 领域优先），登记 canonicalId/newPath/legacyPaths | 构建期校验每条 legacyPath 有落点；缺失即失败 | `src/interface/router/route-manifest.js` |
| T1.2 | 今日工作台首屏：静态 shell 预渲染"今日问题 + ≤3 步行动"，无 JS 可见 | 3s 内可见；60s 内到首个理解点；LCP≤2.5s/INP≤200ms/CLS≤0.1/首屏 JS≤50KB | 升级 `scripts/build-site-shell.mjs` + 首页模板 |
| T1.3 | 极简导航（今日/探索/重现）+ 旧 4 组导航在旧路径保留 | `NEW_IA_ENABLED` flag 控制新旧；flag off 完全还原旧 IA | 导航组件 + flag 接入 |
| T1.4 | 五态组件（normal/empty/loading/error/no-permission）工作台 | 各态 E2E 通过，无 JS 依赖入口可用 | 组件 + E2E |
| T1.5 | feature flag 构建注入打通（同源常量 → 前端 `__KV_FLAGS__`） | 注入后构建可复现 `--check` 通过；默认全 false | 修改 build-site-shell.mjs 注入逻辑 |
| T1.6 | P1 阶段门 + 提交 push + tag | E1 全部 Given/When/Then 通过；flag off 可还原 | commit + tag `p1-done-2026-11-20` |

### 阶段 P2 · 核心循环 E2/E4 + AI 契约骨架

| ID | 任务 | 验收 | 产出 |
|---|---|---|---|
| T2.1 | 机制探索页（LabShell + TraceBadge 诚实性标注）复用现有 lab 引擎 | 改输入→状态可观察；教学 trace 与真实执行三重区分 | 探索页 + 适配器 |
| T2.2 | 轻量自测：仅评估契约通过才 append 证据，不记负面掌握 | 契约失败不写证据、重跑同一 validator；访问/停留/AI 自评不产生证据 | 自测页 + 证据回执 |
| T2.3 | AIProviderPort 领域端口 + Provider Adapter 骨架（converse/suggest） | 能力契约测试通过；strict schema 红线测试通过（含 KV41-011 真实失败输出快照） | `_shared/provider/` |
| T2.4 | v2 capability 契约 + v1 双轨（API_V2_ENABLED flag） | v1/v2 均可用；未知版本明确拒绝；错误码 canonical+别名 | Edge Function 契约层 |
| T2.5 | 间隔重现（E4）基于真实事件派生，KV41-010 因果链回归 | 历史已解决观察不要求重验；validPasses 不放宽 | 重现队列 + 回归测试 |
| T2.6 | EUUDefinition 注册表 + canonical ID 映射（旧 ID 锚点） | ID 唯一/引用完整/prereq 无环校验通过 | content 注册表扩展 |
| T2.7 | P2 阶段门 + 提交 push + tag | E2/E4 全绿；红线 hash 未下调 | commit + tag `p2-done-2026-11-20` |

### 阶段 P3 · AI 追问与降级（E3）

| ID | 任务 | 验收 | 产出 |
|---|---|---|---|
| T3.1 | 对话式追问状态机（单 Agent，硬轮次 N=3）+ 人工门禁 | 每轮推进、无死循环；AI 不写掌握事实；越权率=0 | `_shared/orchestration/dialogue.mjs` |
| T3.2 | 确定性兜底（薄弱点提示清单），AI 全不可用核心流程 100% | mock 全失败≥100 场景，100% 到达证据裁决 | 兜底生成器 + 回放测试 |
| T3.3 | Prompt 分层 + 版本化 + 防注入 + 后置越权检测 | 越权/注入/代写断言=0；prompt 版本可回放 | `_shared/orchestration/prompts.ts`/`.mjs` |
| T3.4 | Provider 熔断/有界重试/可观测（trace_id/prompt_version 等） | 重试重跑同一 validator；熔断短路不再调用 Provider；日志无 secret | `_shared/provider/` + `_shared/observability/` |
| T3.5 | 离线评测集 + LLM-as-judge（Staging 合成账户口径验证 ≤2%） | 报告标注"仅 Staging 合成账户口径；生产 NOT RUN" | 评测脚本 + 报告 |
| T3.6 | P3 阶段门 + 提交 push + tag | E3 全绿；兜底 100%；越权/代写=0 | commit + tag `p3-done-2026-11-20` |

### 阶段 P4 · 灰度绞杀 + 边界（E5）

| ID | 任务 | 验收 | 产出 |
|---|---|---|---|
| T4.1 | v1/v2 双轨灰度放量（NEW_IA_ENABLED/API_V2_ENABLED 默认逐步开） | 灰度期双路径可切换；flag off 无双写、无残留事件 | flag 放量配置 |
| T4.2 | search.json 单一生成入口 + body_hash + 观察→强制 | 提交==重建；P4 起强制阻断 | build/validate 规则 |
| T4.3 | 冻结边界 guard 进 CI 必过集 | drift=0；违规立即失败 | validate.yml 更新 |
| T4.4 | ref-guard 进 CI 必过集 | 0 unpinned 调用、0 未授权生产 ref | validate.yml 更新 |
| T4.5 | tooling/ 脚本分组收尾（re-export 垫片保留一周期） | 断言数/用例数不低于基线；规则 ID diff 通过 | scripts/tooling/ 迁移 |
| T4.6 | Note 本地检索（轻量倒排/FTS，不引入向量库） | 检索可用；不依赖生产 | 本地索引 |
| T4.7 | P4 阶段门 + 提交 push + tag | E5 全绿；回退无污染；生产只读断言成立 | commit + tag `p4-done-2026-11-20` |

### 阶段 P5 · 演进预备（默认不启动）

| ID | 任务 | 验收 | 产出 |
|---|---|---|---|
| T5.1 | 仅在 P0–P4 全绿且明确授权时启动 TS+Vite 演进预备 | 未授权则整阶段标 `NOT RUN（需授权）` 并跳过 | 无（默认不动） |

---

## 4. 硬边界（Goal 提示词授权也不得突破）

遇到以下事项：标 `BLOCKED` + 写前置条件，**不询问、不停顿**，继续下一任务。

1. 生产数据库任何写操作 / 迁移 / DDL / 清空。
2. 生产 Auth / OAuth / Secrets / Edge Function **配置**变更；读取或输出任何 secret 值。
3. 为通过测试放宽任何校验（validPasses 因果链、strict schema、评估契约、冻结规则）。
4. 向真实账户写测试数据；验证只用本地合成库 / PG17 / Staging 合成账户。
5. 实体设备（iPhone Safari / 第二物理设备）操作。
6. 跨浏览器同步频率 / 标签页等待 / 调度机制改动（AGENTS.md 冻结范围）。
7. 删除或跳过失败测试 / 伪造通过结果 / 把 FAIL 改标 BLOCKED。
8. 覆盖用户未提交工作、强推、历史重写。

---

## 5. 完成定义

- P0–P4 每阶段：阶段门全绿 + commit + push + tag + 日志追加。
- 全部任务结束：输出总报告——已完成 / 已测试 / 已提交 / 已部署 / 未完成 / 被阻塞 / 需授权，七类分列。
- 硬边界事项如实列入"被阻塞 / 需授权"，不写成已完成。
- 生产部署结果以只读探活确认（核心路由 HTTP 200 / 资源哈希一致），不宣称生产 AI 能力已验证。
