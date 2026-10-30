# 03 · TypeScript Project References 的真正边界

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## references 不是路径别名，也不是 npm dependencies

一个常见误解是：在 `tsconfig.json` 写了 `paths`，两个包就已经形成可靠的构建依赖。实际上 `paths` 影响的是模块查找映射，**不会改写运行时导入路径**，也不能替你保证发布包的 `exports` 有效。Project References 的作用不同：它把多个 TypeScript 编译项目连接成有向图，使 `tsc -b` 按顺序检查并生成声明文件。

```json
// 根 tsconfig.json：solution 模式
{
  "files": [],
  "references": [
    {"path": "./packages/contracts"},
    {"path": "./packages/domain"},
    {"path": "./apps/api"}
  ]
}
```

```json
// packages/domain/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {"rootDir": "src", "outDir": "dist"},
  "include": ["src/**/*.ts"],
  "references": [{"path": "../contracts"}]
}
```

共享配置里要给引用目标启用 `composite` 和 `declaration`，并确保所有源文件明确落在 `include` 中。`declarationMap` 支持跨项目的编辑器跳转；`.tsbuildinfo` 能帮助 TypeScript 增量判断。官方文档明确：普通 `tsc -p` **不会**自动像 `tsc -b` 那样构建引用依赖。

## 四个具体阶段

1. 读取根 solution references，得到构建入口。
2. 递归加载每个项目引用，检测环与输出配置。
3. 先编译 `contracts`，产生 `dist/index.d.ts` 和 `dist/index.js`。
4. 后续 `domain` 使用依赖声明文件进行类型检查，`api` 再消费 `domain` 的类型产物。

这里存在**两种合同**：TypeScript 检查用的 `.d.ts` 和 Node/Metro 执行用的 `.js`。二者可能不一致，例如 `types` 指向新接口，但 `exports.default` 指向了旧实现。代码能在 IDE 里自动补全，不能证明 Node 运行就正确。

## 一次真实故障

把 `contracts` 里的 `StudyEvent.state` 改成 `state: 'done' | 'pending'`，不修改 `domain`。如果 `domain` 仍检查 `state === 'fulfilled'`，`tsc -b` 应在消费者发现类型错误。这才是**共享契约带来的受控破坏**：由 CI 及时失败，避免三个端在运行后才出现语义漂移。

## ESM 与 NodeNext

TypeScript 项目在 `module: 'NodeNext'`、`type: 'module'` 的组合下，需要考虑最终 JS 的文件扩展名、条件导出和包入口。`export` 目录只暴露 `dist`，不要依赖 `src` 路径别名直接供运行时消费。Web bundler 和 Metro 可能支持不同的条件组合，必须按环境验证。

## 运行实验

```bash
pnpm install
pnpm exec tsc -b --verbose
pnpm exec tsc -b --dry
pnpm exec tsc -b --clean
```

参考工程在本地使用 TypeScript 5.8.3 做过实际编译验证。示例语法以兼容性为优先，不代表所有项目应停留在这个版本；升级 TS 大版本时需要对 Compiler API、eslint 插件、RN/Metro 和 Nest 构建链路单独做兼容矩阵。

## 诊断题

如果根 `tsconfig.json` 有 references，但只执行 `tsc -p apps/api`，为什么不能假设上游包会自动重建？如果使用 `paths` 指向 `contracts/src`，又有什么隐患？
