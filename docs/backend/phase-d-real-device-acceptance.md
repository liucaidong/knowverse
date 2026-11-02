# Phase D · Mac / iPhone Safari 实体设备验收

> 自动化浏览器测试与实体设备验收分开记录。WebKit iPhone viewport 仅为模拟，不代表真实 iPhone Safari 通过。以下为 Phase D 正式数据库架构对应的验收步骤。

## 测试前提

- 使用已部署 HTTPS Pages 地址。
- Mac Safari 与真实 iPhone Safari 使用同一授权 Supabase 账户。
- 账户必须被加入 `private.authorized_users` 白名单。
- 不要清除日常浏览器站点数据；使用干净的测试 Profile。
- 记录部署 commit、OS/Safari 版本和非敏感测试账户别名。禁止记录 tokens、PKCE verifier、密钥。

## A. Phase C 迁移

1. 在仍有 Phase C 学习状态的测试 Profile 打开新部署。
2. 检查页面初始化是否成功进入学习驾驶舱、挑战和复习工作台。
3. 通过开发者工具检查迁移标记：`phase-c-localstorage-to-indexeddb-v1`。
4. 核对 event/document 数量和几个关键现场的 payload。
5. 检查旧 envelope 与 `promise-realm-save-v1` 已在验证成功后清理。
6. 检查 Supabase Auth / PKCE session 仍在，登录状态没有被迁移删除。

## B. Mac → iPhone 冷恢复

1. Mac 开始一个挑战，完成至少一次错误尝试、展开提示、停留在中间步骤。
2. 开始独立 Review Session，保持未提交，并调整计划偏好。
3. 等待同步完成，确认事件 Outbox 和 dirty 文档归零。
4. 在真实 iPhone Safari 新 Profile 登录同一账户。
5. 点击「从云端恢复」；确认统计有恢复事件、文档、冲突数。
6. 分别打开挑战、复习工作台和计划页面，确认现场和偏好正确。
7. 关闭页面后重开，再次确认现场能从 IndexedDB 恢复。

## C. iPhone → Mac 与离线

1. iPhone 完成一个挑战动作或复习提交，检查本地事件新增。
2. 开启飞行模式，继续一个动作并刷新页面，确认已提交本地事务仍存在，Outbox 保留。
3. 恢复网络，等待/点击同步；服务器确认前不应清除 Outbox。
4. Mac Pull 后确认新事件可见，没有重复事件。

## D. 并发 CAS 与人工冲突选择

1. 两端先同步同一挑战文档。
2. 两端离线分别编辑相同挑战现场。
3. 先同步一端，再同步另一端。
4. 检查第二端收到冲突；任一方内容没有被静默覆盖。
5. 分别验证「保留本机版本」与「采用云端版本」路径。

## E. 账户隔离

1. Profile A 登录账户 A 并生成学习数据。
2. 退出账户 A，再登录账户 B。
3. 预期 Repository 阻止 B 读取 A 已绑定的本地学习数据；不能自动上传或拉取覆盖。
4. 独立 Profile B 登录账户 B，应能恢复 B 自己的数据。
5. 使用两个真实 JWT 验证 RLS：A 不能读写 B 的 events、documents、devices、cursors；B 也不能读写 A 的数据。

## 结果记录

| 项目 | 结果 |
|---|---|
| 部署 commit / Pages run | 待实测 |
| Mac 型号 / macOS / Safari | 待实测 |
| iPhone 型号 / iOS / Safari | 待实测 |
| Phase C 迁移 | 待实测 |
| Mac → iPhone 冷恢复 | 待实测 |
| iPhone 刷新后挑战/复习恢复 | 待实测 |
| 离线写入与重新同步 | 待实测 |
| CAS 冲突与人工选择 | 待实测 |
| 双真实账户 RLS | 待实测 |
| 证据截图 / 非敏感日志 | 待填写 |
| 结论 | 未实测前不得标记为通过 |

当前工具环境可以执行 Chromium/WebKit browser automation 和 Supabase migration / schema / function permission 检查；本清单中的实体 iPhone 和真实双 JWT 场景不能被浏览器模拟代替。
