# ClawNo.11 开发环境搭建与贡献指南

> 本文档面向希望参与 ClawNo.11 开发或在本地构建项目的开发者。

---

## 目录

1. [环境要求](#1-环境要求)
2. [Windows 环境搭建](#2-windows-环境搭建)
3. [macOS/Linux 环境搭建](#3-macoslinux-环境搭建)
4. [项目安装与启动](#4-项目安装与启动)
5. [开发工作流](#5-开发工作流)
6. [项目结构说明](#6-项目结构说明)
7. [前端开发指南](#7-前端开发指南)
8. [Rust 后端开发指南](#8-rust-后端开发指南)
9. [测试](#9-测试)
10. [构建与发布](#10-构建与发布)
11. [常见问题（FAQ）](#11-常见问题faq)

---

## 1. 环境要求

| 工具 | 最低版本 | 推荐版本 | 下载地址 |
|------|---------|---------|---------|
| Node.js | 18.x | 20.x LTS | https://nodejs.org |
| pnpm | 9.x | 最新稳定版 | https://pnpm.io |
| Rust | 1.80 | 最新稳定版 | https://rustup.rs |
| Git | 2.x | 最新稳定版 | https://git-scm.com |

**Windows 额外要求**：
- Microsoft C++ Build Tools（含 Desktop development with C++ 工作负载）
- WebView2 Runtime（Windows 11 已内置；Windows 10 需单独安装）

**macOS 额外要求**：
- Xcode Command Line Tools：`xcode-select --install`

---

## 2. Windows 环境搭建

### 2.1 安装 Rust

```powershell
# 下载并运行 rustup 安装程序
# 访问 https://rustup.rs/ 下载 rustup-init.exe
rustup-init.exe
# 选择 "1) Proceed with standard installation"

# 重启终端后验证
rustc --version    # rustc 1.80.x (...)
cargo --version    # cargo 1.80.x (...)
```

### 2.2 安装 Microsoft C++ Build Tools

1. 访问 https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. 下载并运行 `vs_BuildTools.exe`
3. 勾选 **"Desktop development with C++"** 工作负载
4. 点击安装（约 5-8 GB）

### 2.3 安装 Node.js

```powershell
# 方式一：直接下载安装包（推荐）
# 访问 https://nodejs.org 下载 LTS 版本

# 方式二：使用 winget
winget install OpenJS.NodeJS.LTS

# 验证
node --version    # v20.x.x
npm --version     # 10.x.x
```

### 2.4 安装 pnpm

```powershell
npm install -g pnpm
pnpm --version    # 9.x.x
```

### 2.5 安装 WebView2 Runtime（Windows 10）

访问 https://developer.microsoft.com/en-us/microsoft-edge/webview2/ 下载并安装 Evergreen Bootstrapper。

> Windows 11 已内置 WebView2，无需额外安装。

---

## 3. macOS/Linux 环境搭建

### macOS

```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 安装 Node.js（推荐使用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# 安装 pnpm
npm install -g pnpm
```

### Linux（Ubuntu/Debian）

```bash
# 安装系统依赖（Tauri 需要）
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev

# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 Node.js（nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20

# 安装 pnpm
npm install -g pnpm
```

---

## 4. 项目安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/clawno11/clawno11.git
cd clawno11

# 2. 安装所有依赖（含 workspace 子包）
pnpm install

# 3. 进入桌面应用目录
cd apps/desktop

# 4. 启动开发模式
pnpm tauri:dev
```

`pnpm tauri:dev` 会同时启动：
- Vite 开发服务器（前端热更新，端口 1420）
- Tauri 应用窗口（加载 Vite dev server）
- Rust 后端编译（首次编译约 2-5 分钟）

> **首次编译提示**：Rust 首次构建需要下载并编译所有依赖（约 2-5 分钟），后续增量编译很快（通常 < 30 秒）。

---

## 5. 开发工作流

### 5.1 日常开发命令

```bash
# 在 apps/desktop 目录下执行

# 开发模式（推荐：同时启动前端和 Tauri）
pnpm tauri:dev

# 仅启动前端（不打开 Tauri 窗口，用于纯 UI 调试）
pnpm dev

# 类型检查
pnpm type-check

# 代码格式检查
pnpm lint

# 运行测试
pnpm test

# 运行测试（带 UI）
pnpm test:ui
```

### 5.2 Rust 相关命令

```bash
# 在 apps/desktop/src-tauri 目录下执行

# 检查编译（不生成可执行文件，比 build 快）
cargo check

# 格式化 Rust 代码
cargo fmt

# Rust 代码检查（Clippy）
cargo clippy

# 运行 Rust 测试
cargo test
```

### 5.3 分支策略

```
main           # 生产分支，只接受 PR 合并，保护分支
├── develop    # 开发分支，日常开发基于此分支
│   ├── feat/xxx    # 功能分支
│   ├── fix/xxx     # 修复分支
│   └── refactor/xxx # 重构分支
└── release/x.y.z  # 发布分支
```

### 5.4 Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
feat: 添加 MCP 服务器安全扫描功能
fix: 修复 Token 计数在流式响应中的双重计数问题
refactor: 重构 RAG 检索算法，改用 TF-IDF
docs: 更新 API 文档
chore: 升级 Tauri 到 2.4.x
```

---

## 6. 项目结构说明

```
clawno11/
├── apps/desktop/
│   ├── src/                    # 前端源码（React + TypeScript）
│   │   ├── main.tsx            # 应用入口，初始化 React + i18n + 路由
│   │   ├── App.tsx             # 根组件，定义路由和全局布局
│   │   ├── ipc.ts              # Tauri IPC 桥接层（所有 invoke 调用）
│   │   ├── i18n.ts             # i18next 配置（加载 zh/en 语言包）
│   │   ├── index.css           # 全局样式（Tailwind 指令 + CSS 变量）
│   │   ├── components/         # 共享 UI 组件
│   │   ├── pages/              # 页面组件（对应路由）
│   │   ├── store/              # 状态管理（Zustand + SQLite hooks）
│   │   └── locales/            # 国际化语言包
│   └── src-tauri/
│       ├── src/                # Rust 源码
│       │   ├── main.rs         # Rust 入口（调用 lib.rs::run()）
│       │   ├── lib.rs          # 插件注册 + invoke_handler（命令路由表）
│       │   └── *.rs            # 各业务模块
│       ├── Cargo.toml          # Rust 依赖声明
│       ├── tauri.conf.json     # 应用名称/版本/窗口/CSP 配置
│       └── capabilities/
│           └── default.json    # WebView 权限白名单（最小权限原则）
└── packages/                   # 共享 workspace 包（如有）
```

---

## 7. 前端开发指南

### 7.1 添加新页面

1. 在 `src/pages/` 创建新组件文件（如 `NewFeaturePage.tsx`）
2. 在 `src/App.tsx` 添加路由：
   ```tsx
   <Route path="/new-feature" element={<NewFeaturePage />} />
   ```
3. 在 `src/components/Sidebar.tsx` 添加导航项
4. 在 `src/locales/zh.json` 和 `en.json` 添加对应翻译 key

### 7.2 添加新 Store

在 `src/store/` 创建新文件，推荐使用 Zustand：

```typescript
// src/store/myStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface MyState {
  items: MyItem[];
  addItem: (item: MyItem) => void;
}

export const useMyStore = create<MyState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) => set((state) => ({ items: [...state.items, item] })),
    }),
    { name: 'clawno-my-store' }  // localStorage key
  )
);
```

对于需要 SQLite 的 Store，参考 `src/store/chatHistory.ts` 模式：

```typescript
import Database from '@tauri-apps/plugin-sql';
import { DB_URL } from './db';

async function getDb() {
  return Database.load(DB_URL);
}

export async function insertRecord(data: MyData) {
  const db = await getDb();
  await db.execute(
    'INSERT INTO my_table (col1, col2) VALUES (?, ?)',
    [data.col1, data.col2]
  );
}
```

### 7.3 样式规范

项目使用 **Tailwind CSS 3** 配合自定义 CSS 变量（在 `index.css` 中定义）。

**主题变量**（支持深色/浅色模式）：
```css
:root {
  --bg-primary: #0f1117;
  --bg-secondary: #1a1d27;
  --text-primary: #e2e8f0;
  --accent-green: #22c55e;
  --accent-blue: #3b82f6;
  --border-color: rgba(255, 255, 255, 0.08);
}
```

**规范**：
- 优先使用 Tailwind 工具类
- 避免内联样式
- 自定义颜色使用 CSS 变量，不要硬编码十六进制值
- 图标使用 `lucide-react`

### 7.4 国际化

在组件中使用 `useTranslation` hook：

```tsx
import { useTranslation } from 'react-i18next';

export function MyComponent() {
  const { t } = useTranslation();
  return <button>{t('my_button_label')}</button>;
}
```

在 `src/locales/zh.json` 和 `src/locales/en.json` 中添加对应 key：

```json
// zh.json
{
  "my_button_label": "点击我"
}

// en.json
{
  "my_button_label": "Click Me"
}
```

### 7.5 调用 Tauri 命令

通过 `src/ipc.ts` 中封装的函数调用（不要在组件中直接 `invoke`）：

```typescript
// src/ipc.ts 中添加
import { invoke } from '@tauri-apps/api/core';

export const ipc = {
  // ... 现有命令 ...
  myNewCommand: (param: string) =>
    invoke<MyResult>('my_new_command', { param }),
};
```

在组件中使用：

```tsx
import { ipc } from '../ipc';

const result = await ipc.myNewCommand('hello');
```

---

## 8. Rust 后端开发指南

### 8.1 添加新 Tauri 命令

1. 在适当的模块文件（或新建模块）中定义命令函数：

```rust
// src/my_module.rs
use tauri::command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct MyResult {
    pub success: bool,
    pub message: String,
}

#[command]
pub async fn my_new_command(param: String) -> Result<MyResult, String> {
    // 实现逻辑
    Ok(MyResult {
        success: true,
        message: format!("Processed: {}", param),
    })
}
```

2. 在 `src/lib.rs` 中注册：

```rust
// lib.rs
mod my_module;

// 在 invoke_handler 中添加
.invoke_handler(tauri::generate_handler![
    // ... 现有命令 ...
    my_module::my_new_command,
])
```

3. 在 `src/ipc.ts` 中添加对应的 TypeScript 包装（见 7.5）

### 8.2 跨平台 Shell 命令

使用 `platform.rs` 中的辅助函数，不要直接使用 `std::process::Command`：

```rust
use crate::platform::{shell_cmd, augmented_path, shell_result};

pub async fn my_command() -> Result<String, String> {
    let (shell, flag) = shell_cmd();
    let output = std::process::Command::new(shell)
        .arg(flag)
        .arg("node --version")
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| e.to_string())?;
    
    Ok(shell_result(output))
}
```

### 8.3 添加 SQLite 迁移

在 `src/token_log.rs` 的 `get_migrations()` 中追加新版本：

```rust
pub fn get_migrations() -> Vec<Migration> {
    vec![
        // ... 现有迁移（v1-v5）...
        Migration {
            version: 6,  // 递增版本号
            description: "add my new table",
            sql: "CREATE TABLE my_table (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
            kind: MigrationKind::Up,
        },
    ]
}
```

> **注意**：迁移版本号必须严格递增，且已发布的迁移 **绝对不能修改**（会破坏已有数据库）。

### 8.4 错误处理规范

所有 `#[command]` 函数返回 `Result<T, String>`，错误信息应简洁、可读：

```rust
#[command]
pub async fn my_command(path: String) -> Result<String, String> {
    // 好的错误处理
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))
    
    // 避免：直接 .unwrap() 或 panic!
}
```

### 8.5 安全编码规范

- **永远不要**在命令行参数中传递用户输入的密钥 → 使用 stdin 管道
- **永远不要**信任用户提供的文件路径 → 规范化并校验
- **永远不要**直接拼接 shell 命令字符串 → 使用参数化命令或白名单验证
- **始终**对用户可控输入进行类型/范围检查

---

## 9. 测试

### 9.1 前端测试（Vitest）

```bash
# 在 apps/desktop 目录下
pnpm test              # 运行所有测试（无界面）
pnpm test:ui           # 运行所有测试（带 Vitest UI）
pnpm test -- --watch   # 监听模式
```

测试文件位于 `src/**/*.test.ts` 或 `src/**/*.spec.ts`。

示例测试：

```typescript
// src/store/piiFilter.test.ts
import { describe, it, expect } from 'vitest';
import { filterPII } from './piiFilter';

describe('PII Filter', () => {
  it('应替换手机号', () => {
    const result = filterPII('我的手机是 13812345678');
    expect(result).toBe('我的手机是 [PHONE]');
  });

  it('应替换邮箱地址', () => {
    const result = filterPII('联系 user@example.com');
    expect(result).toBe('联系 [EMAIL]');
  });
});
```

### 9.2 Rust 测试

```bash
# 在 apps/desktop/src-tauri 目录下
cargo test             # 运行所有测试
cargo test --lib       # 只运行 lib 测试
cargo test mcp         # 运行名称包含 "mcp" 的测试
```

示例 Rust 测试：

```rust
// src/security.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_calculation() {
        let score = calculate_score(vec![
            CheckStatus::Ok,
            CheckStatus::Warn,
            CheckStatus::Ok,
            CheckStatus::Ok,
        ]);
        // (1.0 + 0.5 + 1.0 + 1.0) / 4 * 100 = 87
        assert_eq!(score, 87);
    }
}
```

---

## 10. 构建与发布

### 10.1 生产构建

```bash
# 在 apps/desktop 目录下
pnpm tauri:build
```

构建产物位于 `apps/desktop/src-tauri/target/release/bundle/`：

| 平台 | 产物路径 | 格式 |
|------|---------|------|
| Windows | `bundle/msi/*.msi` | Windows Installer |
| Windows | `bundle/nsis/*.exe` | NSIS 安装包 |
| macOS | `bundle/macos/*.app` | macOS 应用 |
| macOS | `bundle/dmg/*.dmg` | DMG 镜像 |
| Linux | `bundle/deb/*.deb` | Debian 包 |
| Linux | `bundle/rpm/*.rpm` | RPM 包 |
| Linux | `bundle/appimage/*.AppImage` | AppImage |

### 10.2 版本号管理

版本号在两处定义，更新时需要保持同步：

```json
// apps/desktop/package.json
{
  "version": "0.1.0"
}
```

```toml
# apps/desktop/src-tauri/Cargo.toml
[package]
version = "0.1.0"
```

```json
// apps/desktop/src-tauri/tauri.conf.json
{
  "version": "0.1.0"
}
```

### 10.3 GitHub Actions CI/CD

（参考 `.github/workflows/` 目录中的 workflow 配置）

构建流程：
1. 在 Ubuntu / macOS / Windows 三平台并行构建
2. 运行前端测试（Vitest）
3. 运行 Rust 测试（cargo test）
4. 执行 `pnpm tauri:build`
5. 上传构建产物到 GitHub Releases

---

## 11. 常见问题（FAQ）

### Q: 首次 `pnpm tauri:dev` 时间很长？

**A**：Rust 首次编译需要下载并编译所有 crate 依赖，约 3-10 分钟（取决于网络和机器性能）。后续增量编译通常 < 30 秒。

**优化技巧**：
```bash
# 使用 sccache 缓存编译结果（可选）
cargo install sccache
export RUSTC_WRAPPER=sccache
```

---

### Q: Windows 上出现 "LINK : fatal error LNK1181" 链接错误？

**A**：缺少 Microsoft C++ Build Tools。按照[第 2.2 节](#22-安装-microsoft-c-build-tools)安装后重试。

---

### Q: `invoke` 调用返回 "Command not found" 错误？

**A**：检查该命令是否已在 `src/lib.rs` 的 `invoke_handler` 中注册。重启 `pnpm tauri:dev` 使 Rust 重新编译。

---

### Q: SQLite 迁移失败？

**A**：常见原因：
1. 迁移版本号不连续（必须严格递增）
2. SQL 语法错误（在 SQLite 中验证 DDL）
3. 数据库文件已损坏（删除 `~/.local/share/clawno11/clawno.db` 重新初始化）

---

### Q: 前端修改了但 Tauri 窗口没有更新？

**A**：检查 Vite dev server 是否正常运行（看终端输出）。若页面白屏，打开 Tauri 开发者工具（右键 → Inspect）查看控制台错误。

---

### Q: 中文 Windows 系统下 shell 命令输出乱码？

**A**：`platform.rs` 中已处理 Windows 的 GBK 编码问题。若仍有问题，可在命令前加 `chcp 65001 &&`（切换到 UTF-8 代码页）。

---

### Q: 如何在不启动 OpenClaw 网关的情况下调试前端 UI？

**A**：在组件中 mock IPC 调用：

```typescript
// 临时 mock，仅用于开发调试
const result = isDev
  ? { ok: true, message: 'mock', duration_ms: 100 }
  : await ipc.deployLocal();
```

或直接使用 `pnpm dev`（不启动 Tauri）在浏览器中调试纯 UI。

---

## 贡献流程

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feat/my-feature`）
3. 编写代码（遵循本文档规范）
4. 运行测试确保通过（`pnpm test && cargo test`）
5. 运行代码检查（`cargo clippy && pnpm lint`）
6. 提交 PR 到 `develop` 分支
7. 等待 Code Review

**PR 描述模板**：
```markdown
## 变更说明
简要描述本次 PR 的目的和主要变更。

## 变更类型
- [ ] 新功能（feat）
- [ ] Bug 修复（fix）
- [ ] 重构（refactor）
- [ ] 文档更新（docs）
- [ ] 其他

## 测试
描述如何测试本次变更。

## 截图（如有 UI 变更）
```
