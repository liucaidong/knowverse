# JSI：JavaScript 与 C++ 的接口层

JSI（JavaScript Interface）是 React Native 的 C++ 接口层，允许框架和 Native 模块以统一方式与 JavaScript Runtime 交互。它的核心价值是提供接口抽象，而不是承诺每一次调用都同步、所有数据都零拷贝。

## JSI 提供什么？

- Runtime 抽象：框架代码通过 JSI Runtime 与 JavaScript 引擎交互。
- JavaScript 值封装：C++ 可以持有、创建和调用 JS 值。
- HostFunction：把 C++ 函数暴露给 JavaScript。
- HostObject：让 JavaScript 访问由 C++ 实现的对象属性与行为。

```mermaid
flowchart LR
 JS[JS code] --> Binding[JSI binding]
 Binding --> HostFn[HostFunction / HostObject]
 HostFn --> Cpp[C++ implementation]
 Cpp --> Platform[Android / iOS API]
 Platform --> Result[Result / callback / Promise]
 Result --> JS
```

是否同步取决于 API 语义和执行线程；是否复制取决于值类型、持有方式和 Native 实现。JSI 改善接口与数据通路，不是取消所有系统边界。

## Bridgeless 是什么？

Bridgeless 表示 New Architecture 不再依赖旧 Bridge 作为 JS 与 Native 的核心通信机制。它不意味着应用中没有异步操作、消息调度或线程切换。

| 错误说法 | 正确理解 |
|---|---|
| JSI 就是 Bridge 2.0 | JSI 是 C++ / JS Runtime 接口抽象 |
| 所有调用都同步 | 同步性由具体 API 决定 |
| 所有数据都零拷贝 | 取决于数据结构与实现 |
| Bridgeless 没有异步边界 | Promise、事件和线程边界仍存在 |

## 官方资料
- [About the New Architecture](https://reactnative.dev/architecture/landing-page)
- [Fabric](https://reactnative.dev/architecture/fabric-renderer)
- [React Native Glossary](https://reactnative.dev/architecture/glossary)
