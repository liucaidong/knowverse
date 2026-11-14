# KNOWVERSE — 大型内联交互脚本外置与缓存审计

- 日期：2026-11-14
- 分支：`develop`
- 范围：只调整三个交互体验页面的 JavaScript 资源交付方式；不改 Promise 教学模型、动画步骤、存档结构、学习证据或同步行为。

## 发现

对仓库内 146 个 `index.html` 做静态资源盘点后，发现三个页面将较大的交互逻辑直接嵌入 HTML：

| 页面 | 原内联脚本 | 调整后 | HTML 文档减少 |
|---|---:|---:|---:|
| Promise 约定之境 | 38,295 B | 0 B | 38,247 B |
| Promise 身份实验 | 12,106 B | 0 B | 12,051 B |
| 微任务与 thenable 解析实验 | 8,980 B | 0 B | 8,921 B |
| **合计** | **59,381 B** | **0 B** | **59,219 B** |

说明：HTML 文档减少值与内联脚本字节数略有差异，因为替换后 HTML 中增加了外部 script 标签。外置不会让首次访问的脚本字节凭空消失；它将脚本从 HTML 响应中拆出，成为独立可缓存资源。浏览器缓存命中时，重复访问可避免再次传输这些脚本内容。

## 实施

- `puzzles/worlds/promise-realm/index.html` → `assets/js/promise-realm.js`
- `lab/experiments/promise-identity/index.html` → `assets/js/promise-identity-lab.js`
- `lab/experiments/microtask-resolution/index.html` → `assets/js/microtask-resolution-lab.js`
- 使用 `defer` 保证页面 DOM 可用后执行；现有模块集成和全站脚本顺序经浏览器回归验证。
- Promise Realm 的 `learning-repository.mjs` 动态导入路径改为相对于新脚本文件的位置，避免外置后解析到错误 URL。
- 页面专属关键 CSS 继续内联，避免为了资源拆分额外引入首屏阻塞样式请求。

## 验收

- Chromium 与 WebKit：三个页面的外部脚本请求成功、无未捕获异常、无横向溢出。
- Promise Realm：测试接口可用，初始化本地学习仓库并恢复章节状态成功。
- Promise 身份实验：原生 Promise 日志验证通过。
- 微任务解析实验：11 行实际 Promise/微任务日志与教学预期一致。
- 联合回归：56/56 通过，覆盖学习集成、导航、路由、复习工作台、Promise 课程、布局性能与延迟加载。
- 站点架构与内容注册表校验通过；`git diff --check` 通过。

## 资源治理结论

对 146 个页面继续静态扫描后，未发现超过 5 KB 的内联 JavaScript。剩余较大的内联片段是页面关键 CSS，不在本次无阻塞收益证据的范围内，因此保留。

## 边界

没有修改 Supabase、云端同步、学习数据、认证或业务策略；没有启动 GitHub CI。Git 推送不代表 GitHub Pages 已部署。
