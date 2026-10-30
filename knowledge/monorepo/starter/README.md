# KNOWVERSE — 可运行的 Monorepo 参考工程

这个示例刻意不引入 React / React Native / NestJS 的实际依赖，目的是**先隔离验证工作区依赖、TypeScript 项目引用、受影响分析**三个机制。`apps/*` 是跨端适配边界演示，而不是声称三个框架项目已经可启动。

## 无依赖验证（只需 Node 20+）

```bash
node scripts/graph.mjs
node scripts/affected.mjs packages/domain/src/index.ts
node --test tests/*.test.mjs
```

## pnpm + TypeScript 真正构建

安装 pnpm 与 Node（以团队经过测试的版本为准）后：

```bash
pnpm install
pnpm exec tsc -b --verbose
pnpm run run:api
pnpm --filter "...@knowverse/domain" run build
```

根 `tsconfig.json` 是 solution 配置；`packages/*` 和 `apps/*` 都使用 `composite` 与显式 references；`workspace:*` 保证本地依赖不会退回注册表。TS 示例以 5.8+ 的稳定语法为兼容基线，不代表推荐一直锁定旧版编译器。升级到新的 TS 主版本前，请验证 RN/Metro、Nest 编译器插件及类型工具链。

## 三种图不是同一张图

- **包依赖图**：`@knowverse/api → @knowverse/domain → @knowverse/contracts`。
- **类型构建图**：由 `tsconfig.json` 的 `references` 建立，`tsc -b` 用它决定编译顺序。
- **任务图**：构建、测试、Lint、发布等任务的前置条件，通常由 Nx/Turbo/Rush 等管理。与前两者不能混同。

## 真实项目迁移建议

1. 将 `apps/web` 替换为真正的 React/Vite 工程；将 `apps/mobile` 替换为 RN/Metro 工程；将 `apps/api` 替换为 NestJS 工程。
2. 保留 `contracts` 无运行时平台依赖；禁止 React Native 直接消费 Node-only 依赖。
3. **先验证 Metro 对 pnpm symlink 和条件导出的实际行为**，再启用严格发布映射和构建缓存。
4. Nx 24 默认按任务输入执行 affected；迁移旧仓库需检查 `affected.legacy`。
5. 把 Git 全局配置、环境变量、CodeGen 的隐式输入纳入变更检测与缓存策略。

## 官方出处

- https://pnpm.io/workspaces
- https://pnpm.io/filtering
- https://www.typescriptlang.org/docs/handbook/project-references.html
- https://nx.dev/docs/features/ci-features/affected
- https://rushjs.io/pages/maintainer/build_cache/
- https://turborepo.com/docs
- https://reactnative.dev/docs/metro
- https://docs.nestjs.com/cli/monorepo
