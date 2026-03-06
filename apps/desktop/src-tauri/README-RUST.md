# Rust 环境安装说明

Tauri 2.0 需要 Rust 工具链才能编译桌面应用。

## 安装步骤

1. 访问 https://rustup.rs/ 下载并运行 rustup-init.exe
2. 安装完成后重启终端
3. 验证安装：`rustc --version`

## 安装 Tauri CLI 系统依赖（Windows）

需要安装 Microsoft C++ Build Tools：
- 访问 https://visualstudio.microsoft.com/visual-cpp-build-tools/
- 勾选 "Desktop development with C++"

## 构建

```bash
# 开发模式（热更新）
pnpm tauri:dev

# 生产构建
pnpm tauri:build
```
