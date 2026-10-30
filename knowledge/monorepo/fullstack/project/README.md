# KNOWVERSE · 实际多端 Monorepo 参考工程

> 真正使用 React、React Native（Expo SDK 58）、NestJS 12 的源码工程。与此前五包「纯类型/逻辑」参考工程不同；它包含真实框架依赖，但并不包含生成的 iOS/Android 原生工程。

## 系统要求

- Node.js >=22.13（推荐当前 LTS），pnpm 12.16.1
- iOS 真机/模拟器需配置 Xcode / CocoaPods，Android 需 Android SDK，**GitHub Pages 不运行 NestJS 后端**。
- 本项目不提交 node_modules、构建产物或密钥。

## 快速启动

```bash
corepack enable
pnpm install
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
2. 网络可用后：`pnpm install && pnpm build && pnpm typecheck && pnpm test`。
3. 设备层：`pnpm dev:mobile` 后分别用 Android/iOS 模拟器和真机验证。需要 Xcode/Android SDK/真机，不能凭 TypeScript 编译成功代替。

## 设计注意

- 严格显式声明 `workspace:*`，不用 TypeScript `paths` 伪装成 npm 包依赖。
- TypeScript Project References 只用于 `contracts` / `domain` / API。Web 和 Metro 不直接消费根级 tsconfig references，读取经过 build 的 package exports。
- 契约检查接收 `unknown` 后进行验证，TS 静态类型不代表网络返回安全。
- React Web 和 RN 不引入 NestJS；`packages/*` 不引入 `node:`、`expo` 或 React Native。
- 为方便教学使用未锁定的兼容次版本；**正式用于产品前要 `pnpm install` 生成并提交 pnpm-lock.yaml**，在 CI 改成 frozen-lockfile。
- API 默认 CORS 仅为 localhost:5173，生产中设置 WEB_ORIGIN 与鉴权。
- 第三方依赖的安装、Expo SDK 专属版本和原生打包仍需要真实 CI/设备检验；不要把本地离线模拟误认成已验证的原生安装。

## 参考（2026-10-31）

- https://docs.expo.dev/guides/monorepos/
- https://docs.expo.dev/versions/v58.0.0/
- https://docs.nestjs.com/first-steps
- https://www.typescriptlang.org/docs/handbook/project-references.html
- https://pnpm.io/workspaces
- https://vite.dev/guide/
