# KNOWVERSE 第三个完整知识领域：React Native 新架构

实施基线：2026-11-01
版本语境：React Native 0.88
产品边界：沿用三条体验主线和统一 Learning Intelligence，不新增第四条主线。

## 建设结果

- 6 个 competency：Build artifacts、JSI boundaries、TurboModules / Codegen、Fabric render pipeline、Threading / priority、Integrated architecture。
- 12 个稳定 gap ID，每个 gap 有 A / B 两种独立 review variant，共 24 个变体。
- 3 件 live works：1 件原理实验、1 件 CSS 3D 空间展览、1 件六关挑战。
- 2 个非挑战 checkpoint，挑战由现有 Challenge Engine 产生完成证据。
- 课程路径 7 章，另保留历史会话线索页。
- 三条产品线统一通过 learning-integration.mjs 接入；探索活动本身不进入 mastery evidence。

## 能力依赖

```text
rn-build-artifacts
  └── rn-jsi-boundaries
        ├── rn-turbomodules-codegen
        └── rn-fabric-render-pipeline
              └── rn-threading-priority
        rn-turbomodules-codegen + rn-threading-priority
          └── rn-integrated-architecture
```

实际 prerequisite edges 以 content/learning-map.json 为准；所有依赖均在 React Native topic 内闭合。

## 三条体验主线

| 主线 | 作品 | 真实学习目标 |
|---|---|---|
| 原理实验室 | Fabric 渲染管线观测器 | 单步区分 Build / Startup / Render / Commit / Mount |
| 沉浸式展厅 | 新架构空间全景 | 在 CSS 3D 空间探索 Hermes、Codegen、JSI、TurboModules、Fabric 与线程 |
| 知识解谜世界 | 架构边界挑战 | 六关推理和能力点证据，错题定位 gap |

## 当前版本基线与纠错

- React Native 0.88 于 2026-10-19 发布，是本轮内容版本基线。
- RN 0.82 起为 New Architecture only；不要把 Legacy Architecture 写成现代项目的并列默认选项。
- RN 0.84 将 Hermes V1 设为默认。
- RN 0.87 将 Strict TypeScript API 设为默认 JavaScript API。
- RN 0.88 引入 Web-based Event Dispatching 默认路径及 iOS SceneDelegate 支持等变化。

版本信息会继续演进；课程保留官方资料链接，发布更新时需要重新核对。

## 概念边界

1. Hermes 编译和 Codegen 是两条构建产物路径，不能误画成彼此串行依赖。
2. JSI 是 JavaScript Runtime 与 C++ 的接口能力，不保证所有调用同步，也不保证所有数据零拷贝。
3. Codegen 生成 glue / platform interfaces，不会自动生成完整原生业务功能。
4. Fabric 主线是 Render → Commit → Mount；Yoga layout 位于 Commit，不等于 Mount。
5. JavaScript Thread 执行常见 React render；UI Thread 是唯一能操作平台 Host Views 的线程；高优先级事件能影响 Render 调度。
6. 只有有效 challenge / checkpoint / review 评估形成掌握证据；探索空间、点击节点与阅读文章只是活动。

## 官方来源

- https://reactnative.dev/releases/overview
- https://reactnative.dev/blog
- https://reactnative.dev/architecture/landing-page
- https://reactnative.dev/architecture/fabric-renderer
- https://reactnative.dev/architecture/render-pipeline
- https://reactnative.dev/architecture/threading-model
- https://reactnative.dev/docs/the-new-architecture/what-is-codegen
- https://reactnative.dev/docs/turbo-native-modules-introduction
- https://reactnative.dev/docs/hermes
