# Phase I：验收与发布清单

## 自动化验收

| 验收项 | 覆盖内容 |
|---|---|
| 上下文映射 | 真实专题、作品、挑战、能力、先修关系可被正确映射 |
| 证据隔离 | 只纳入相关能力事件摘要；不把原始答案字段带入上下文 |
| 隐私最小化 | 任务内部 ID 不发送；页面摘录默认为空且受 2,000 字限制 |
| 未映射专题 | 不虚构能力状态、掌握度或证据 |
| 请求协议 | mode=tutor 与 explain/hint/diagnose/transfer 正确传递；无效模式被拒绝 |
| 工具隔离 | tutor 响应仅验证 reply 文本，并在服务端无条件丢弃所有 suggestions 和 dataRequests 字段 |
| 默认拒绝发送 | 未勾选单次云端授权时，浏览器不产生 Edge Function 请求 |
| 学习证据边界 | 导师对话不生成掌握事件 |
| 页面接入 | 已登记 live work 与映射知识页面统一使用 learning-integration.mjs |
| 移动布局 | 390px WebKit 视口可打开、关闭抽屉，无固定浮层挡住主要操作 |

## 当前自动化验证结果

- scripts/verify-learning-tutor.mjs：4 项通过，含上下文脱敏、证据边界、Provider 请求协议。
- scripts/e2e-learning-tutor.mjs：4 个浏览器场景通过，覆盖未授权不发送、单轮授权与显式摘录发送、Promise/React Native/Monorepo 现场映射、390px WebKit 移动布局。
- 额外执行 scripts/e2e-react-native-domain.mjs：3 项通过。
- 既有学习/数据库/Agent/规划回归：141 项通过；Monorepo starter 3 项、Monorepo labs 5 项通过。
- 多项目 E2E 回归：35 项通过，覆盖跨设备归档、Agent、计划、学习智能、H1 Promise 试点、课程阅读、导航与 44 条 canonical routes。
- 全站内容/静态路由构建、Promise 和 Monorepo 校验、语法检查及 deno check 均通过。

## 云端发布验收

- [x] 将 supabase/functions/learning-agent/index.ts 发布到已绑定项目：learning-agent v7，verify_jwt=true。
- [x] 通过 Supabase MCP 读取云端源文件，核对 tutor allowlist、只读策略、Agent/tutor 指令隔离与服务端响应剥离。
- [ ] 检查服务端 AI_PROVIDER_API_KEY、AI_PROVIDER_MODEL、可选 AI_PROVIDER_BASE_URL 是否已配置。不得将密钥写入仓库或浏览器配置。
- [ ] 使用获准 GitHub 账户登录，在真实课程页勾选本轮授权，验证 tutor 回复。
- [ ] 验证不勾选授权时没有网络请求；取消授权后下一条消息仍需再次授权。
- [ ] 检查 Edge Function 日志中无明文原始答题日志、无敏感页面正文、无完整个人档案。
- [ ] 用一轮 Hint 和一轮 Transfer 验证模型遵守“不揭示正式挑战答案”和“未评分练习”边界。
- [ ] 再次检查 Learning Events，确认导师对话本身不产生掌握或 Gap 变更。

注意：代码合并、CI 通过和 Edge Function 发布并不等于真实授权账户端到端验收通过。
