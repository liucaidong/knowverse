# KNOWVERSE · 实际多端 Monorepo 参考工程

> 真正使用 React、React Native（Expo SDK 58）、NestJS 12 的源码工程。与此前五包「纯类型/逻辑」参考工程不同；它包含真实框架依赖，但并不包含生成的 iOS/Android 原生工程。

## 系统要求

- Node.js >=22.13（推荐当前 LTS），pnpm 12.16.1
- iOS 真机/模拟器需配置 Xcode / CocoaPods，Android 需 Android SDK，**GitHub Pages 不运行 NestJS 后端**。
- 本项目不提交 node_modules、构建产物或密钥。

## 快速启动

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build:shared
pnpm check:boundaries
pnpm test
# Terminal A
pnpm dev:api
# Terminal B
pnpm dev:web
# Terminal C
pnpm dev:mobile
```

访问 http://localhost:5173 和 http://localhost:3000/api/lessons。
手机真机访问前复制 `apps/mobile/.env.example` 至 `.env`，将地址替换为电脑在同一 Wi-Fi 下的内网 IP。安全组/防火墙也要放行端口。不要在手机上使用 localhost 指向电脑。

## 结构

```
packages/contracts  -> 运行时 JSON 契约检查 + TS 类型
packages/domain     -> 平台无关领域逻辑，依赖 contracts
apps/api            -> NestJS REST API，依赖 domain 和 contracts
apps/web            -> React 19 + Vite 8，依赖 domain 和 contracts
apps/mobile         -> React Native 0.88 + Expo SDK 58，依赖 domain 和 contracts
```

## 验证层级

1. 本地无需 npm 联网：静态边界、依赖闭包、shared TypeScript 编译与运行时契约测试。
2. 网络可用后：`pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test`。
3. 设备层：`pnpm dev:mobile` 后分别用 Android/iOS 模拟器和真机验证。需要 Xcode/Android SDK/真机，不能凭 TypeScript 编译成功代替。

## 设计注意

- 严格显式声明 `workspace:*`，不用 TypeScript `paths` 伪装成 npm 包依赖。
- TypeScript Project References 只用于 `contracts` / `domain` / API。Web 和 Metro 不直接消费根级 tsconfig references，读取经过 build 的 package exports。
- 契约检查接收 `unknown` 后进行验证，TS 静态类型不代表网络返回安全。
- React Web 和 RN 不引入 NestJS；`packages/*` 不引入 `node:`、`expo` 或 React Native。
- 依赖版本由已提交的 `pnpm-lock.yaml` 锁定；本项目的 CI 始终执行 `pnpm install --frozen-lockfile`，避免不同时间解析到不同 transitive 版本。
- API 默认 CORS 仅为 localhost:5173，生产中设置 WEB_ORIGIN 与鉴权。
- 第三方依赖的安装、Expo SDK 专属版本和原生打包仍需要真实 CI/设备检验；不要把本地离线模拟误认成已验证的原生安装。

## 参考（2026-10-31）

- https://docs.expo.dev/guides/monorepos/
- https://docs.expo.dev/versions/v58.0.0/
- https://docs.nestjs.com/first-steps
- https://www.typescriptlang.org/docs/handbook/project-references.html
- https://pnpm.io/workspaces
- https://vite.dev/guide/

## 原生构建验证与签名边界

- `.github/workflows/monorepo-android.yml`：Android SDK API 37 + JDK17；Expo Prebuild → Gradle Debug APK。
- `.github/workflows/monorepo-ios.yml`：macOS 26 + Xcode26.4.1；Expo Prebuild → CocoaPods → 无签名的 iOS Simulator App。
- **这些 CI 工作流的状态不等于真实 iPhone/Android 真机回归**。参见 `../docs/07-device-validation.md`。
- 实际下载与安装之前，不要将 APK / `.app` 当成商店可发布版本。
- 安全准则：仓库不存储任何 Apple 签名证书、Android 上传密钥或设备私钥。

## 可复现安装

```bash
pnpm install --frozen-lockfile
pnpm verify:lockfile
pnpm verify:native-config
```

GitHub Actions 的 `setup-node` pnpm 缓存命中键依据 `project/pnpm-lock.yaml`，不直接缓存 node_modules。
更多请参见 `../docs/05-dependency-lock-and-cache.md` 和 `../docs/06-native-build-ci.md`。

## 模拟器自动化冒烟测试（独立于编译）

当前 Android 和 iOS 原生 CI 在编译产物之后运行设备烟雾测试，见 `tools/device-smoke/` 和 `../docs/08-automated-simulator-smoke.md`。

- Android 使用 API 35 模拟器运行 SDK 37 编译的 Debug APK，要求 ADB UIAutomator 看到**实际 React Native 文本**和**API 成功状态**。
- iOS 使用 Runner 已安装的模拟器安装、启动无签名 `.app`，检查客户端真实访问 NestJS 并保存截图；不声称 XCTest UI 断言。
- 调试构建运行时依赖 Expo Metro；Android 使用 `adb reverse`，与真实手机的 LAN API 连接方式不同。
- 以上步骤不替代真实 Android 手机/iPhone 的网络、权限、相机、音频、VoiceOver 或性能回归。
