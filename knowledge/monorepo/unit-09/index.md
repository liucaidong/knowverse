# 09 · React + React Native + NestJS 的跨端边界

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## 跨端最容易犯的错：把 TypeScript 等同于可移植性

同一个 `.ts` 文件能被三端类型检查，并不意味着它能运行在浏览器、Hermes 和 Node.js。举例：某个名为 `utils` 的包引入 `node:crypto` 或 `fs`，然后被 React Native 消费；TypeScript 可能通过，但 Metro 构建或设备运行会失败。反过来，直接把 `react-native` 平台组件导入 API 也没有意义。

因此跨端依赖边界首先按运行时分组，而不是先从复用率出发：

```text
                   contracts（纯协议）
                  ↗       ↑       ↖
      domain（纯逻辑）      │        mobile adapter
       ↑          ↑        │
   web adapter   api adapter
```

`contracts` 可以是基础类型、枚举、校验规则的抽象；`domain` 可以包含评分、计算、权限判断等纯业务规则；三个 adapter 负责 React 组件、RN UI 和 Nest Controller。若 `domain` 需要使用时钟、随机数、存储，就通过接口注入而不是直接调用平台 API。

## Web 边界

React 应用由 bundler 管理运行时模块；需要检查内部库导出的 ESM / CJS 目标、CSS 副作用、SSR 等需求。共享包的 `exports` 不能只为 Node.js 设计。构建时可以先对纯逻辑库生成声明与 JS，再让 Vite 等 bundler 消费稳定公共入口。

## React Native / Metro 边界

Metro 的 workspace symlink、package `exports` 与平台条件行为受具体 RN / Metro 版本影响。**不要依赖多年以前的 Metro 配置片段**；应使用当前 RN 官方建议的 Metro 配置基线，并在 iOS 与 Android 两个平台实际打包。旧工程升级时要检查 package exports 的优先级是否使 `.ios.ts` / `.android.ts` 路径不再按旧规则命中。

## NestJS 边界

Nest CLI 自身有标准/Monorepo 两种组织模式，但与 pnpm Workspace 或 Rush 的职责不同；Nest Monorepo 模式处理 Nest 应用/库的布局和构建，并不会自动管理整个 React + RN + Nest 的统一构建策略。实际案例可以把 Nest 放在 `apps/api`，将跨端契约作为独立 workspace package；Nest Controller 不应泄漏到 `contracts`。

## 迁移顺序

1. 先整理重复 DTO、领域规则和副作用调用。
2. 抽纯协议为 `contracts`；抽纯函数为 `domain`，为两者分别运行 Node 与 bundler smoke test。
3. 将 API 的数据装配和认证逻辑留在 `api` adapter。
4. React / RN 分别消费公开 API，尽量不共享具体 View 渲染实现。
5. 再增加缓存与任务编排；**功能正确优先于缓存命中率**。

## 诊断题

跨端类型库里有一个 `import type` 指向 `@nestjs/common`，虽然 TS 可以擦除类型导入，但这条依赖是否真的没有成本？为什么？
