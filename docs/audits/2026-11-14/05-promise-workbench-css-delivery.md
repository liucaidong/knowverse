# KNOWVERSE — Promise 调试工作台阻塞样式清理

- 日期：2026-11-14
- 分支：`develop`
- 范围：只清理 Promise 调试工作台已经不使用的旧样式请求；不更改工作台布局、运行时、场景、调试交互或学习集成。

## 发现

对 146 个页面执行 Chromium CSS Coverage 后，`lab/experiments/promise-debugger/debugger.css` 在工作台页面中请求了 10,394 B，但覆盖记录为 0 个已匹配字节。进一步核对加载器发现：

1. 页面先通过 link 请求 `debugger.css`。
2. `debugger.js` 下载并解压当前版本的工作台 bundle。
3. 加载器随后主动移除 `debugger.css`，并注入 bundle 内的基础 CSS。
4. `workspace-layout.css` 提供当前 IDE 布局样式。

因此旧 CSS 请求只增加一次样式表传输和阻塞机会，随后即被丢弃；它不是当前工作台的样式来源。

## 实施

- 从 Promise 工作台 HTML 移除旧 `debugger.css` link。
- 删除加载器中移除该旧 link 的无效逻辑。
- 删除不再被页面使用的 `debugger.css` 文件。
- 更新 Promise 专题完整性校验，保留对 bundle、运行时、布局样式和工作台入口的检查。
- 新增浏览器回归，确认不再请求旧 CSS，bundle 样式和布局样式正常加载，13 个以上场景按钮可用，桌面可运行代码，移动端无布局溢出。

## 验收

- Chromium 桌面与 WebKit 移动：旧 CSS 请求数为 0，bundle CSS 注入成功，`workspace-layout.css` 正常加载。
- Chromium 桌面：运行代码后帧计数正常更新。
- WebKit 移动：工作台布局宽度不超过视口，运行入口保持可用。
- Promise 工作台结构/响应式布局静态校验通过。
- Promise 专题 20 课、运行时和挑战完整性校验通过。

## CSS Coverage 使用边界

Coverage 结果受动态注入、延迟初始化、未触发的交互状态及伪类影响，不能直接将未命中规则视为死代码。因此本次只删除了加载器明确主动移除、且被浏览器验证为冗余的旧样式表；没有批量裁剪全站共享 CSS。

## 边界

不改 Supabase、云端同步、学习档案或认证；不启动 GitHub CI。Git 推送不代表 GitHub Pages 已部署。
