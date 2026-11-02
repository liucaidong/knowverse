# 内容管理规范

KNOWVERSE 使用静态 JSON 注册表，不依赖 CMS 或服务端数据库。导航、canonical route、专题、概念、能力、作品、评估和来源各自拥有明确事实源，并通过稳定 ID 建立关系。

## 内容来源

- `content/navigation.json`：全站三个一级导航分区；二级入口通过 `routeId` 引用 canonical route，不重复维护 URL。
- `content/routes.json`：canonical route ID、标题、页面类型与唯一站内路径。
- `content/knowledge.json`：12 个知识专题的稳定 ID、标题、分类、摘要、专题路由、主题色、精选状态和检索标签。
- `content/concepts.json`：独立 Concept 对象、概念关系、内容入口、作品、评估引用、来源引用和专题覆盖状态。Concept 是知识对象，不等同于 Competency。
- `content/sources.json`：可追溯的官方规范、文档与参考来源。
- `content/works.json`：三条产品主线和全部互动作品；每件作品通过 `knowledge_ids` 关联一个或多个知识专题，并通过 `learning.competencyIds` 关联可验证能力。
- `content/learning-map.json`：Competency 定义及明确的 `prerequisites` DAG；只有这里声明的依赖可以用于学习门控。
- `content/learning-checkpoints.json` / `content/review-assessments.json`：作品检查点与独立复习变体。Concept 使用稳定评估引用，不复制题目正文。
- `content/search-metadata.json`：人工策划的搜索标题、主题标签、摘要和目标路由，不存放重复的正文。
- `data/search.json`：生成文件。正文从对应的 `index.md` 优先提取；没有 Markdown 源时从页面 HTML 正文提取。
- `data/monorepo-graph.json`：生成文件。扫描真实全栈参考工程的 `apps/*/package.json` 与 `packages/*/package.json`，生成节点、依赖边和可并行构建层。

## 字段约定

每项作品必须具有 `id`、`pillar`、`title`、`href`、`summary`、`status` 和非空 `knowledge_ids`。

- `pillar`：`lab` / `gallery` / `puzzles`。
- `status`：`live` / `planned` / `archived`。
- `href`：以站点根目录为基准，采用 `./` 开头的相对地址。
- `knowledge_ids`：必须引用 `content/knowledge.json` 中已存在的专题 ID；关系只在作品侧声明，专题反向作品列表由前端计算，避免维护两份关系。
- `live` 作品必须指向独立、可直接访问的体验页面，不能指向产品主线目录本身。
- 每件新作品创建独立目录和 `index.html`，登记唯一 ID 和唯一入口。

## 页面生成与导航行为

`node scripts/build-public-content.mjs` 从知识、Concept、Competency、作品、评估和来源注册表生成概念详情页与知识目录卡片。`node scripts/build-site-shell.mjs` 在构建时生成所有公开页面的共享静态导航、全站账户入口、搜索容器和一致的页脚链接；导航在 JavaScript 启动前就存在。运行时 `assets/js/site-shell.mjs` 只为静态 Shell 绑定交互与账户状态，不再替换旧导航。

全屏沉浸式体验保留自己的画布与控制器，并提供返回 KNOWVERSE 的快捷出口；OAuth callback、测试 fixture 和被教程引用的嵌入式项目源码不注入全站导航。

## 构建与验证

本地更新专题搜索内容后执行：

    python3 scripts/build-search-index.py

从真实 Monorepo 参考工程重建依赖图：

    python3 scripts/build-monorepo-graph.py
    node scripts/build-public-content.mjs
    node scripts/build-site-shell.mjs

验证生成结果与页面引用：

    python3 scripts/validate-content.py
    python3 scripts/validate-v2.py
    node scripts/validate-site-architecture.mjs
    node --test scripts/verify-site-shell.mjs

GitHub Actions 的内容验证与 Pages 部署都会先运行搜索索引及 Monorepo 依赖图生成器，并检查生成结果是否可复现。新增/修改文章时更新 Markdown 或 HTML 源；只有需要策划搜索标题、摘要、主题标签时才更新 `search-metadata.json`。
