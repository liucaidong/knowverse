# 工程案例库

> 下面是根据常见工程故障构造的教学案例，不是未经授权的真实企业事故记录。

## Case 01 · 从多仓复制 DTO 到统一 contracts

**故障场景**：三个应用分别定义 LessonState，后端将 fulfilled 改成 completed，RN 仍使用旧枚举。

**处理方案**：抽出零平台依赖的 contracts；消费者只引用包入口；先在三端跑真实编译，再提交缓存优化。

**验收证据**：记录三个端的旧字段引用；让编译在错误处失败；Node API、Web bundler、Metro 双平台打包均通过。

**反模式**：只建立 types 包并不意味着运行时数据有校验。来自 HTTP 的不可信对象仍应经过运行时 schema 验证。

## Case 02 · CI 从 42 分钟降到更短，先确保不错判

**故障场景**：一个单测文件变更触发全仓 build，迁移团队试图引入 task-based affected。

**处理方案**：先定义 build/test 的 inputs 与 outputs；用 source、test、lockfile 各三种变化测试 affected 的正确性，再测时间。

**验收证据**：每种变更有执行任务列表、原因和缓存命中记录；对全局变化采取保守扩大策略。

**反模式**：Nx 24 新仓库默认 task-based affected，旧仓迁移可能保留 affected.legacy=true；不能忽略。

## Case 03 · 为什么早期不急着引入 Rush

**故障场景**：团队仅 4 个包，没有公开 npm 发布；CI 低于 5 分钟，但想象中的未来扩张导致配置越来越复杂。

**处理方案**：先 pnpm Workspace + 显式 package dependencies + TypeScript refs + boundary checks；等发布治理成为真实成本再评估 Rush。

**验收证据**：两周内能读出跨包错误、构建图可预测，项目成员能独立解释依赖边界。

**反模式**：工具在组织复杂度不成立时可能增加部署与培训负担；Rush 的适配条件不能被忽略。

## Case 04 · React Native 看得到类型但设备启动失败

**故障场景**：packages/domain 引入 Node-only API，通过 tsc -b，但 Metro 在 Android 打包失败。

**处理方案**：将平台副作用移到 api adapter；domain 使用依赖注入纯接口。单测之外加入 Android/iOS bundling 和启动验证。

**验收证据**：Node smoke test、Web build、RN 两个平台 bundle 均通过，包 exports 条件无歧义。

**反模式**：Metro 的 symlink、exports 与平台文件选择取决于版本。用 Node 解析成功不能替代设备验证。

