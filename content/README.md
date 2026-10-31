# 内容管理规范

KNOWVERSE 使用静态 JSON 注册表，不依赖 CMS 或服务端数据库。专题、互动作品和全文搜索的职责分离，并通过稳定 ID 建立关系。

## 内容来源

- `content/knowledge.json`：12 个知识专题的稳定 ID、标题、分类、摘要、专题路由、主题色、精选状态和检索标签。
- `content/works.json`：三条产品主线和全部互动作品；每件作品通过 `knowledge_ids` 关联一个或多个知识专题。
- `content/search-metadata.json`：人工策划的搜索标题、主题标签、摘要和目标路由，不存放重复的正文。
- `data/search.json`：生成文件。正文从对应的 `index.md` 优先提取；没有 Markdown 源时从页面 HTML 正文提取。

## 字段约定

每项作品必须具有 `id`、`pillar`、`title`、`href`、`summary`、`status` 和非空 `knowledge_ids`。

- `pillar`：`lab` / `gallery` / `puzzles`。
- `status`：`live` / `planned` / `archived`。
- `href`：以站点根目录为基准，采用 `./` 开头的相对地址。
- `knowledge_ids`：必须引用 `content/knowledge.json` 中已存在的专题 ID；关系只在作品侧声明，专题反向作品列表由前端计算，避免维护两份关系。
- `live` 作品必须指向独立、可直接访问的体验页面，不能指向产品主线目录本身。
- 每件新作品创建独立目录和 `index.html`，登记唯一 ID 和唯一入口。

## 构建与验证

本地更新搜索内容后执行：

    python3 scripts/build-search-index.py

验证生成结果与页面引用：

    python3 scripts/validate-content.py
    python3 scripts/validate-v2.py

GitHub Actions 的内容验证与 Pages 部署都会先运行搜索索引生成器。新增/修改文章时更新 Markdown 或 HTML 源；只有需要策划搜索标题、摘要、主题标签时才更新 `search-metadata.json`。
