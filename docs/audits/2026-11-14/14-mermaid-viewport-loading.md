# KNOWVERSE — Mermaid 按视口延迟加载

日期：2026-11-14

## 发现

全站 26 个知识页面包含 27 个 Mermaid 图。原有 `v2.js` 在页面启动时只要发现任意 `.mermaid` 节点，就立即下载 Mermaid ESM 并渲染所有图，即使图表远在首屏以下。

## 实施

- 使用 IntersectionObserver 观察 Mermaid 节点，进入视口前 240px 才触发加载。
- 同一页面只创建一次 Mermaid 动态导入 Promise；多个图表按进入视口的顺序分批渲染。
- 浏览器不支持 IntersectionObserver 时保留立即渲染回退。
- CDN 不可用时保留原有源码回退提示，不阻断页面正文。

## 验收

- 新增 `scripts/e2e-mermaid-lazy-loading.mjs`。
- Chromium 将 Mermaid 图人为置于首屏以下，确认初始加载阶段不请求 CDN。
- 滚动到图表附近后，确认只触发一次 Mermaid 模块请求并成功调用初始化与渲染。
- Promise、专题路由和页面启动回归通过。
