# 06 · Affected：从文件变更到任务的精确传播

> 来源说明：根据历史对话与官方文档归纳编写的独立教材，不是原始聊天逐字转录。技术事实以校对日期与项目实际版本为准。

## 一条变化如何扩散

以图 `api → domain → contracts`、`web → domain`、`mobile → contracts` 为例：修改 `domain` 的生产源码，应首先标记 `domain`，再沿「谁依赖 domain」反向走到 `api` 与 `web`；`mobile` 并不依赖 `domain`，因此不该自动纳入。同理，改 `contracts` 会触及所有消费者。

这里必须明确**方向约定**：包依赖图的边通常画成「消费者 → 提供者」，但受影响传播应沿反向边。这是很多教程把 affected 图画错的根源。

## 从项目级 affected 走向任务级 affected

早期工具往往先找受影响项目，再运行被请求的每项任务。Nx 24（2026 年 10 月）则把任务级 affected 作为新仓库默认策略：任务是否被选取主要取决于其 `inputs` 和相关上游输入，并允许测试文件变化只触发 `test`。官方迁移文档提示，升级现有仓库可能通过 `affected.legacy: true` 保留旧策略，必须显式检查配置；不能只看 CLI 版本就认定启用了新算法。

```text
package graph:  web → domain → contracts
                 api ↗

affected(project): changed(domain) → {domain, web, api}
affected(task):    changed(domain/test) → test 输入命中；build 输入可不命中
```

为什么 task graph 的 `dependsOn` 不足以判断 affected？因为执行顺序依赖与变化读取之间缺少必然联系。`web:test` 即使先跑 `domain:build`，如果它实际上直接引用了 domain 的源码，但未声明任何相关上游输入，task-based affected 也可能错误跳过。

## Git 基准的完整性

`git diff origin/main...HEAD` 依赖 merge-base；CI 若只 shallow clone 一个提交，可能缺少所需基准，造成比较不完整或命令失败。对 monorepo 还要处理：根级配置、锁文件、catalog 版本、代码生成器、Git rename、跨平台文件名大小写。可接受的安全策略是对无法归属的全局变更**扩大受影响集合**而不是乐观跳过。

## 一套可审计的输出

Affected 工具至少应输出：变更文件列表、文件到包的归属理由、传播路径、被选中的任务和任务输入依据。这比只打印一行 `5 projects affected` 有用得多。诊断时要回答「为何这个包受影响」和「为何那个包没有受影响」。

## 交互练习

打开「依赖图实验室」，点 `domain` 并选 `test only`：比较项目级和任务级输出；切换 `source` 再观察差异。注意实验里用了教学化输入模型，真实 Nx 应以 `nx affected --graph` 和 `--explain` 以及对应配置为准。

## 诊断题

如果 `domain:build` 已缓存，而 `web:test` 仍必须重跑，这两件事矛盾吗？需要怎样声明它们各自的输入？
