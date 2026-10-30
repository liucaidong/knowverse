# 真实框架集成：React + React Native + NestJS

本专题继续完善 **TypeScript Monorepo**，不是新开知识库专题。

- 版本选择（2026-10-31）：React 19.3、Expo SDK 58 / RN 0.88、NestJS 12、Vite 8、pnpm 12；TypeScript 为兼顾 Nest 装饰器工具链而选 5.9，TS 7 可作为独立升级实验。
- 可检查的源码：`project/`，包含五包工作区与真实框架应用代码。
- 工程知识文章：`docs/`，含架构、故障、CI、工具治理。
- 框架安装与移动端设备打包验证：由 GitHub CI / 实际设备进行；不可将离线 TypeScript 单测视为 iOS/Android 构建证明。

详细说明：[project/README.md](project/README.md)
