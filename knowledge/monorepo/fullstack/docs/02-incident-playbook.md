# 02｜跨端 Monorepo 故障排查手册

## A. RN 找不到 workspace package

第一步检查 `apps/mobile/package.json` 是否声明了 `@kv/contracts: workspace:*` 等。第二步检查 Metro 消费的路径是否存在 `dist/index.js`，运行 `pnpm build:shared`；不要在 Metro 里指向不存在的源码转译路径。Expo SDK 52+ 已有 monorepo 自动配置，**不要先盲目添加 watchFolders / extraNodeModules**。第三步执行 `pnpm --filter @kv/mobile start --clear`，再验证 Expo 版本兼容。

## B. NestJS 启动时加载不到包

检查 `@kv/domain/package.json` 的 `exports` 指向已构建 JS，`apps/api/tsconfig` 使用 `NodeNext` 并对相对 ESM import 写 `.js` 后缀。若错误是装饰器相关，检查 `reflect-metadata` 和 `experimentalDecorators / emitDecoratorMetadata`；TS 7 相关变动不能在未经验证前直接当作 Nest 的稳定替代。

## C. Web 可以调用而 iPhone 不行

iPhone 上 `localhost:3000` 指向**手机**，不是 Mac。使用 `EXPO_PUBLIC_API_URL=http://电脑内网IP:3000`，保持同一 Wi-Fi、确认端口和防火墙规则，然后通过手机浏览器先访问 `/api/health`。这属于网络拓扑问题，不能通过 TS 类型检查解决。

## D. Web 接口返回不兼容 JSON

把远程响应先当 `unknown`，用 `parseLessonsResponse` 检查 `revision`、数组元素和字段有效性；不要依赖 `as LessonsResponse` 绕过验证。修改协议时先升级 API 和 consumer 的测试，再变更实际使用方。

## E. pnpm hoisted / isolated

默认使用 pnpm 的 isolated 布局，能更好暴露未声明依赖。Expo SDK 54 起可兼容 isolated，不过部分原生库仍不兼容；应有证据地切换 `nodeLinker: hoisted`，并用静态 guard 保持逻辑依赖边界，而不是直接放弃治理。
