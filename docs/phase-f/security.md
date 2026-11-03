# Phase F — 安全与隐私

- Learning Events 是学习行为事实；Learning Intelligence 是 mastery/gap 权威；新算法只能产生可重建派生状态。
- 新 projection 必须经 LearningRepository；不允许直接访问 IndexedDB/Supabase。
- Supabase migration 只扩展现有 archive document type 与原 sync_push RPC allowlist；保留 auth.uid、授权用户、active device、RLS、payload size、idempotency、CAS 和 revision 行为。
- 投影需校验 schemaVersion、algorithmVersions、sourceFingerprint；损坏或旧版本缓存直接重建。篡改投影不能改变事件和 task evidence gate。
- 算法只处理有效事件、注册表 competencyId 和有效数值；模型不提供 dueAt/risk/taskId/href。所有工具参数仍需业务服务二次验证。
- Agent 默认本地模式；云端模式沿用逐轮 consent、JWT、Edge Function 和最小上下文，不发送完整日志或敏感身份凭据。
- 不新增第三方 DB/queue/Cron。浏览器离线写本地 Outbox；Supabase 计划和用量仍取决于项目订阅。关闭浏览器不执行后台代码。
