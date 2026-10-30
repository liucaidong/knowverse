# 四类核心流与旧架构对照

> 来源：按可检索历史会话线索整理，部分表达为知识性归纳，非逐字原话。

主要追踪四种流：A 调用流（JS → JSI/TurboModule → Native → 结果）；B 渲染流（state → Render → Commit → Mount → pixels）；C 事件流（Native event → C++/JSI → JS handler）；D 资源与生命周期（对象引用、线程、错误、GC）。

**Fabric** 的 Render/Commit/Mount 是理解渲染变化的主线；Yoga 负责布局计算，与实际 Mount 到平台视图是不同阶段。**TurboModules** 通过 CodeGen 规格与 JSI 调用路径改善调用机制；JSI 并不意味着每种数据都“零拷贝”，具体行为取决于 HostObject/HostFunction 与接口设计。

旧 Bridge 常被概括为跨桥批量异步消息；新架构的 C++/JSI 路径减少了特定桥接开销，但“所有调用同步”“不存在任何序列化”都是过度概括。
