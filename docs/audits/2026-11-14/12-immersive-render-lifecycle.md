# 沉浸式知识场景渲染生命周期审计

日期：2026-11-14

## 审计范围

- `gallery/exhibits/monorepo-architecture/`：Monorepo WebGL 依赖星图。
- `puzzles/worlds/promise-mechanism-quest/`：Promise 挑战 Canvas 星图。
- `puzzles/worlds/promise-realm/`：约定之境全屏 3D 解谜。
- `gallery/exhibits/promise-cosmos/`：Promise 宇宙 WebGL 展览。

## 发现与修复

1. Monorepo 与 Promise 挑战场景此前在滚动离开视口后仍持续提交动画帧。现在通过 IntersectionObserver 跟踪场景可见性；离开视口时取消当前帧，重新进入时恢复。浏览器不支持 IntersectionObserver 时保留原有渲染能力。
2. 四个场景此前均未统一处理浏览器标签页隐藏。现在在 document.visibilitychange 时暂停动画帧；恢复可见时重新调度，并重置时间基准，避免后台停留时间造成动画时间步长突变。
3. Promise 挑战场景的销毁代码此前以新建匿名函数移除 pointer 监听器，无法移除原监听器。现在使用具名监听器，销毁时准确移除 pointer、resize、visibility 监听并断开两个 Observer；页面离开时主动销毁场景。
4. Monorepo 场景同样在销毁时断开 IntersectionObserver、ResizeObserver 和 document visibility 监听，避免残留生命周期订阅。

## 保留项

- 未改变场景内容、教学交互、挑战题目、学习记录或持久化策略。
- 不修改同步逻辑、Supabase、认证或真实学习数据。
- Promise Realm 的完整屏幕场景仍可在页面可见时持续渲染；只在浏览器标签页隐藏时暂停。
- Promise Cosmos 保留用户的镜头暂停控制；浏览器标签页隐藏时额外停止渲染。

## 验证

新增 `scripts/e2e-world-render-lifecycle.mjs`，以 Chromium 实测四个场景：
- Monorepo 场景离开视口后停止帧调度，重新进入后恢复。
- Promise 挑战场景离开视口后停止帧调度，重新进入后恢复。
- 四个场景在 document.hidden 时均停止帧调度，恢复可见后重新启动。
- 页面无未处理的 JavaScript pageerror。

本审计只记录本次实际执行的自动化结果；完整站点验收以提交前终端测试输出为准。
