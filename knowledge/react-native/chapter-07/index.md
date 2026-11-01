# React Native 0.88：新架构时代的工程基线

本专题以 **2026-11-01** 为资料基准，当前采用 React Native 0.88 作为版本语境。版本信息会变化，升级项目时应重新核对官方 Release Overview。

| 版本 | 关键变化 | 学习意义 |
|---|---|---|
| 0.76 | New Architecture 默认启用 | 新项目开始以新架构为主 |
| 0.82 | 第一个仅运行 New Architecture 的版本 | Legacy Architecture 不再是可关闭的并行运行模式 |
| 0.84 | Hermes V1 默认启用 | JS Runtime 实现持续演进 |
| 0.87 | Strict TypeScript API 成为默认 API | 类型 API 与工具链更严格 |
| 0.88 | Web-based Event Dispatching 默认启用；SceneDelegate 支持等 | 工程细节继续演进，不改变核心架构主线 |

## 不要混淆三个时间尺度

**架构世代**：Legacy Bridge 与 New Architecture 的差异，决定核心抽象、渲染系统和 Native Module 机制。

**版本迭代**：每个 RN 版本会带来 Hermes、Metro、平台工具链和 API 的变化。它们不应被误认为重新定义 JSI / TurboModules / Fabric 的基本职责。

**项目工程状态**：项目是否使用 Expo、React Native Community CLI、某个 SDK 或特定原生库，会影响构建工具链和兼容矩阵。必须按项目真实版本核验，不能把最新 CLI 示例直接套进旧项目。

## 当前学习建议

1. 用 Build / Startup / Runtime 理清生命周期。
2. 用 JSI 和 TurboModules 理清 Native 调用边界。
3. 用 Fabric 的 Render / Commit / Mount 理清 UI 更新。
4. 用线程模型解释响应性和高优先级交互。
5. 最后再看 Release Notes、Gradle、CocoaPods、Metro 与 Hermes 的升级要求。

## 官方版本来源
- [React Native Releases Overview](https://reactnative.dev/releases/overview)
- [React Native Blog](https://reactnative.dev/blog)
- [Using Hermes](https://reactnative.dev/docs/hermes)
