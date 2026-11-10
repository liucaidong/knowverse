# React Native 0.88：新架构时代的工程基线

本专题以 **React Native v0.88.1** 为源码基线（2026-11-10 核验）。0.88.x 是当前学习的稳定版本线；本文区分 0.88.0 的功能变化与 0.88.1 的补丁修复。后续版本变化时，必须重新核对 Release Overview 与对应 tag。

| 版本 | 关键变化 | 学习意义 |
|---|---|---|
| 0.76 | New Architecture 默认启用 | 新项目开始以新架构为主 |
| 0.82 | 第一个仅运行 New Architecture 的版本 | Legacy Architecture 不再是可关闭的并行运行模式 |
| 0.84 | Hermes V1 默认启用 | JS Runtime 实现持续演进 |
| 0.87 | Strict TypeScript API 成为默认 API | 类型 API 与工具链更严格 |
| 0.88.0 | Web-based Event Dispatching 默认启用；SceneDelegate 支持；Java TurboModule 支持 ArrayBuffer | 事件系统与二进制数据通路出现值得追踪的实现变化 |
| 0.88.1 | JSI RuntimeDecorator 转发补齐；Yoga flex-shrink 浮点残差修复；iOS 构建诊断改进 | 补丁版继续修复运行时与布局边界，不代表架构重构 |

## 0.88.1 必须掌握的三个补丁级细节

1. **JSI RuntimeDecorator**：0.88.1 补齐 `createValueFromJsonUtf8`、`createArrayBuffer` hooks 与 `String::length` 等转发。阅读 `jsi.h` 和相关 RuntimeDecorator 实现时，要区分接口声明、装饰器转发与具体 JS 引擎实现。
2. **Java TurboModule ArrayBuffer**：0.88.0 引入 Java TurboModule 的 `ArrayBuffer` 参数和返回值映射。非 owning buffer 是借用内存，方法返回后不可继续访问；需要保留时必须在方法内复制。`ArrayBuffer.kt` 明确记录了生命周期约束。
3. **Yoga 修复**：0.88.1 修复 flex shrink 总量为正浮点残差时的异常行为。布局问题应同时看 RN ShadowTree 的布局调用链与 Yoga 算法，不能把 Yoga 误认为平台 View Mount。

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


## v0.88.1 源码走读

0.88.1 是 0.88 的补丁版本，不是新的架构世代。补丁中的 JSI RuntimeDecorator 转发修正、Yoga flex-shrink 修复，以及 Android TurboModule ArrayBuffer 的借用内存生命周期，适合用来练习从 release note 定位到具体源码。

- [React Native v0.88.1 Release](https://github.com/react/react-native/releases/tag/v0.88.1)
- [0.88 发布说明](https://reactnative.dev/blog/2026/10/19/react-native-0.88)
- [Android ArrayBuffer 实现](https://github.com/react/react-native/blob/v0.88.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/bridge/ArrayBuffer.kt)
- [TurboModule 的 ArrayBuffer 类型](https://github.com/react/react-native/blob/v0.88.1/packages/react-native/ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.h)
- [JSI Runtime 接口](https://github.com/react/react-native/blob/v0.88.1/packages/react-native/ReactCommon/jsi/jsi/jsi.h)
