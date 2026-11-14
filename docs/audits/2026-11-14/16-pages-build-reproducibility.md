# KNOWVERSE — Pages 构建可复现性补齐

日期：2026-11-14

## 发现

GitHub Pages 部署工作流构建 Concept 页面与统一站点 Shell，但没有执行知识上下文静态生成脚本。当前生成后的专题/文章 HTML 已提交，因此线上可用；但仅靠已提交的生成结果，无法保证知识注册表变化后部署仍能同步生成最新上下文。

## 实施

- Pages 与内容验证工作流在生成 Concept 页面后执行 `scripts/build-knowledge-context.py`。
- Pages 上传产物前执行 `scripts/validate-content.py`，校验知识上下文与知识/作品/能力注册表一致。
- Pages 上传产物前执行 `scripts/validate-site-architecture.mjs`，校验导航、规范路由与架构覆盖。

## 验收

- 本地按 Pages 的真实构建顺序执行全部构建步骤。
- 搜索索引在知识上下文生成之后构建，索引正文包含专题能力关系和互动体验入口。
- 连续构建两次并验证静态上下文、内容注册表和站点架构。
- 通过 Pages 部署后，抽查线上主页、专题、进度、来源和沉浸页面资源。
