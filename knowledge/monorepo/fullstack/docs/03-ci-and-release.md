# 03｜真实 CI、锁文件与跨端验收

## 两种 CI，证据边界不同

**静态 CI**：在任何环境运行文件引用检查、工作区声明检查、包图闭包分析。没有安装外部框架，就不能声称 Nest/React Native 已经成功编译。

**集成 CI**：下载真实依赖、编译 contracts 和 domain、构建 Nest API 与 React Web，执行类型检查和契约测试。这个任务需要网络，并应在真正的 GitHub Actions 上验证。移动端的 `tsc --noEmit` 仍不等于完成 iOS/Android 原生构建。

## 为什么缺 lockfile 是风险

教学包为了避免伪造 npm 解析结果，**不附带未经解析的 pnpm-lock.yaml**。首次执行 `pnpm install` 生成真实锁文件后，正式产品应该将它纳入 Git，CI 改为 `pnpm install --frozen-lockfile`。没有 lockfile 的 GitHub Actions 可以证明安装当下的组合能跑，但不能证明可复现。

## 缓存输入

依赖缓存应包含锁文件、Node 与 pnpm 版本、操作系统；类型构建缓存还要包含 tsconfig、环境变量及输出目录。当 CI 迁移版本，先清缓存再对照完整构建日志。

## 推荐发布门槛

- 包边界检查、循环检查、工作区协议校验通过。
- TypeScript/测试/Web bundle/API bundle 通过。
- API 健康探针和协议返回通过。
- RN Expo doctor、Metro 启动、Android/iOS 编译分别有独立记录。
- 未签署真实设备/原生构建证据时，状态应标注「待设备验证」，不能直接声称 production-ready。
