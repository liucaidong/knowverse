# 历史会话笔记 · 主题总览

> 来源：2026-10-30 已恢复的个人知识库 v1 DOCX 内容摘录；这是一份既有摘要，不是原始对话逐字稿。

React Native 新架构：构建、启动与运行

专题 03 / React Native 与移动端

# 主题定位

Build Time、App Startup、Runtime 三个阶段；JSI、TurboModules、Fabric 与调用/渲染/事件/资源四类数据流。

# 关键词

React Native · JSI · Fabric · TurboModules · Hermes · CodeGen · Yoga · Shadow Tree · Bridge · HostObject

# 当前状态

重点研究

# 目标与时间分层

把 React Native 新架构拆成 Build Time（构建）、App Startup（启动）和 Runtime（运行）三个阶段，不混淆代码生成、运行时绑定和渲染执行。

# 构建阶段

Hermes 的字节码/AOT 路线与 CodeGen 的类型驱动代码生成：关注哪些产物在编译期生成、哪些约束在 JS ↔ Native 两端落实。

# 启动阶段

JSI 运行时关联、TurboModule 注册/按需获取、Fabric 基础设施初始化；关注初始化顺序与线程上下文。

# 调用流 A

JavaScript 通过 JSI/TurboModule 进入 C++/Native 实现，同步和异步路径需单独分析；不能把「无需旧 JSON Bridge」误称为所有调用都是零成本或总是零拷贝。

# 渲染流 B

React 更新进入 Fabric Render → Commit → Mount 管线；Shadow Tree、Yoga 布局与 Native UI 更新分层理解，并注意具体线程调度与平台差异。

# 事件流 C

原生输入/事件经事件系统进入 JS 处理，再可能引起新一轮状态更新与渲染。

# 资源流 D

同时标注生命周期、线程协作、内存、异常边界和资源释放，避免只有「调用与渲染」的简化图。

# 比较与纠偏

旧 Bridge 与新 JSI 的差异不只是 JSON 换 C++：涉及模块接口、渲染系统、任务调度、同步能力与边界。需要持续对照 reactnative.dev 官方说明。

# 图示要求

可编辑思维导图提供三阶段主干；后续时序图应分别标出 JS、C++ 和 UI 线程并用四种颜色区分数据流。

# 原始资料与可信度

会话：2026-08 起，React Native 新架构全景图/源码解读

Library：十六宫格 AI 技术知识地图.png

Library：AI编程Agent全景实践图.png

本专题由可恢复历史对话线索组织而成；未读取的原始聊天/文件正文不作完整性声明。

# 后续维护记录

最后整理：2026-10-30 ｜待补充：原始链接、复习结果、新增案例、验证日期。
