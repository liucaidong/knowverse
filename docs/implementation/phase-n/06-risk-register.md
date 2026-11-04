# Phase N — 风险登记册

**更新日期：** 2026-11-04
**总体状态：** IN_PROGRESS / NOT PRODUCTION READY

## P1 风险

| ID | 风险 | 当前状态 | 证据 / 阻塞 | 下一步 |
|---|---|---|---|---|
| AUD-P1-001 | PR #11 与生产迁移状态分叉 | FIX PREPARED / REVIEW PENDING | 生产 ledger 有第 12 条迁移；main 仍是 a50eaca；PR OPEN；迁移重放缺陷已在 PR 分支修订并通过本地 PG17 两场景测试 | 维护者审查修订、确认历史 SQL 差异及授权意图，再明确批准合并 |
| AUD-P1-002 | AI 内容发布真实闭环没有生产证据 | NOT STARTED | manifest 0、候选质量记录 0；仓库级 Actions secrets/variables 空；组织级 secrets 未核实 | N3 完成后，在隔离 staging 配置最小权限凭证，执行一条候选闭环 |
| AUD-P1-003 | Supabase 跨设备学习同步未真实验收 | NOT STARTED | 生产 learning_events 0；审计基线指出现有 E2E 使用 mock/isolated RPC | N1 完成后准备独立 staging、双测试账号/设备，完成同步、CAS、离线重试和跨账号拒绝矩阵 |
| AUD-P1-004 | Tutor / Agent / Reviewer 真实模型调用未验证 | NOT STARTED | Edge Functions ACTIVE 不等于 Provider 可用；Provider secrets 状态不可读取 | 需 staging Provider 凭证、独立 Reviewer 凭证和异常注入测试 |
| AUD-P1-005 | 九个专题缺正式学习图谱 | NOT STARTED | AI Agent 与 AI 教育专题有公开页面，但当前无 Concept/Competency/Gap/Checkpoint/Review/source 正式映射 | N4 完成后，审校内容与官方来源，选择两个主题构建可验证图谱 |

## P2 / 运维风险

| ID | 风险 | 当前状态 | 说明 |
|---|---|---|---|
| AUD-P2-006 | 72 道 Review Assessment 缺 difficulty | OPEN | 需要定义难度量表并逐题人工校准，不能仅按标题推断 |
| AUD-P2-007 | 九个专题没有正式 source Registry | OPEN | 补官方资料、版本、访问日期和具体引用锚点 |
| AUD-P2-008 | README 路由数量 / 管理员状态滞后 | OPEN | 等 N1 PR 状态确定后再更新事实描述 |
| AUD-P2-009 | Supabase leaked-password protection 告警 | OPEN | 需单独评估 Auth 设置；不能在无授权情况下改生产设置 |
| AUD-P2-010 | 全量技术事实与教学表达语义审校未完成 | OPEN | 74 页面、72 题和工程文档仍需逐项事实核对 |
| AUD-P2-011 | 备份与恢复演练无证据 | OPEN | 需定义 RPO/RTO 并在隔离项目执行恢复测试 |
| AUD-P2-012 | 实体 iPhone Safari 验收未完成 | OPEN | WebKit 模拟不能代替真机系统权限、键盘、后台和弱网验收 |

## 控制原则

1. N2-N5 不能越过 N1；任何 staging 条件缺失都必须记为 BLOCKED，不得用生产数据替代。
2. 不把 Edge Function ACTIVE、路由 HTTP 200、Mock E2E 或模型配置存在视为真实业务闭环。
3. 不让 AI 输出直接生成掌握度证据或正式发布状态。
4. 对生产迁移和权限操作必须保留明确的人工批准、执行记录与回滚方案。
5. 任何无法核验的事项标记为 UNVERIFIED / BLOCKED，不用推测填补。
