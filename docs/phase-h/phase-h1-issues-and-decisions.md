# Phase H1 问题、修复与架构决策

## 问题记录

### H1-01 Promise 正文课程与任务生命周期断链（P2，已修复）
20 节 lesson 原本未加载 assets/js/learning-integration.mjs；Planner 可生成 reading task，但正文页无法启动/暂停/恢复/完成。修复：20 个 lesson 统一加载共享 integration；五个现有 competency lesson 路由带 taskId 时挂载任务卡；校验 taskType、resourceType、topicId、competencyId、pathname。新增单元测试和 Chromium/WebKit E2E。阅读完成只产生 task execution，不产生掌握证据；完成后调用既有 Task Orchestrator.refreshUnlocks，验证依赖阅读的挑战任务从 locked 解锁为 ready。

### H1-02 生产云端没有学习事实（待真实试点）
learning_events=0，策略 cold-start、evidence 0、history 0、projection sourceEventCount 0。它是当前数据事实，不通过脚本补造数据。真实学习者按 D1-D7 采集。

### H1-03 设备本地数据未在 D0 读取（待真实设备检查）
Browser connector 未提供起始浏览器上下文；未读取/清空本机现有 Chrome profile / IndexedDB。避免从云端 0 事件推断本机 0 事件。Runbook 要求真实设备先核对本地历史并保留离线记录。

### H1-04 Supabase leaked password protection（配置提醒）
Advisor WARN；不属于应用 SQL schema。H1 未修改 Auth 配置，需项目 owner 决定是否在 Auth password security 中启用。

### H1-05 复习工作台的数据保存说明过期（P5，已修复）
旧页面写“仅本机”并建议用 JSON 手工迁移，这与现有 LearningRepository / Supabase 授权同步不符。已更正为“本地优先，授权账户联网后云同步，离线保留本机并等待同步”，并新增静态回归防止重新出现“仅本机”。不改变数据同步逻辑。

### H1-06 private.authorized_users Advisor INFO（保持关闭）
该 private 表已启用 RLS，anon/authenticated 无表权限。没有 policy 不意味着要开放；不新增宽松 policy。

## 架构决策

1. 复用 Reader + Learning Integration + Task Orchestrator，不新建阅读服务。
2. 阅读浏览标注为 exploration，阅读任务只反映 execution，不进入 mastery evidence。
3. Promise 试点复用五个 existing competency；不新增重复知识节点。
4. 不新增数据库表或 migration：archive_documents 已支持 goal/plan/task/review/profile/projection；Events V3 已支持因果关系。
5. 保留 Phase G cold-start、72h cooldown、样本阈值和回退，不因 adaptive 模式被选择就激活无证据参数。
6. 不重置、清理或覆盖用户真实 IndexedDB / Supabase 数据。

H1 不开发 H2 完整评估中心、H3 策略算法升级或 H4 自主 Agent。
