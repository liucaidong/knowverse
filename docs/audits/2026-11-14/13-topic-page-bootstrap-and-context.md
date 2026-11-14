# KNOWVERSE — 专题页启动资源与知识上下文修复

日期：2026-11-14

## 范围

12 个知识专题入口页、知识目录、AI Agent 两个专题文章页，以及共享知识上下文模块。

## 审计发现

- 12 个专题入口页加载旧版 `knowledge-graph.js`（6,542 B）和 `knowledge-graph.css`（2,117 B）。知识目录也加载两项资源。
- 当前知识目录卡片由构建产物静态生成；所有实际入口页均不存在需要旧脚本回填的空目录。旧脚本在执行前检查后提前退出。
- 旧样式只对应旧脚本生成的 `.knowledge-related-*` 元素，当前页面没有这些消费者。
- 新版 `knowledge-context.mjs` 在专题入口筛选和文章上下文筛选中，把 `safeHref` 返回的 URL 字符串当作 URL 对象访问 `pathname`，触发 TypeError。专题与文章上下文因此没有渲染；异常只通过 console.warn 输出，原有全站路由 smoke test 未将其视为页面崩溃。
- 专题上下文原本并行下载 knowledge、works、learning-map、search-metadata 四份完整源注册表，合计 77,802 B；页面实际只需要精简后的展示字段。

## 实施

1. 从知识目录、12 个专题入口页和专题文章页移除旧脚本与旧样式引用。
2. 删除无实际消费者的 `assets/js/knowledge-graph.js` 与 `assets/css/knowledge-graph.css`。
3. 由 `site-architecture.css` 继续提供当前知识上下文组件样式。
4. 将专题和文章路径筛选修复为：先解析 `safeHref` 返回的绝对 URL，再读取其 pathname。
5. 新增 `scripts/knowledge_context_data.py` 与 `scripts/build-knowledge-context.py`，从四份规范源注册表生成 `content/knowledge-context.json`；浏览器端改为只请求这份页面专用数据。
6. 内容验证器检查编译产物与源注册表一致；公共内容清单登记新数据文件；README 记录构建入口。
7. 更新首页/知识目录布局性能测试，并新增 12 个专题入口、知识目录和专题文章的浏览器资源测试。

## 性能收益

- 每个专题入口页减少 8,659 B 未压缩旧资源（旧 JS 6,542 B + 旧 CSS 2,117 B），并减少一次无效脚本解析与执行。
- 四份上下文源注册表共 77,802 B，合并筛选后的展示数据为 16,406 B，减少 61,396 B（约 78.9%），并将四次 JSON 请求合并为一次。
- 实际传输压缩字节数以部署环境为准。

## 验收

- Chromium 逐一访问 12 个专题页，全部渲染唯一的 `.kv-topic-context`。
- 12 个专题页均加载 `v2.js`、`knowledge-context.mjs` 和 `site-architecture.css`。
- 12 个专题页均不请求旧版知识图谱 JS/CSS 或四份源注册表。
- 12 个专题页和专题文章均只请求一次紧凑上下文 JSON；知识目录使用静态架构概览，不请求上下文 JSON。
- 专题页均渲染 `.kv-topic-context`，文章页渲染 `.kv-article-context`，目录渲染架构概览。
- 不出现知识上下文初始化警告或未处理的页面异常。
- 首页/知识目录布局、全部规范路由、内容注册表验证通过。
