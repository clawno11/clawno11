# iOS 构建指南

## 前置条件（Mac 上一次性操作）

```bash
# 1. 安装 Rust iOS 编译目标
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

# 2. 确认 Xcode Command Line Tools
xcode-select --install

# 3. 确认 Xcode 已安装（App Store 下载，版本 >= 15）
xcodebuild -version
```

## 填写 Team ID

在 `src-tauri/tauri.conf.json` 里把 `YOUR_TEAM_ID` 替换为真实的 Apple Team ID：

- 登录 [developer.apple.com/account](https://developer.apple.com/account)
- 进入 **Membership** 页面
- 复制 **Team ID**（格式：10 位字母数字，如 `A1B2C3D4E5`）

```json
"iOS": {
  "minimumSystemVersion": "16.0",
  "developmentTeam": "A1B2C3D4E5",   // <-- 替换这里
  "bundleVersion": "1"
}
```

## 初始化 Xcode 工程（首次）

```bash
cd apps/mobile
pnpm install
pnpm tauri ios init
```

完成后会生成 `src-tauri/gen/apple/` 目录，包含完整 Xcode 工程。

> **合并 Info.plist 权限**
> 将 `src-tauri/Info.plist` 的内容手动合并进：
> `src-tauri/gen/apple/ClawNo_11/Info.plist`

## 启动模拟器

```bash
# 列出可用模拟器
pnpm tauri ios dev --list-simulator

# 启动（默认选第一个可用模拟器）
pnpm tauri ios dev
```

## 在真机上运行

```bash
# 列出已连接设备
pnpm tauri ios dev --list-device

# 在真机运行（需要已在 Xcode 配置签名）
pnpm tauri ios dev --device
```

## 打包 TestFlight / App Store

```bash
# 构建发布包（IPA）
pnpm tauri ios build --release

# 产物位于：
# src-tauri/gen/apple/build/arm64/Release-iphoneos/ClawNo_11.ipa
```

然后用 Xcode Organizer 或 `xcrun altool` 上传到 App Store Connect。

## Bundle ID

`ai.clawno11.mobile`（已在 `tauri.conf.json` 中配置）

## 常见问题

| 错误 | 解决方法 |
|------|----------|
| `error: target 'aarch64-apple-ios' not found` | 运行 `rustup target add aarch64-apple-ios` |
| `Signing certificate not found` | 在 Xcode → Signing & Capabilities 里重新选择 Team |
| `HTTP 连接被拒绝` | 检查 Info.plist 里 `NSAllowsLocalNetworking` 是否为 true |
| `gen/apple not found` | 先运行 `pnpm tauri ios init` |
| `Registering simulator runtime with CoreSimulator failed` | 见下方说明 |

### Registering simulator runtime with CoreSimulator failed

下载 iOS 模拟器 Runtime 后出现此弹窗，原因是 CoreSimulator 无法完成注册（常见于网络中断、文件损坏或磁盘空间不足）。

**解决步骤（在 Mac 上按顺序执行）：**

```bash
# 1. 重启 CoreSimulator 守护进程
sudo pkill -9 -f CoreSimulator
sudo launchctl bootout system /Library/LaunchDaemons/com.apple.CoreSimulator.CoreSimulatorService.plist 2>/dev/null || true

# 2. 清除损坏的缓存
rm -rf ~/Library/Developer/CoreSimulator/Caches/
rm -rf ~/Library/Caches/com.apple.dt.Xcode/

# 3. 列出已注册的 Runtime，确认是否存在问题条目
xcrun simctl runtime list

# 4. 删除注册失败的 Runtime（把 <RUNTIME_ID> 换成上一步输出的 ID）
xcrun simctl runtime delete <RUNTIME_ID>

# 5. 重新在 Xcode 中下载并安装 Runtime
#    Xcode → Settings（⌘,）→ Platforms → 点击目标 iOS 版本旁的下载按钮
```

**若问题仍存在，尝试：**

```bash
# 方法 A：用 xcode-select 重置工具链
sudo xcode-select --reset

# 方法 B：手动重新注册（需要知道 .dmg 路径）
# Xcode 下载的 Runtime 通常在：
# ~/Library/Developer/Xcode/iOS DeviceSupport/  或
# /Library/Developer/CoreSimulator/Profiles/Runtimes/
xcrun simctl runtime add /path/to/iOS-XX.X-SimulatorRuntime.dmg
```

> **根本原因**：Xcode 从 Xcode 14+ 开始将模拟器 Runtime 作为独立包下载，下载不完整或磁盘空间不足（Runtime 单个约 7–10 GB）时就会出现此错误。建议确保磁盘剩余空间 ≥ 20 GB 再重新下载。
