# 07 · 设备验收矩阵与上线门槛

原生编译产出只表示程序可被打包，不表示用户在设备上正常使用。为 KNOWVERSE 教育客户端准备以下手工验收矩阵。

| 检查项 | Android 模拟器 | Android 真机 | iOS 模拟器 | iPhone 真机 |
|---|---|---|---|---|
| 启动与首帧 | 待验证 | 待验证 | 待验证 | 待验证 |
| 学习列表与字体缩放 | 待验证 | 待验证 | 待验证 | 待验证 |
| 弱网 / 飞行模式离线数据回退 | 待验证 | 待验证 | 待验证 | 待验证 |
| LAN API 连接 / 契约校验 | 待验证 | 待验证 | 待验证 | 待验证 |
| 后台恢复 / 生命周期 | 待验证 | 待验证 | 待验证 | 待验证 |
| VoiceOver / TalkBack | 待验证 | 待验证 | 待验证 | 待验证 |
| 温度 / 内存 / 续航 | 待验证 | 待验证 | 待验证 | 待验证 |

## 测试步骤

1. 从对应 CI 工作流下载 Android Debug APK 或 iOS Simulator App；不要从仓库复制本机的 `node_modules`。
2. 连接测试 API 时用所在计算机的局域网 IP，不要误用 `localhost`。确保服务端 CORS/网络、防火墙和 HTTP/HTTPS 策略合规。
3. 验证服务端断网：客户端应显示离线样例数据，不崩溃；恢复联网后再运行一轮。
4. 做至少三轮冷启动测量，记录机型、OS 版本、构建 SHA、启动耗时与异常日志。
5. 出现原生崩溃时必须保存 `adb logcat` 或 Xcode Console 日志，并关联构建 SHA。

## 发布门禁

- [ ] 锁文件随代码提交，CI `--frozen-lockfile` 通过
- [ ] Web/API、RN 类型检查通过
- [ ] Android `assembleDebug` 完整通过且上传 APK
- [ ] iOS `xcodebuild ... iphonesimulator` 完整通过且上传 App
- [ ] Android 与 iOS 模拟器均完成设备回归
- [ ] Android/iPhone 真机完成关键链路回归
- [ ] 正式签名和凭据只在受保护的密钥仓库/服务中管理

> 未完成的条目绝不能写成“已验证”。可重现性是持续的工程纪律，不是一次成功截图。

## 自动化模拟器回归

在现有原生编译工作流末尾增加真实模拟器冒烟测试：Android UIAutomator + NestJS API 请求、iOS simctl 安装启动 + NestJS API 请求 + 屏幕截图。详细证据与局限见 [第 08 章](./08-automated-simulator-smoke.md)。

本表中原本的“待验证”是历史状态，不会在 CI 完成前自动改成“通过”；最终以对应 GitHub Actions 工作流的最新结论及工件证据为准。**真机测试仍需单独执行**。
