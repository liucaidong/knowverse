# 01 · 先有依赖图，才有 Monorepo

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## 本章的真实问题：为什么「放进同一个仓库」还不够

假设一个学习平台同时运行 Web、iOS/Android 和 API：Web 使用 React，Mobile 使用 React Native，API 使用 NestJS。每端各自复制了一份 `Lesson` 类型和分数计算函数。一周后 API 的字段改名，前端仍使用旧字段；另一个星期，Mobile 为避免兼容问题复制了第三份实现。把三个应用搬进 `apps/` 并不能自动消除这些不一致——它们只是从多仓漂移变成单仓漂移。

Monorepo 真正要解决的是**变化如何沿边界传播**：谁是契约的所有者、谁可依赖谁、一个公共包变化后哪些任务必须跑、哪些发布对象受影响。如果这些问题答不出来，单仓仅仅增加了工具配置成本。

## 第一张图：目录不是依赖图

```text
repo/
  apps/web             # React 消费者
  apps/mobile          # React Native 消费者
  apps/api             # NestJS 消费者
  packages/contracts   # 数据契约
  packages/domain      # 纯业务逻辑
```

真正重要的是有方向的边 `consumer → dependency`。例如：`api → domain → contracts`，`mobile → contracts`。方向不能凭文件夹名字猜测，而应来自每个 `package.json` 的实际依赖声明。`domain` 如果意外依赖了 `apps/api`，即使 TypeScript 能编译，也会形成不合理的逆向边界。

## 三张容易混淆的图

| 图 | 节点是什么 | 边代表什么 | 解决哪类问题 |
|---|---|---|---|
| 包依赖图 | package / project | 消费者依赖提供者 | 是否产生循环、变更影响谁 |
| TS Project References 图 | tsconfig 项目 | 声明文件构建先后 | `tsc -b` 的拓扑编译 |
| 任务图 | `web:build` / `api:test` | 执行前置条件 | 调度、并行、缓存、CI |

这三张图通常相关，但**并不相同**。举例：`web` 在运行时依赖 `contracts`，但 `web:lint` 并不一定需要先执行 `contracts:build`。把每个任务全部依赖所有上游任务，会让正确性看似安全却极端缓慢。

## 最小验证：先从仓库读取事实

进入本专题的参考工程，运行：

```bash
node scripts/graph.mjs
node scripts/affected.mjs packages/domain/src/index.ts
node --test tests/*.test.mjs
```

第一条从每个包的 `dependencies` 读取边、检测循环并输出拓扑顺序；第二条从变化文件定位直接所属包，再求**反向依赖闭包**；第三条验证这些规则没有被重构破坏。这些工具仅是教学实现，不会冒充 Nx 或 Rush 的完整能力。

## 设计约束：先写出禁止边

- `packages/contracts` 不依赖 UI 框架、NestJS、Node 文件系统；它应该能被移动端安全消费。
- `packages/domain` 可以依赖契约，但不应依赖具体 HTTP Controller 或 React 组件。
- `apps/*` 是装配层，可以依赖下游库；下游库不应反向导入应用代码。
- 如果多个应用共享 UI，Web UI 与原生 UI 需要判断是否真的共享运行时或只是共享 design tokens。

## 自检问题

某人说「我们已经用 pnpm Workspace，所以有缓存、affected 和发布治理」。这句话混淆了哪些层？应怎样用证据逐项验证？
