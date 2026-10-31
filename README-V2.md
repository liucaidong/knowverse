# KNOWVERSE V2 · 知域知识宇宙

- GitHub Pages：`https://liucaidong.github.io/knowverse/`
- 版本：V2 / 2026-10-31
- **12 个知识专题、92 条可检索内容记录、22 张 Mermaid 全景图、8 件已上线互动作品。**
- `content/knowledge.json` 是知识专题注册表；`content/works.json` 是三条产品主线与作品注册表；作品通过 `knowledge_ids` 关联专题。
- 首页精选专题、知识目录、三条主线作品卡片和专题页的关联体验由共享注册表驱动。

## 内容架构

- `content/knowledge.json`：稳定专题 ID、标题、分类、摘要、路由和精选信息。
- `content/works.json`：产品主线与互动作品；关系只在作品记录中声明，前端自动生成专题到作品的反向链接。
- `content/search-metadata.json`：搜索标题、摘要、标签等人工策划字段。
- `data/search.json`：从 Markdown 正文或 HTML 正文构建的全文搜索索引。
- `scripts/build-search-index.py`：确定性搜索索引生成器；内容验证与 Pages 部署都会执行。
- `assets/js/knowledge-graph.js`：从注册表生成首页专题/主线卡片，并在专题页显示相关互动体验。

## 目录

- `knowledge/{topic}/index.html`：专题首页，包含全景图与相关互动体验入口
- `knowledge/{topic}/{article}/index.md`：Markdown 文章源
- `assets/panoramas/*.mmd`：可编辑 Mermaid 源文件
- `assets/panoramas/*.svg`：离线可见的静态矢量备份
- `works/index.html`：全部互动作品总览，支持主线筛选、关键词搜索和关联专题跳转
- `lab/experiments/promise-debugger/`：Promise 运行时观测工作台

## Promise 调试工作台

工作台使用独立的 `TraceRuntime` 执行可编辑 JavaScript 代码，并为每个状态转移和调度动作生成快照。内置 13 组机制实验，覆盖 thenable 解析、Promise 采用与身份、reaction 链、catch / finally、all / race / any / allSettled、自我解决和空输入边界。

**边界说明：** 这是一个具有可观测内部状态的教学/调试运行时，不是 V8 或 JavaScriptCore 的内部调试接口。浏览器原生 Promise 的私有 reaction 队列不会被直接暴露。

## 工程原则

1. 静态 JSON 是内容注册表，不引入不必要的后台服务。
2. 作品与专题关系只维护一份，反向关系在呈现层推导。
3. 搜索正文从真实 Markdown/HTML 页面生成，不重复手工维护。
4. Mermaid 是可编辑图的源格式；SVG 是加载失败时的可用备份。
5. 所有本地路由、关系引用和搜索入口由 GitHub Actions 检查。
6. 不发布聊天私人内容或凭证，也不把推断当作逐字历史记录。

## 内容来源

可恢复的历史对话摘要、既有专题笔记及 KNOWVERSE 作品。来源与覆盖边界见 `provenance/`。
