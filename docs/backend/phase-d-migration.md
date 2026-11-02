# Phase C → Phase D 数据迁移手册

## 迁移目标

把 Phase C 的 `localStorage["knowverse:learning-state"]` envelope 和原来单独保存的 Promise Realm 游戏现场，转换为 IndexedDB v4 canonical stores。迁移不涉及 Supabase Auth、PKCE verifier、OAuth callback、站点偏好或其他不在 allowlist 内的键。

## 迁移实现

入口：`assets/js/backend/phase-c-migration.mjs`
数据库导入：`importPhaseCLearningState()`
完成标记：`phase-c-localstorage-to-indexeddb-v1`

流程：

1. 读取旧 envelope，验证 format、schemaVersion、revision、records 类型和每个键的 allowlist。
2. 对旧 envelope 做 SHA-256 指纹；损坏/未知结构直接报错，旧数据保留。
3. 将事件、挑战现场、复习会话、规划偏好转换为 event rows 和 document rows。
4. Promise Realm 的 `promise-realm-save-v1` 会先验证 done/solutions/stage，再并入 challenge document；原 standalone key 在导入成功前保留。
5. 事件、文档和迁移标记在一个 IDB 事务里提交。
6. 从 IDB 按 event ID、document type/key 回读核对，并核对标记中的 source fingerprint、事件数和文档数。
7. 只有全部通过才删除 envelope、内部逻辑记录键和 Promise Realm 旧 key。
8. 再次启动时比较已迁移源指纹并回读核验，重复运行不会重复插入事件。

迁移标记一旦完成而源 envelope 又发生变化，不会覆盖当前数据库；迁移器停止并保留数据供人工调查。

## 受保护的数据范围

allowlist 包含：
- `knowverse:learning-progress`
- `knowverse:learning-plan:preferences`
- `knowverse:challenge/*`
- `knowverse:review-session/*`
- `promise-realm-save-v1`
- 根键 `knowverse:learning-state`

Auth / PKCE 键不在白名单，清理函数不按前缀模糊删除。未知的散落键在缺少 envelope 时会导致迁移停止。

## IndexedDB schema 升级

当前 canonical DB version 是 **4**。升级器按实际存在的旧 object stores 检查，而不是仅依据版本号推断数据是否已迁移。旧 \`documents\` 和 \`meta\` store 通过 versionchange transaction 的游标复制到 \`learningDocuments\`、\`syncMetadata\` 与 \`devices\`；目标记录已存在时以目标为准。所有旧 store 的复制游标都完成后，才删除旧 store。旧 Outbox 保留，并将其中事件回填到 canonical \`learningEvents\`，防止升级后事件只在待同步队列中、服务端确认后本机却丢失历史。v1、v2、v3 均走相同的安全前向迁移。

如果升级 transaction abort，浏览器保留旧 schema；应用不应该要求用户手工清除站点数据来绕过失败。关闭旧版本标签页后再刷新可解除 blocked upgrade。

## 失败处理

| 失败 | 行为 |
|---|---|
| LocalStorage 不可用 | 明确报错，不声称迁移成功 |
| envelope JSON 损坏 | 停止，原始值保留 |
| schema/未知键无效 | 停止，不删除旧记录 |
| Promise Realm standalone save 无效 | 停止，不清理旧 key |
| IndexedDB 配额不足/事务 abort | 本地导入回滚，旧 envelope 保留 |
| 回读数量或 payload 不匹配 | 停止，旧源数据保留 |
| 已完成标记与源指纹不符 | 停止，不重复导入 |

## 生产注意事项

迁移在用户首次加载统一学习 Repository 时运行。发布前应保留旧版本回滚窗口；发布后首次启动若显示迁移错误，不要指导用户清除站点数据。先收集非敏感错误信息、确认 IndexedDB schema、导出原始 envelope（注意其含个人学习数据）后再处理。
