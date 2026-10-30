# 幽灵依赖取证：为什么本机能跑、CI 却失败

## 先确定故障不是一个问题，而是四种不同的问题

**声明缺失**：`packages/domain` 从 `lodash` 导入工具函数，但自己的 `package.json` 没有声明这个包。由于根目录恰好安装过 lodash，本机解析成功，干净 CI 失败。**运行时分歧**：Node 能解析 `exports` 的 `default` 分支，Metro 却选择另一套条件，某端打包失败。**类型/运行时不一致**：TypeScript 找到了 `.d.ts`，最终 JS 入口却不提供某个符号。**构建顺序问题**：消费者先于提供者运行，声明产物尚未生成。

把这四类混成「pnpm 有 bug」会把排查引到错误方向。每次排障先写下：错误发生在安装、类型检查、bundle 还是设备运行阶段？出现在哪个项目包？是否可在删除 node_modules 后复现？

## 证据链 01：确认包所有权与声明

打开报错文件，找到最小导入，例如：

```ts
// packages/domain/src/calc.ts
import { parseScore } from '@knowverse/contracts';
```

然后逐项检查：`packages/domain/package.json` 的 `dependencies` 是否包含 `@knowverse/contracts`；其版本是否使用明确的 `workspace:` 约束；工作区是否实际包含对应的包路径；名称是否与包 `name` 精确一致。`paths` 配置不能代替这一步，因为它只影响 TS 模块查找，不保证 Node 或 Metro 的可运行入口。

## 证据链 02：用干净安装复现

```bash
# 保存必要文件后，在一个独立的临时工作树执行
pnpm install --frozen-lockfile
pnpm --filter @knowverse/domain exec node -p 'process.cwd()'
pnpm --filter @knowverse/domain run build
```

若当前仓库没有 lockfile，`--frozen-lockfile` 会失败，这正是输入不完整的信号；先在开发分支生成并审查锁文件，而不是在 CI 偷偷允许更新锁文件。还要核对团队配置的 linker、hoist、peer 处理策略，不能用肉眼看 `node_modules` 推断可靠性。

## 证据链 03：TS、Node 和 Metro 分开验证

`tsc -b` 正确说明类型编译图与声明产物成立；`node -e "import('@knowverse/domain')"` 才会验证 Node 条件导出；Web bundle 必须在项目 bundler 上跑；RN 还要运行当前 Metro 版本的 Android/iOS bundle。一次 TS 通过不是四次运行成功。

如果报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，重点检查消费者是否深度导入了未导出的子路径；不要靠修改 node_modules 内文件救火。如果某端找错入口，记录实际条件分支、扩展名和平台 resolver 的版本。

## 自动化防复发

在 PR 上添加一条 package boundary 检查：解析每个包的 import，检测外部依赖是否被当前包显式声明；内部依赖必须经过公开包名，不得跨越 `src/`；遇到动态加载或依赖生成器的边，输出需要人工审查的提示，不假装静态分析能覆盖所有调用。

再加一条清洁构建：从新的 workspace 安装、构建、运行导出入口。失败日志必须打印 package、导入语句、预期依赖位置和实际解析结果。多端工程还需要单独报告 Metro / Web bundler 的产物验证结果。

## 思考

如果一个 `import type` 因编译擦除没有出现在 JS 里，它是否完全没有工程成本？考虑编辑器声明跳转、编译图、类型工具版本和 CodeGen 后再回答。

## 参考

- [pnpm Workspace](https://pnpm.io/workspaces)
- [Node packages / exports](https://nodejs.org/api/packages.html)
- [React Native Metro](https://reactnative.dev/docs/metro)
