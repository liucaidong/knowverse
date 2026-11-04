# Phase N — 风险登记册

**更新日期：** 2026-11-04
**总体状态：** IN_PROGRESS / NOT PRODUCTION READY

## P1 风险

| ID | 风险 | 当前状态 | 证据 / 阻塞 | 下一步 |
|---|---|---|---|---|
| AUD-P1-001 | Git 主线与生产 migration 状态分叉 | RESOLVED（version/name） / CONTENT PROVENANCE DISCLOSED | PR #11 正常合并；main = b3c7037；12 条生产 ledger version/name 与仓库文件清单一致。第 12 条 SQL 文件在生产应用后曾修订；ledger 无 checksum，字节级历史内容一致性不可证明 | 不重跑生产 migration；未来如需数据库变更，使用新的前向 migration，经单独审查 |
| AUD-P1-002 | AI 内容发布真实闭环没有生产证据 | NOT STARTED | manifest 0、候选质量记录 0；Edge Function ACTIVE 不等于真实 provider / publication 成功 | N3 完成后，在独立 staging 配置最小权限凭证，执行一条候选闭环 |
| AUD-P1-003 | Supabase 跨设备学习同步未完成认证态托管验收 | LOCAL SQL / MOCK E2E PASS; STAGING SCHEMA + ANON DENIAL PASS; AUTHENTICATED E2E BLOCKED | 34/34 本地 contract / IndexedDB tests PASS；1/1 Mac + WebKit iPhone-profile E2E PASS（RPC 是内存 Mock）；临时 PG17 执行全部 12 migrations 并真实调用 sync RPC，验证 atomic commit、idempotency、CAS 整批回滚、pagination、RLS 跨账号隔离和 device ownership。托管 staging `ypthoicwrfsblaidllyy` 已应用 12/12 migrations；真实 anon 表 / profile RPC 请求均 HTTP 401 / 42501 | 两个合成 Auth 用户和 allowlist 已建立；用户在 Mac 本机使用 `scripts/setup-n2-staging-env.sh` 安全录入临时密码后运行真实 Auth / JWT / HTTP 验收脚本；完成浏览器认证态冷恢复、同步、离线补传、CAS 和跨账号拒绝验收 |
| AUD-P1-004 | Tutor / Agent / Reviewer 真实模型调用未验证 | NOT STARTED | Edge Functions ACTIVE 不等于 Provider 可用；Provider secrets 状态不可读取；N3 依赖 N2 staging | N2 完成后配置 staging Provider credentials，并做成功/限流/超时/无凭证/恶意输出异常注入 |
| AUD-P1-005 | 九个专题缺正式学习图谱 | NOT STARTED | AI Agent 与 AI 教育专题有公开页面，但当前无 Concept/Competency/Gap/Checkpoint/Review/source 正式映射 | N4 完成后，审校内容与官方来源，选择两个主题构建可验证图谱 |

## P2 / 运维风险

| ID | 风险 | 当前状态 | 说明 |
|---|---|---|---|
| AUD-P2-006 | 72 道 Review Assessment 缺 difficulty | OPEN | 定义难度量表并逐题人工校准，不能仅按标题推断 |
| AUD-P2-007 | 九个专题没有正式 source Registry | OPEN | 补官方资料、版本、访问日期和具体引用锚点 |
| AUD-P2-008 | README 路由数量 / 管理员状态滞后 | OPEN | N1 合并已完成；检查并更新 README 的路由与管理员事实时点 |
| AUD-P2-009 | Supabase leaked-password protection 告警 | OPEN | 需单独评估 Auth 设置；不能在无授权情况下改生产设置 |
| AUD-P2-010 | 全量技术事实与教学表达语义审校未完成 | OPEN | 74 页面、72 题和工程文档仍需逐项事实核对 |
| AUD-P2-011 | 备份与恢复演练无证据 | OPEN | 定义 RPO/RTO 并在隔离项目执行恢复测试 |
| AUD-P2-012 | 实体 iPhone Safari 验收未完成 | OPEN | WebKit 模拟不代替真机系统权限、键盘、后台和弱网验收 |

## 控制原则

1. N2-N5 严格串行；任何 staging 条件缺失都必须记为 BLOCKED，不得用生产数据替代。
2. 不把 Edge Function ACTIVE、路由 HTTP 200、Mock E2E 或 PG17 兼容集成测试视为托管 Supabase 全链路验收。
3. 不让 AI 输出直接生成掌握度证据或正式发布状态。
4. 对生产迁移和权限操作保留明确的人工批准、执行记录与回滚方案；已执行迁移不得为追求文件一致而重放。
5. 无法核验的事项标记为 UNVERIFIED / BLOCKED，不用推测填补。


## 2026-11-04 N2 staging 更新

- `AUD-P1-003`：状态更新为 `HOSTED STAGING CREATED / 12 MIGRATIONS PASS / AUTH TEST USERS BLOCKED`。已创建 `ypthoicwrfsblaidllyy`，12 条迁移全部应用；anon 表访问和 profile RPC 均真实 HTTP 401 拒绝。当前无法使用可用管理连接创建合成 Auth 用户，尚未取得真实 JWT，双设备 HTTP 同步继续 BLOCKED。下一步通过 Supabase Dashboard Auth 用户管理或受支持的 Auth Admin API 建立两个测试用户，不使用生产账号，不修改邮件确认安全设置。
- 新风险 `AUD-P2-013`：Staging Auth Admin 创建用户能力缺失。当前只提供 publishable key；直接 SQL 写 auth.users 的请求被安全层拦截。处理原则：不读取/暴露 service_role key，不伪造 JWT，不用绕过安全检查的方式写 Auth 内部表。需连接受支持的 Auth Admin 管理流程。
