# KNOWVERSE V2 · 知域知识库

- GitHub Pages：`https://liucaidong.github.io/knowverse/`
- 版本：V2 / 2026-10-30
- **12 个专题、34 篇结构化文章、12 张 Mermaid 全景图、22 个历史节点、8 个可直接打开的互动作品。**
- 三条产品主线共用 content/works.json 作品注册表；首页、作品总览和主线页面使用同一份数据。

## 目录

- `knowledge/{topic}/index.html`：专题首页，包含全景图
- `knowledge/{topic}/{article}/index.md`：Markdown 文章源
- `assets/panoramas/*.mmd`：每个主题均有独立 Mermaid 全景图
- `assets/panoramas/*.svg`：离线可见的静态矢量备份（自动从同一知识节点生成）
- `data/search.json`：按文章内容生成的全文索引
- `content/works.json`：三条产品主线的统一作品注册表
- `works/index.html`：全部互动作品总览，支持主线筛选与关键词搜索\n- `lab/experiments/promise-debugger/`：Promise 机制调试器，逐帧显示状态、调用栈、微任务队列并提供原生验证；支持方向键单步、空格播放
- `provenance/`：来源与覆盖边界

## 产品主线

1. **原理实验室**：通过精准模拟、单步运行和可复现实验理解机制。
2. **沉浸式知识展厅**：通过三维空间、镜头运动和叙事理解抽象结构。
3. **知识解谜世界**：把知识转化为可探索规则，通过假设与验证完成挑战。

三条主线共享作品注册表，但保持各自体验目标独立。

## 工程原则

1. **本地构建、验证完成后一次提交**，避免过多提交触发部署。
2. Mermaid 是可编辑图的源格式；静态 SVG 是加载失败时的可用备份。
3. 全文检索在浏览器本地过滤生成的 JSON 索引，不涉及外部搜索服务。
4. 不发布聊天私人内容或凭证，也不谎称已逐字导出全部历史会话。
5. 依赖现代浏览器即可阅读，内容无需服务端运行。

## 内容来源

可恢复的历史对话摘要；此前个人知识库 v1 共 8 类专题笔记；KNOWVERSE v1 作品。具体来源说明见 `provenance/index.html`。
