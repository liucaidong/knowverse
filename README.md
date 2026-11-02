# KNOWVERSE 3.0 · From Knowledge to Mastery

KNOWVERSE 是一个以知识结构为基础、以可验证掌握为目标的个人智能学习系统。它不是又一个 AI 笔记、AI 闪卡或 AI 聊天网站：知识需要有明确位置和来源，学习体验需要可执行，掌握状态需要由评估证据更新，下一步学习行动需要能够解释。

**三个持续问题：**我正在学什么，它与已有知识有什么关系？我真正掌握了什么，还有哪些概念误区？在当前时间里下一步最值得做什么？

## 产品结构

| 用户目标 | 产品入口 | 职责 |
|---|---|---|
| 知识体系 | `/knowledge/` | 领域、专题、Concept、文章、来源与显式学习关系 |
| 实践体验 | `/works/` | 三种学习方式：原理实验室、沉浸式知识展厅、知识解谜世界 |
| 学习成长 | `/progress/` | 今日计划、掌握图谱、薄弱点、复习与学习历史 |

学习智能引擎是横向平台能力，不是第四条产品主线。AI 导师和多模态资料中心属于后续增强能力，不能在未实现时当作现有功能宣传。

## 学习闭环

```text
知识专题 / Concept
        ↓
前置能力与学习目标
        ↓
原理实验 · 沉浸展厅 · 知识解谜
        ↓
Checkpoint / 独立 Review Assessment
        ↓
Append-only Learning Events
        ↓
Mastery / Confidence / Gap
        ↓
Explainable Adaptive Planner
        ↓
新的学习行动与不同变体验证
```

一次页面访问、视频停留、AI 自评或作品通关动画，都不自动等于掌握证据。只有通过评估契约的事件才可以进入学习智能引擎；AI 生成的内容只能先成为候选。

## 体验主线

**01 · 原理实验室**：通过可控输入、可观察状态、事件时间线和队列逐步推导机制。Promise 调试工作台是代表性作品，展示代码、Promise 对象关系、ThenableJob / ReactionJob、微任务 FIFO 与原生 Promise 对照。教学 TraceRuntime 与真实浏览器/Node 执行结果必须明确区分。

**02 · 沉浸式知识展厅**：用空间关系、生命周期、层级和因果路径表达抽象知识。场景保留文字标注、聚焦点和独立返回入口，不把动画效果当成知识解释本身。

**03 · 知识解谜世界**：明确目标、规则、可用证据与提交条件；完成后归类错因，并将待解决误区送入不同题型的独立验证，而不是只有分数和通关提示。

## 当前知识覆盖边界

截至 2026-11-02，注册表包含 **12 个知识专题、16 个 Concept、15 个映射 Competency、17 个互动作品、13 条参考来源和 42 条 canonical routes**。

Promise、TypeScript Monorepo、React Native 新架构这 3 个专题已有明确的 Competency 与先修 DAG。其余 9 个专题已有内容和文章，但尚未建立正式 Concept / Competency 图谱。KNOWVERSE 不会将章节顺序伪装成先修因果，也不会为这些专题伪造掌握分数。

详细覆盖与来源见 [`/provenance/`](provenance/index.html)，数据契约见 [`content/README.md`](content/README.md)。

## 技术架构

- **Public Content**：Markdown / HTML 教材、静态作品、Mermaid / SVG 与 JSON 注册表保存在 Git。
- **Canonical Registries**：`content/navigation.json`、`routes.json`、`knowledge.json`、`concepts.json`、`learning-map.json`、`works.json`、`learning-checkpoints.json`、`review-assessments.json`、`sources.json`。
- **Build-time Site Shell**：`scripts/build-public-content.mjs` 生成概念页和目录；`scripts/build-site-shell.mjs` 生成静态导航、账户入口、搜索容器与页脚。首屏不依赖 JavaScript 才能看到正确导航。
- **Learning Intelligence**：追加式学习事件、掌握/置信度 reducer、Gap 生命周期、独立复习和可解释规划。
- **Personal Data**：统一事务式本机学习状态包、IndexedDB Outbox / CAS 档案与 Supabase/RLS/受控 RPC；认证、账户白名单和云端恢复分开处理。
- **AI Augmentation**：后续通过服务端代理、来源引用、Schema 和评估门控引入，不直接拥有掌握度裁决权。

## 开发与验证

本仓库是以 GitHub Pages 发布的静态站点。无需前端框架构建即可阅读大部分内容；生成页面、导航和搜索索引时使用 Node.js 与 Python。

```bash
node scripts/build-public-content.mjs
node scripts/build-site-shell.mjs
python3 scripts/build-search-index.py
python3 scripts/build-monorepo-graph.py

python3 scripts/validate-content.py
python3 scripts/validate-v2.py
node scripts/validate-site-architecture.mjs
node --test scripts/verify-site-shell.mjs
node --test scripts/verify-public-content.mjs
node --test scripts/e2e-site-navigation.mjs
```

完整测试还包括 Promise 机制与调试台、作品挑战引擎、学习智能、主动规划、跨设备归档、Supabase 安全契约以及 Monorepo / React Native 教学域。GitHub Actions 负责 CI 和 Pages 发布。

## 能力状态声明

| 能力 | 状态 |
|---|---|
| 三个一级导航分区、全站账户控件、canonical route 与静态 Shell | 已实现 |
| 12 个专题、16 个概念页、3 个正式能力图谱 | 已登记；覆盖范围公开说明 |
| 三条体验主线及 17 个作品 | 已有作品登记；状态以 `content/works.json` 为准 |
| 本地学习事件、掌握分析、Gap、复习与规划 | 已实现，并由现有自动化测试覆盖 |
| Supabase 云端学习档案 | 代码与安全契约已实现；账户白名单、环境配置和运行时同步状态仍需实际验证 |
| AI 导师、来源驱动多模态问答、私人资料中心、持续视频辅导 | 规划中的增强能力，不作为当前已上线能力 |

## 产品原则

1. 一个知识对象只有一个 canonical ID 和一个事实来源。
2. Concept 是知识对象；Competency 是需要验证的能力；Assessment / Evidence 是学习结果事实，三者不能合并。
3. 只有明确声明的 `prerequisite_of` 才能影响学习门控；`related_to` 不代表先修。
4. 公共知识和作品保存在 Git；个人事件、私人资料和偏好保存在个人档案。
5. 本地学习不要求登录；身份认证不等于云端授权。
6. 多设备冲突必须明确处理，不允许静默 Last Write Wins。
7. AI 辅助教学，不直接写入掌握证据。
8. 不为增加数量而虚构知识图谱、来源、统计或已上线能力。
