# KNOWVERSE V2 · 知域知识库

- GitHub Pages：`https://liucaidong.github.io/knowverse/`
- 版本：V2 / 2026-10-30
- **12 个专题、34 篇结构化文章、12 张 Mermaid 全景图、22 个历史节点。**
- 原有 V1 三条产品线及 8 个作品在 GitHub 原仓库继续保留；V2 统一产品主线入口和专题导航。

## 目录

- `knowledge/{topic}/index.html`：专题首页，包含全景图
- `knowledge/{topic}/{article}/index.md`：Markdown 文章源
- `assets/panoramas/*.mmd`：每个主题均有独立 Mermaid 全景图
- `assets/panoramas/*.svg`：离线可见的静态矢量备份（自动从同一知识节点生成）
- `data/search.json`：按文章内容生成的全文索引
- `provenance/`：来源与覆盖边界

## 工程原则

1. **本地构建、验证完成后一次提交**，避免过多提交触发部署。
2. Mermaid 是可编辑图的源格式；静态 SVG 是加载失败时的可用备份。
3. 全文检索在浏览器本地过滤生成的 JSON 索引，不涉及外部搜索服务。
4. 不发布聊天私人内容或凭证，也不谎称已逐字导出全部历史会话。
5. 依赖现代浏览器即可阅读，内容无需服务端运行。

## 内容来源

可恢复的历史对话摘要；此前个人知识库 v1 共 8 类专题笔记；KNOWVERSE v1 作品。具体来源说明见 `provenance/index.html`。
