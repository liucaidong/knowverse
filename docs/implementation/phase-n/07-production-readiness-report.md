# KNOWVERSE — Phase N 生产就绪报告

**报告日期：** 2026-11-04
**总体结论：** NOT PRODUCTION READY
**Phase N 状态：** IN_PROGRESS
**当前主线：** `main` @ `b3c70374f147a651227675777934eac4adffea21`

## 1. 结论

N1 已完成 Git 合并与分支清理；main 合并后的 Validate workflow 成功。N2 的本地和隔离 PostgreSQL 集成验证已有实测证据，但独立托管 Supabase staging 尚未建立，真实浏览器到 Supabase Auth / PostgREST / RPC 的双设备验收尚未执行。

因此目前不能声明 KNOWVERSE 已具备经过验证的生产级跨设备个人学习数据闭环。

## 2. N1 已验证

- PR #11 normal merge 到 main，merge commit `b3c70374f147a651227675777934eac4adffea21`。
- PR #10 / #11 均已合并，旧阶段分支已删除，当前仅保留 main，无 OPEN PR。
- main full Validate workflow run `41746832395` SUCCESS。
- Pages deploy run `41746832366` SUCCESS。
- 生产 migration ledger 12 条，版本名与 main migration 文件清单对应。
- 已披露第 12 条 migration 的 SQL 文件在生产应用后被修订；ledger 没有 SQL checksum，本报告不作字节级 provenance 一致性声明。
- 本阶段没有重跑生产 migration，也没有修改生产授权或数据库内容。

## 3. N2 验证证据

### 3.1 本地与浏览器

- Backend contract、local IndexedDB、state migration、async E2E wait：34/34 tests PASS。
- Mac + WebKit iPhone profile E2E：1/1 PASS，覆盖首次上传、冷启动 pull restore、事件与档案同步、离线 Outbox、重连补传、幂等重试、文档 CAS 冲突和人工选择解决。
- 该跨设备浏览器测试使用进程内 Mock RPC。它证明本地状态层与浏览器流程，但不能证明真实 Supabase API 可用。

### 3.2 PostgreSQL 17 真实迁移 / RPC 集成

新增 `scripts/verify-supabase-sync-isolation.sh` 并接入 Validate workflow。脚本在临时 PostgreSQL 17 容器执行全部 12 条真实 migration，以合成 Auth 身份和 authenticated 角色调用迁移产生的数据库 RPC，验证：

- 同一用户两设备注册和 device ownership。
- 事件 + 文档原子批次提交。
- 重复事件 ID / payload 幂等确认。
- stale document revision 触发 CAS 冲突；冲突批次内先执行的文档写入与关联事件均回滚。
- 新 revision 解决冲突后成功提交。
- 事件分页游标与 has_more。
- 账号 B 无法通过 RLS 读取账号 A 事件 / 文档。
- 账号 B 无法伪造 expected_user_id 或使用账号 A 的 device ID 同步。

结果：`SUCCESS: PostgreSQL 17 Supabase sync isolation checks passed.`

边界：测试用最小 Auth schema shim，不是托管 Supabase 的完整 clone，不包括真实 JWT 签发、PostgREST 网络层、Supabase hosted Auth 和物理设备。

### 3.3 生产只读权限

- 生产主要学习表均启用 RLS。
- anon 对学习事件、档案和设备表没有表级访问权限。
- authenticated 具备必要的表权限，RLS owner predicates 绑定 `auth.uid()` 并检查 allowlist。
- 审核审计表 authenticated 只读；service_role SELECT / INSERT；直接 UPDATE / DELETE 被撤销，写入通过受控 RPC。
- 本阶段仅执行只读 metadata / grants / policies 查询，没有生产 DML 或 DDL。

## 4. 仍未验证

- 独立托管 Supabase staging 项目及其完整 migration 部署。
- 真实 Auth 测试用户 A / B 的创建、session、JWT 与账号切换拒绝。
- Mac + 第二台真实设备使用同一账号进行同步和冷启动恢复。
- 另一账号真实访问拒绝。
- 真实网络离线 / 弱网、浏览器后台恢复、重复请求和服务端超时后重试。
- 物理 iPhone Safari 的键盘、权限、后台生命周期和网络恢复。
- 真实 Provider 调用、独立 Reviewer 与 AI 内容发布闭环（N3/N4）。
- 备份恢复演练和全量教学内容语义事实审核。

## 5. 当前阻塞

Supabase 账户当前只发现一个项目 `knowverse`，即生产项目 `sxcpareycpokcyroufww`，其下没有 development branch。组织为 `liucaidong's Org`（free plan）。本阶段未创建第二个 Supabase 项目或分支，因为 staging 创建属于独立云资源操作，可能涉及费用，需要维护者明确授权。

在独立 staging 条件准备好之前：
- 不得使用生产数据库插入测试事件或档案。
- 不得在生产环境创建测试 Auth 用户或设备。
- 不得将 Mock / PG17 测试写成托管 Supabase 通过。
- 不推进 N3 的真实 Provider 测试。

## 6. 生产准入条件

1. N1 主线合并和 migration 版本清单一致性已完成；历史 SQL provenance 差异已披露。
2. N2 在独立托管 staging 完成 Auth / PostgREST / RPC / RLS 真实双设备测试，并完成账号隔离、离线重试和 CAS 冲突矩阵。
3. N3 完成 Tutor、Agent、独立 Reviewer 真实 Provider 调用与失败关闭验证。
4. N4 完成至少一条真实候选的 deterministic → AI → 人工 → PR → Pages → registry 闭环。
5. N5 完成两个专题的正式学习图谱和来源审核。
6. 单元、集成、浏览器 E2E、数据库重建和 staging 验收全部通过；未通过测试不得删除或降级。
7. 风险登记册中没有未披露 P0/P1；未完成 P2 风险具备负责人、计划和接受记录。

**当前不得宣布 Phase N COMPLETE，也不得宣称 KNOWVERSE 已具备生产级个人学习数据闭环或可靠的 AI 主动规划能力。**


## 7. 2026-11-04 staging 建立后的更新

已按用户授权建立独立托管 staging 项目：
- `knowverse-staging` / `ypthoicwrfsblaidllyy` / `eu-west-1`。
- 当前创建报价 `US$0/month`。
- 12/12 migrations 实际应用成功，migration ledger 名称顺序完整。
- Auth、allowlist、reviewer、设备、学习事件、学习文档、质量审计记录当前均 0 行，没有复制生产数据。
- 对外公开 API 匿名读取学习表和调用同步 profile RPC 均实际返回 HTTP 401 / 42501；authenticated RPC grant 与 RLS metadata 已核对。

**仍不能据此宣布 N2 完成。** staging 当前没有可用合成 Auth users / JWT。项目 email provider 要求确认邮件，但当前管理连接没有 Auth Admin 创建用户接口；直接 SQL 写 `auth.users` 被安全策略阻止，未落库。下一步需通过 Supabase Dashboard Auth Users 受支持流程建立合成账号，随后才可以运行真实双设备 HTTP E2E。生产项目完全未触碰。
