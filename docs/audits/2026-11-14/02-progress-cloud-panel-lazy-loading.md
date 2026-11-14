# KNOWVERSE — 学习驾驶舱云端档案面板延迟加载

- 日期：2026-11-14
- 分支：`develop`
- 范围：只延迟加载学习驾驶舱底部的云端账户 / 档案管理 UI；不改变同步引擎、同步频率、云端请求、Supabase、IndexedDB 迁移或学习记录。

## 问题

`progress/index.html` 的「个人学习档案」位于页面底部，但 `learning-progress-page.mjs` 原先静态导入 `backend/account-panel.mjs`，导致用户只查看今日计划、知识图谱和薄弱点时，也会下载该面板模块。

## 实施

- 移除账户面板静态导入，改为 `ensureAccountPanel()` 动态导入。
- 把 `cloud-account` 纳入既有 IntersectionObserver；滚动到该区域附近才挂载面板。
- 不支持 IntersectionObserver 的浏览器回退为启动时挂载，确保功能可用。
- 保留 `getArchiveRuntime()` 原有初始化及后台 `initialSyncPromise` 处理；仅延迟 UI 模块，不改变云端同步触发时机或同步逻辑。
- 导入失败会清空 Promise，允许用户后续重新触发加载。

## 资源测量

本地 Chromium，1440 × 960，静态 HTTP 服务，浏览器等待 `networkidle` 并等待 `learningProgressReady` 后统计资源 `encodedBodySize`：

- 首屏资源编码体积：422,347 B。
- 脚本请求：18 个，脚本编码体积 265,254 B。
- `backend/account-panel.mjs` 未在首屏请求中出现；该模块源文件为 20,594 B，现仅在进入档案区域时加载。

该测量代表本地浏览器资源，不等同于线上 CDN 传输体积或实际用户网络耗时。

## 验收

- Chromium 桌面与 WebKit 移动：首屏均不请求账户面板；滚动至档案区域后模块加载、面板成功挂载。
- Chromium 桌面与 WebKit 移动：直接打开 `#cloud-account` 深链接均能挂载档案面板。
- 相关联合回归：50/50 通过，覆盖学习计划、智能分析、每周复习、导航、路由、Promise 课程、复习工作台、布局与性能。
- 站点架构与内容注册表验证通过；`git diff --check` 通过。

## 边界

没有改动或主动触发任何云端同步行为；没有访问或修改 Supabase 数据；没有更改真实学习档案。Git 推送不代表 Pages 已部署。
