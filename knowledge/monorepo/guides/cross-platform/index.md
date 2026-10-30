# 跨端 Monorepo：React、React Native 与 NestJS 排障清单

## 共享类型，为什么仍可能无法运行

一个类型纯净的 `contracts` 包可能被 React、React Native 和 NestJS 消费，但它的 JS 产物仍要面对三个不同的 resolver。Web bundler 可能把某些模块内联为浏览器代码；Metro 会考虑其自己的平台模块规则；Node.js 则依据 package `exports` 和实际 ESM/CJS 规则加载。能通过 `tsc -b` 只证明了类型编译图成立，不能替代 Web 与原生端的运行验证。

## 第一步：把核心与平台适配分离

推荐沿着依赖方向拆层：`contracts` → `domain` → `adapters`。在代码里代表的是**消费者到提供者**的导入方向（各端 adapter 依赖 domain 和 contracts），而不是让 contracts 向外调用组件。业务函数需要日期、随机数、文件系统等能力时，通过参数或接口从适配层注入；不要在纯逻辑包直接 import `node:fs`、React DOM 或原生 UI 模块。

## 第二步：评估包公开入口

```json
{
  "name": "@knowverse/domain",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  }
}
```

这份基础入口适合示例中的 Node 运行环境。若真实包需要 `react-native`、`browser`、`import`、`require` 等条件，必须明确这些条件的选择顺序与目标文件，分别在 Node、Web、Metro 上验证。不要因为某篇旧文章提过 `unstable_enablePackageExports` 就在现在的项目中盲目使用同一开关；Metro 配置与版本演进已发生变化。

## 第三步：React Native 的独立验收

至少覆盖 iOS/Android 两个 bundle，检查 monorepo symlink、pnpm 实际 node linker、Hermes、Native Module 版本、平台扩展名和 CodeGen 输入。启动失败时按层排查：是否 package 无法解析？是否 Metro 选择了错误条件导出？是否 JS 运行时使用了 Node 专用 API？还是 Native 模块没有正确链接？这些不是同一个错误。

对共享 UI 要区分三种诉求：统一样式 token、统一状态逻辑、统一具体组件。前两者通常成本较低；第三者可能需要跨平台组件抽象或分开实现。**“重复少一点”不是压倒所有平台限制的目标。**

## 第四步：NestJS 的独立验收

Nest CLI 的 Monorepo 模式是一套围绕 Nest 应用和库的 CLI 组织模式，它不自动管理 pnpm Workspace 中 Web/RN 的整个任务图。可以把真正的 Nest 项目放在 `apps/api`，但 Controller、Provider、依赖注入装饰器等服务端实现必须留在适配层。公共 `contracts` 只定义跨端数据协议；对于网络请求数据还必须进行运行时校验，不能用 TypeScript interface 当作输入安全检查。

## 第五步：CI 里的四段证据链

1. **Node 参考工程**：`node --test` 验证纯逻辑依赖图和类型计算。
2. **TypeScript Build**：`tsc -b` 验证 references、DTS 产物和消费者类型。
3. **Web & API**：分别运行正式 bundler build 和 Nest 的真实启动烟雾测试。
4. **React Native**：Android/iOS 都能 bundle，且最低支持设备可运行关键路径。

只在前两步完成的仓库应声明「核心契约示例可运行」，而不应该标成「React/RN/Nest 三端生产工程已经完成」。这也是本专题 starter 严格区分教学适配器和真实框架项目的原因。

## 参考

- [React Native Metro](https://reactnative.dev/docs/metro)
- [NestJS Monorepo](https://docs.nestjs.com/cli/monorepo)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
