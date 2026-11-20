# 09 · 整改路线图（2026-11-20）

## P0
无。

## P1（已修复）

| ID | 问题 | 状态 | 说明 |
|---|---|---|---|
| KV41-010 | 被复用学习档案中无提示独立复习通过后 review task 仍 in_progress | FIXED | validateEvidence 改用 taskId 口径，只要求当前任务仍 open 的观察；不放宽因果链。确定性回归 RED→GREEN + staging 插桩验证。完整 staging E2E 仅被污染账户的 planner 输出假设阻断，非产品缺陷。 |

## P1 遗留验收（已完成）

- 用户授权后清理了两个合成 staging 账户的污染业务数据（保留 Auth 用户，备份在 `.workbuddy/staging-cleanup-backup-2026-11-20/`），在干净档案上完整云端 E2E PASS 1/1。端到端验收完成。
- 注意：该 E2E 的空档案 planner 断言（期望推荐 AI 专题）使其适合单次干净运行；连续运行会因上一次进度使 planner 正确改推其他专题而失败。重复验收前需再次清理账户业务数据。

## P2（本轮已处理 / 观察）

| ID | 问题 | 状态 |
|---|---|---|
| KV-BUILD-001 | 打包脚本把 `.DS_Store` 打进 ZIP，构建不可复现 | FIXED（本轮）：加噪声过滤，验证 48 文件/无 `.DS_Store`/与 HEAD 二进制一致 |
| KV41-004/007 | Production AI Provider secrets、Auth leak-password protection | BLOCKED：需用户授权配置，不读/不改 secret |

## P3（观察，未改）

| 问题 | 建议 |
|---|---|
| 搜索正文含导航文案 | 站点外壳加 `data-search-skip` 或专用正文容器，重生成索引；产品决策 |
| 提交态搜索索引漂移 | CI 顺序已正确；可在 --check 失败时给出明确重建提示 |
| 未使用索引 | stats_reset 为 NULL，不足以安全删除，保留 |
| 94 个测试脚本维护成本 | 长期可分组归档，暂不重构 |

## 部署（PART H）

- 发布前检查清单：git diff、构建结果、migration 顺序（本轮无新迁移）、回滚策略、环境变量、Pages 配置、OAuth 回调、生产依赖。
- `push develop` 会触发 Pages 部署，属需授权动作；本轮未 push、未部署。
- 获得授权后：本地全绿 → staging 验收 → push → 确认 Pages run success → 生产路由 HTTP 200 → 关键资源哈希一致 → 出具 deployment-report。

## 完成定义对照（PART 14）

| 标准 | 状态 |
|---|---|
| 真实工程问题得到解决 | 是（构建可复现性缺陷已修复） |
| 产品导航清晰 | 是（4 工作区 + 二级菜单，E2E 通过） |
| 知识-功能关联 | 是（注册表 + works 反向关联） |
| 核心学习闭环可运行 | 是；本地与核心云端链路均验证（KV41-010 已修复） |
| 学习数据可靠持久化 | 是（append-only + 原子批次 + 本轮 PG17 通过） |
| 用户数据隔离正确 | 是（本轮 RLS 隔离测试通过） |
| 认证稳定 | 代码与本地是；实体设备/refresh 未验 |
| 多设备同步经验证 | 本地/PG17/Staging 首设备是；第二物理设备未验 |
| 核心测试通过 | 是（本轮实跑全绿） |
| 生产环境实际验收 | 否（需授权，见 deployment-report） |
