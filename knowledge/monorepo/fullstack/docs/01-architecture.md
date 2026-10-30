# 01｜把三种运行时从依赖图中隔离

本项目的关键不是把 React、React Native、NestJS 放进一个目录，而是确保 **共享契约与纯领域逻辑的依赖始终从平台外部指向平台内部**。

## 三张必须区分的图

**包依赖图**：`api/web/mobile → domain → contracts`。它决定哪些依赖可以声明为 `workspace:*`。

**构建图**：`contracts/build → domain/build → api/build`；Vite 和 Metro 消费共享包的编译结果。类型构建依赖不等于运行时依赖。`tsc --build` 只在 references 拓扑下安排预先声明的项目。

**任务图**：`install → build:shared → build:web / build:api → tests`；文件变更的 affected 集合只影响优化执行，不得以优化为借口漏测关键边界。

## 为什么不把 Nest DTO 类直接共享到 RN

Nest DTO 可能依赖 runtime metadata、class-transformer、Node-only 依赖；把这种类直接放在共享包中，会把服务端运行时和装饰器依赖带给 Metro。正确做法是共享纯 JSON shape：`LessonSummary` + `parseLessonsResponse(unknown)`，服务端使用它返回结果，客户端对网络边界再次验证。

## 为什么声明 `exports`

`exports` 是运行时可消费的包入口，不是 `tsconfig paths`。在一个包中 import `@kv/domain`，应当像真实第三方库一样由包管理器链接，不能依赖编辑器的虚拟路径。单一入口让跨端 bundler 和 Node 的解析来源一致，但也要求对 ESM 与打包工具兼容性做测试。

## 建议的判断顺序

1. 画出包图：谁可以 import 谁？谁无论如何都不能 import？
2. 画出应用到协议的变化传播：`contracts` 改动应影响 api、web、mobile。
3. 画出运行边界：API 接收网络请求，Mobile 的 localhost 指向手机。
4. 把禁止依赖规则写入 `tools/check-boundaries.mjs`，不依赖口头约定。
5. 由独立 CI 执行真实 `pnpm install` 和各应用构建；Node/TS 本地测试不能代替 Expo iOS/Android 编译。
