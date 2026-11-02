# Phase D Sync Engine 与冲突协议

## 生命周期

### Push

1. 取得同步 lease。
2. 读取本地 Outbox（最多 100 条）和 dirty 文档（最多 50 条）。
3. 调用 `sync_commit_learning_batch`，事件和文档在同一 PostgreSQL 事务中提交。
4. 只有返回 `status=committed` 才确认事件与文档。
5. RPC 成功但响应丢失时，重试由事件 ID 与文档 payload hash/CAS 保证幂等。
6. 网络失败不删除 Outbox、不清理 dirty 文档；退避重试。

### Pull

1. 读取当前认证会话和服务端 profile。
2. 校验会话账户与本地账户绑定。
3. 调用 expected-user Pull RPC，分页读取事件与文档。
4. 事件先 merge 到本地事件日志，远端事件不重新进入 Outbox。
5. 文档逐份比较 cloudRevision/baseRevision；冲突先落入本地 conflicts。
6. 本地 merge 成功后再推进事件/文档独立 cursor。

### Restore

`restoreFromCloud()` 是 pull-only 操作：验证账户、注册设备、从云端读取事件与文档。它不执行 Push，不会把本机未同步状态上传，也不会静默覆盖 dirty 本地文档。恢复统计包含事件数、文档数、冲突数和游标。

## 幂等与冲突分类

| 情况 | 处理 |
|---|---|
| 事件 ID 重复且 payload 相同 | 幂等确认，不新增事件 |
| 事件 ID 相同但 payload 不同 | 拒绝，视为数据完整性错误 |
| 网络响应丢失、客户端重试 | 同一稳定 ID 和相同文档 base revision 重试 |
| 文档 base revision 过期 | 云端返回 conflict，批次整体回滚 |
| dirty 本地文档收到更新云端版本 | 写 conflict，保留 local/remote |
| dirty 文档 payload 与云端相同 | 以云端 revision 确认本地，无需再次人工冲突 |
| 删除与更新并发 | tombstone 也是有 revision 的文档写入；按 CAS 产生冲突 |
| 同一标签页多次触发 sync/restore | 串行队列 |
| 多标签页同时同步 | IDB sync lease |
| 同步过程中用户继续学习 | 新事件写入独立事务和 Outbox；后续批次上传 |
| 登录账户在调用间切换 | Repository guard + expected-user RPC 拒绝跨账户操作 |

事件历史不执行 last-write-wins。文档冲突提供明确人工选项：保留本机版本或采用云端版本；选择后设置新的 cloud/base revision，再等待下一次 Push。

## 账号与设备生命周期

本地 IndexedDB 绑定单一账户。首次登录时，如果本机数据未绑定，可在 IDB 事务中绑定现有记录；已有数据绑定其他账户时禁止读取/写入。不要在共用浏览器 Profile 中切换多个用户使用同一本地学习数据库，应使用不同 Profile。

退出登录不会删除本地学习数据；重新登录同一账户可以继续离线数据。登录其他账户时账户不匹配会被阻止，不能自动清空或上传旧账户内容。数据迁移/清理应在原账户下导出备份后显式进行。

## 可观测状态

Sync Engine 发布 `knowverse:sync-state` 事件，Outbox 状态和最后成功同步/错误时间在 IndexedDB 保存。网络恢复与页面重新可见会触发重试。lease 有到期时间，以便页面崩溃后其他标签页重新取得同步权。

## 已知边界

- 真实双账户 JWT 的 RLS 权限测试需要两个可用授权账户；不能用单个账户或 service role 伪装。
- 浏览器关闭可能中断正在进行的 HTTP 请求，但不会回滚已经提交的 IDB 事务；Outbox 重试保障后续收敛。
- WebKit viewport/E2E 只模拟 iPhone Safari 行为，不等于实体设备验收。
