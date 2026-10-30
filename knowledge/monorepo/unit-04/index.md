# 04 · 包入口：types、exports 与跨端条件导出

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## 包边界存在三层，缺一不可

**源代码边界**：开发者承诺不从另一个包的 `src/internal/` 深度导入。**类型边界**：编译器只通过导出声明检查。**运行时边界**：Node.js、Metro、Web bundler 必须把相同公开名称解析到正确的产物。只配置 ESLint 不足以解决运行时差异；只配置 `exports` 也未必能阻止所有构建工具绕过深度导入。

```json
{
  "name": "@knowverse/domain",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

这是参考工程的最小出口设计。对 Node ESM 导出有效，并与 TS 项目引用的 `dist` 产物一致。在真正 React Native 共享库中，可能需要额外的 `react-native`、`browser` 等条件，**但不要在未测试 Metro 版本前抄一个复杂导出表**。不同版本的 Metro 对 `exports` 优先级、平台扩展名行为与符号链接处理有过变化。

## 为什么不直接共享 React 组件？

`contracts` 可以共享数据结构、事件协议、网络消息 schema（必要时配合运行时验证），但 `ui` 常常更复杂。Web DOM 组件和 Native View 并非同一个运行时；共享样式 token 和无平台副作用的状态计算，通常比共享具体渲染实现更稳健。

跨端代码建议拆为三个层次：

- `contracts`：纯类型和跨端协议，理论上无框架依赖。
- `domain`：业务规则，依赖 contracts；能在 Node 与浏览器运行。
- `adapters`：React hook、RN 组件、Nest Controller 分别适配运行环境。

**禁止的典型边**：`contracts → @nestjs/common`、`mobile → fs/promises`、`domain → react-native`。注意纯 TypeScript 类型 `import type` 虽然可在输出中擦除，也可能形成构建层依赖和工具链耦合；不能被当成无成本引用。

## 案例：声明产物与执行产物漂移

如果 `types` 暴露 `calculate(): number`，但 `default` 指向的旧 JS 返回字符串，TypeScript 消费者会通过，而运行时报错。解决策略不是把所有包都设成 `any`，而是：先 `tsc -b`，再针对导出后的**真实包入口**运行 Node ESM smoke test，并在 Web/RN 的打包流水线验证条件映射。

## 诊断题

为什么「编辑器可自动补全」不是「包可以跨端运行」的证据？如果一个包需要区分 Node.js、浏览器和原生端，你会优先写哪三种契约测试？
