# Nx 24 任务级 Affected 迁移实战

## 先问：旧仓库是不是仍在 Legacy 模式？

Nx 24 在新项目里把 **task-based affected** 作为默认策略，但已有工作区通过升级迁移可能保留 `affected.legacy: true`。检查版本、迁移结果、工作区 `nx.json` 以及本次 CI 环境变量覆盖。不同机器如果一边是 legacy、一边是 task-based，得到不同结果并不令人意外。官方说明（2026-10-29）强调，新算法主要根据任务自己的 inputs 和所配置的上游输入判定，而不是仅按被修改的 package 扩散整个任务集合。

## 为什么依赖存在却不一定运行任务

设 `web:build` 需要先执行 `ui:build`，这个 `dependsOn` 表示调度约束。但是 UI 测试文件的变化不一定影响 web 构建产物；如果 `web:build` 的 `inputs` 仅包含 production files、上游 production files，则 UI 的测试变更可以被合理跳过。反之，如果 web 的 bundler 从 UI 目录读取生成的 `dist/`，但你没有把这项输出声明为 `outputs` 或对应输入，任务级精确性可能导致错误跳过。

这是构建系统的本质：**正确的跳过比更快的跳过重要**。

## 一套从粗到细的迁移步骤

1. 固定一个可以复现的 Git baseline；确保 CI 能获取 merge-base，而不是只 checkout 一个提交。
2. 保留旧 CI 运行日志和 job 时间，记录被选中的 project 和 task。
3. 为关键目标明确 `inputs`、`outputs`：`build`、`test`、`lint` 最好按实际读取文件拆开。
4. 用 source / test / generated output / root lockfile 四类变更重复执行 affected，逐项对照真实构建结果。
5. 消除未声明的隐式输入（环境变量、配置继承、CodeGen、依赖二进制），再启用任务级策略。
6. 对比两种模式运行任务列表和失败率；若节省时间但漏掉该重跑的任务，迁移应回滚。

```bash
# 以 Nx 官方文档和本仓 Nx 实际版本为准
nx affected -t build test --graph
# 观察为什么某项任务被选中（各版本支持的解释参数可能变化）
nx affected -t build --explain
```

## 四个不可偷懒的检验场景

**A：只修改 `domain/test`**。测试应该重跑，生产 build 可以跳过，前提是测试文件真的不参与 build。**B：修改 `contracts/src` 的公开 API**。所有读取它的消费者构建/测试应按声明输入受到影响。**C：修改工作区 lockfile 或 TypeScript 共享配置**。可能需要扩大选择范围，不能把它归属到单个包。**D：删除生成文件并从远端缓存恢复**。检查 artifacts 是否完整，尤其是 DTS、JS、map、静态资源。

## 对比 Rush 与 pnpm

Rush 的项目选择、增量构建与远程缓存存在自己的配置约束；pnpm `--filter ...[origin/main]` 能筛出依赖者但不等于完整任务输入判定。用同一份故障样本比较，不要把它们的命令名字当成等价算法。

## 验收

任何一个受影响任务都应能回答：改变了哪个文件？属于哪个项目？被哪个 `inputs` 规则命中？需要哪个上游任务作为执行前置？命中/恢复缓存依据是什么？如果 CI 只能回答“因为 Nx 说需要”，工程证据仍不够充分。

## 参考

- [Nx 24 版本说明](https://nx.dev/blog/nx-24-release)
- [Nx Affected 文档](https://nx.dev/docs/features/ci-features/affected)
