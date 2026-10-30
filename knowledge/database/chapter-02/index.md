# 从一条 SQL 追踪数据库内核

> 来源：按可检索历史会话线索整理，部分表达为知识性归纳，非逐字原话。

研究链条：Connection → Parser/AST → Catalog → Logical Plan → Optimizer → Physical Plan → Executor → Index/Page/Buffer Pool → MVCC/WAL → Commit。

存储内核重点包括页与 Buffer Pool、B-Tree/LSM、写前日志 WAL、事务隔离与 MVCC；分布式方向研究复制、分片、Raft/Paxos 与分布式 SQL；分析方向覆盖列存、向量索引与 Lakehouse。

建议以 SQLite / PostgreSQL 等公开实现观察概念落地，但不要把两个项目的具体架构混为同一个通用执行路径。
