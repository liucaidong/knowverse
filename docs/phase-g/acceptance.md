# Phase G：验收与运行手册

## 1. 自动验收

node --test scripts/verify-phase-g.mjs 覆盖冷启动、行为/掌握证据隔离、独立无提示通过、提示依赖、延迟回忆门槛、时间衰减、矛盾样本、冷却和幅度限制、效果分层、幂等审计、CAS 重试及复习事件决策关联。

现有 Phase E/F、Planner、Agent、Repository 测试继续保留。新增浏览器 E2E 在 Chromium 桌面验证模式切换和刷新恢复，在 WebKit 移动视口验证策略面板布局。

## 2. 本地验证

~~~sh
node --check assets/js/learning-strategy-engine.mjs
node --test scripts/verify-phase-g.mjs
node --test scripts/verify-phase-f.mjs
node --test scripts/verify-phase-e.mjs
node --test scripts/verify-learning-planner.mjs
node --test scripts/e2e-learning-planner.mjs
~~~

完整 Validate 工作流仍是最终合并门槛。

## 3. 生产核验

Phase G 不新增数据库迁移。发布后检查 Supabase migration history 未变化；learning_archive_documents 的 learner_profile 类型仍受原检查约束允许；所有公开表仍启用 RLS；生产 Projection schema 为 3，算法版本包括 Learning Strategy 1 和 Spaced Repetition 2。

## 4. 自动化测试不能替代的验证

Playwright WebKit 移动视口不等于实体 iPhone Safari。Repository 模拟 CAS 不等于两台真实设备同时连接生产服务。模型连接 Secret 是否存在也必须独立验证。

## 5. 回退

用户可在驾驶舱切换默认策略。该模式退回通用复习、难度和干预参数，但保留学习事实、策略历史和审计事件。代码回退应恢复到前一受验证提交，不直接删除档案或审计。
