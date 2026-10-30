# 10 · 从代码治理到 AI Agent 的单仓闭环

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## 「项目健康」不是单一 lint 通过率

复杂 Monorepo 的稳定性取决于多个契约是否一致：`package.json` 声明的依赖，`tsconfig` 引用的构建关系，源代码的 import，文档中的架构边界，实际 CI 的 task inputs，以及发布记录。任何两者漂移都可能产生「本地能跑，CI 失败」或「CI 全绿，线上错误」。

用户此前提出的工程治理闭环可以直接落在 Monorepo：**Goal → Plan → Build → Verify → Audit → Continue/Complete**。重点在于验收的证据来自执行而非 Agent 自我宣称。

## 四类自动化检查

- **依赖声明**：每个跨包 import 必须映射到 `package.json` 声明的本地依赖，禁止无声明直接读另一个包的 `src`。
- **架构边界**：低层库不能依赖上层应用；React Native 禁止引入 Node-only 模块；`contracts` 不依赖 UI 框架。
- **编译与运行一致性**：`tsc -b` 成功后，还应运行 Node 包入口 smoke test、Web bundler 构建和 Android/iOS 验证。
- **发布证据**：变更基线、受影响任务、缓存命中、版本差异、回滚步骤都应保存在 CI 输出中。

## AGENTS.md 是约束入口，不是魔法权限

Agent 可以通过 `AGENTS.md` 读取仓库规则，例如：「修改 contracts 时必须跑全端类型检查」「RN 代码不允许使用 `node:fs`」「禁止直接改生成的 `.d.ts`」。但文本规则本身不会自动阻止 Agent 产生不合法修改。只有将规则映射到可执行脚本、CI 和审计证据，约束才有工程效力。

## Evidence Graph：连接主张与证据

每个关键需求至少保留一条证据链：

```text
目标：跨端共享 StudyEvent 不出现类型漂移
  → 代码：packages/contracts/src/index.ts
  → 依赖：domain / mobile / api 的 package.json
  → 类型校验：tsc -b
  → 运行验证：Node API / RN Metro 打包
  → CI 记录：commit SHA、环境与执行日志
```

这样既可诊断 Spec Drift，也可为未来的 Coding Agent 提供可追溯的变更上下文。自动修复任务应先检测不一致，再提出修改，最后通过同一验证门禁；不能把「Agent 说已完成」当成验收。

## 迁移里程碑与退出条件

**M0**：只有目录，没有明确依赖；记录幽灵依赖和跨包 import。**M1**：所有依赖声明显式、基本包边界检查通过。**M2**：TypeScript 构建图可靠；改变公共契约能让错误准确暴露。**M3**：affected 与缓存加入，记录正确性和耗时。**M4**：发布与审计闭环，能安全回滚。若 M1 未成立，直接上线 M3 可能把错误固化为“高命中缓存”。

## 诊断题

当代码文档说 `contracts` 不应依赖 `api`，但真实 import 已经出现这条边，应该相信谁？怎样组织 CI 才能及时让漂移失败？
