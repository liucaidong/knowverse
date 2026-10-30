# 02 · pnpm Workspace：严格依赖是怎么形成的

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## `workspace:` 的价值不是方便，而是阻止错误来源

假设 `@knowverse/domain` 的 `package.json` 声明了 `"@knowverse/contracts": "workspace:*"`。pnpm 会把它解释为仓库内的工作区包，而不是将来有机会从 npm registry 下载的同名包；如果包在本地不存在，安装就应失败。相比允许 registry 回退的普通版本范围，这是更明确的来源契约。<a href="https://pnpm.io/workspaces">pnpm Workspace 官方说明</a>。

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// packages/domain/package.json
{
  "name": "@knowverse/domain",
  "dependencies": {"@knowverse/contracts": "workspace:*"}
}
```

**注意**：`workspace:*` 约束了依赖来源，不等于自动检查架构规则。例如它不会阻止 `contracts → api` 的不合理依赖，也不会自动创建 TypeScript 项目引用。

## 为什么 node_modules 不应被视作唯一真相

pnpm 使用内容寻址 store 与链接组织依赖。不同 pnpm 版本、node linker 配置、hoist 策略会影响实际目录。开发者偶尔在根目录能 `import` 一个并未在当前包声明的包，不代表这个引用受工程保护；它可能是被某个安装模式或编辑器环境意外暴露的**幽灵依赖**。

检查时不要仅执行 `ls node_modules`。更可靠的做法是读取每个包的 `dependencies`，执行严格的独立构建，并在 CI 运行 import 边界检查。对 React Native 来说，还应实测 Metro 是否正确处理工作区符号链接、`exports` 条件和平台扩展名，而不能因为 Node.js 能解析就假定移动端也能解析。

## 正向与反向过滤器的区别

在 pnpm 官方过滤语法中，`foo...` 选择 `foo` 和它的依赖；`...foo` 选择 `foo` 和它的被依赖者。记住：**箭头朝向依赖，但 changed 影响往往反向传播**。

```bash
pnpm --filter '@knowverse/api...' run build     # API 以及上游依赖
pnpm --filter '...@knowverse/domain' run test    # Domain 以及依赖它的包
pnpm --filter '...[origin/main]' run test         # 相对基准变更及相关依赖者
```

第三条命令要求 Git baseline 在 CI 中可用。浅克隆、没有 fetch 对应分支、rename / root config 变化都可能让选择结果与直觉不符。pnpm 11/12 的过滤语义细节要看**运行版本**，不要从多年以前的博客复制命令。

## 可复现实验：制造一个幽灵依赖

1. 创建 `packages/domain/src/illegal.ts`，尝试 `import` 一个未在 `domain/package.json` 声明的依赖。
2. 不要先手工安装到根目录；直接执行从干净状态的类型检查和构建。
3. 再在根目录临时安装依赖，观察为什么本机偶尔能运行而 CI 未必能够。
4. 删除依赖声明，要求检查工具能够报出准确的**包名、文件位置、缺少的声明**，而不是依赖系统是否“刚好找得到”。

## 容易被忽略的另一侧：peerDependencies

React 和 React Native 等运行时有宿主单例与版本兼容要求。共享 UI 库可能应使用 peer dependency，而非在自己包里安装第二份 React。**peerDependencies 是消费者需提供兼容宿主依赖的约定**，与 workspace 依赖来源是不同维度。必须验证实际依赖树、运行时单例和 bundler 的处理。

## 诊断题

`foo...` 和 `...foo` 哪个适合「改动基础类型库，筛出需要运行测试的消费者」？如果修改根 `pnpm-workspace.yaml`，为什么只筛出一个包可能不安全？
