# Phase N — 风险登记册

**更新日期：** 2026-11-04
**总体状态：** IN_PROGRESS / NOT PRODUCTION READY

## P1 风险

| ID | 风险 | 当前状态 | 证据 / 阻塞 | 下一步 |
|---|---|---|---|---|
| AUD-P1-001 | Git 主线与生产 migration 状态分叉 | RESOLVED（version/name） / CONTENT PROVENANCE DISCLOSED | PR #11 正常合并；main = b3c7037；12 条生产 ledger version/name 与仓库文件清单一致。第 12 条 SQL 文件在生产应用后曾修订；ledger 无 checksum，字节级历史内容一致性不可证明 | 不重跑生产 migration；未来如需数据库变更，使用新的前向 migration，经单独审查 |
| AUD-P1-002 | AI 内容发布真实闭环没有生产证据 | NOT STARTED | manifest 0、候选质量记录 0；Edge Function ACTIVE 不等于真实 provider / publication 成功 | N3 完成后，在独立 staging 配置最小权限凭证，执行一条候选闭环 |
| AUD-P1-003 | Supabase 跨设备学习同步尚未完成真实客户端设备闭环 | LOCAL SQL / MOCK E2E PASS; HOSTED AUTH / JWT / POSTGREST / RPC PASS; REAL BROWSER DEVICE E2E PENDING | 35/35 本地 contract / IndexedDB / async-wait / WebKit 测试 PASS；PG17 全量 12 migrations + RPC / RLS PASS；托管 staging 真实 Auth 登录、A 双设备 / B 单设备、atomic event + document commit、pull、幂等、CAS rollback / recovery、跨账号 RLS 与身份 / 设备伪造拒绝全部 PASS；staging 计数 2 users / 3 devices / 2 events / 1 document；CI Run #149 SUCCESS | 使用真实 KNOWVERSE 浏览器客户端在 Mac + 第二真实设备完成 IndexedDB cold restore、离线 Outbox / 重连补传、session refresh、弱网与重试；再单独完成实体 iPhone Safari 核心路径。N2 未完成前不推进 N3 |
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

- AUD-P1-003：2026-11-04 托管 staging 认证态 HTTP harness 已输出 RESULT: PASS；真实 Auth / JWT、设备注册、原子提交、pull、幂等、CAS rollback / recovery、跨账号 RLS / identity spoof / device spoof 均通过。风险范围缩小为真实 KNOWVERSE 浏览器客户端的双设备 IndexedDB 冷恢复、离线补传、session refresh、弱网及实体 iPhone Safari 尚未验证。
- AUD-P2-013：RESOLVED。两个合成 Auth 用户已通过 Dashboard 建立；用户在本机使用 staging Secret Key 通过 Auth Admin API 设置临时密码，两个真实登录均验证通过。Secret Key 未提交仓库或发送到聊天；没有直接 DML 写 auth.users。


## 2026-11-04 N2 托管认证态验收更新

- AUD-P1-003 保持 OPEN：托管 HTTP / Auth / JWT / RPC / RLS 已 PASS，但真实浏览器客户端双设备 IndexedDB 恢复与实体 iPhone Safari 尚未验证。
- staging 当前合成数据只读计数：2 Auth users、3 device rows、2 learning events、1 archive document；待客户端验收完成后统一清理。
- GitHub Actions Validate run #149：SUCCESS；PR #12 仍 OPEN、未合并。
- Phase N 总体仍 NOT PRODUCTION READY。
