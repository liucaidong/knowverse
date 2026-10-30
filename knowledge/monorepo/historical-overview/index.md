# 历史会话笔记 · 主题总览

> 来源：2026-10-30 已恢复的个人知识库 v1 DOCX 内容摘录；这是一份既有摘要，不是原始对话逐字稿。

TypeScript Monorepo 与包管理治理

专题 02 / TypeScript 与工程架构

# 主题定位

pnpm workspace 基础、Rush/Nx/Turbo 的能力边界、受影响分析、任务缓存、发布与治理，核心痛点为依赖关系不清晰。

# 关键词

TypeScript · pnpm · Rush · Nx · Turborepo · affected · 缓存 · 发布编排 · 依赖关系 · repo graph

# 当前状态

持续研究

# 学习目标

让 pnpm workspace + React / React Native / NestJS 的代码库具备清晰依赖边界、可重复执行的任务编排和受影响分析。

# 工具分层

pnpm workspace：依赖安装与 workspace 基础；Turborepo / Nx / Rush：提供不同侧重的编排与治理能力。工具选型应依据仓库规模与治理要求，而不是单纯排名。

# 严格依赖与布局

pnpm 的严格布局减少隐式依赖；Rush 提供更集中、规范化的仓库安装/政策管理。是否选择 Rush 需要评估迁移成本、团队复杂度和治理收益。

# 受影响分析

pnpm --filter、turbo --affected、nx affected 和 rush --to/--from/--impacted-by 可从不同视角查询依赖关系；参数和行为要结合当前官方版本复核。

# 任务编排与缓存

Turborepo 注重任务图和缓存；Nx 注重项目图、affected 分析及任务编排；Rush 可结合其增量构建与协同构建能力。详细特性及云端能力以所用版本文档为准。

# 发布与边界

Rush 的 change/version/publish 流程、Nx release 与 Changesets 等有不同的发布治理模型；模块边界需结合 lint、路径限制、CODEOWNERS 或架构检查。

# 已形成的倾向（非最终决定）

此前用户倾向 Rush，但明确是「有前提的选择」。持续关注依赖关系不明确的问题，优先输出依赖图、边界规则和易于解释的受影响链路。

# 下一步学习/实践

建议用同一个示例仓库实施包分类、构建拓扑、跨包引用检查、affected 任务和 release 模拟，并记录工具版本。

# 原始资料与可信度

会话：2026-10-04/06，《Monorepo 工具选型对比》《精通 TypeScript Monorepo》

本专题由可恢复历史对话线索组织而成；未读取的原始聊天/文件正文不作完整性声明。

# 后续维护记录

最后整理：2026-10-30 ｜待补充：原始链接、复习结果、新增案例、验证日期。
