# Rust 后端开发说明

ClawNo.11 使用 **Tauri 2 + Rust** 作为桌面应用后端，负责系统交互、进程管理、加密存储和安全扫描等功能。

---

## 环境安装

### 1. 安装 Rust 工具链

访问 https://rustup.rs/ 下载并运行 `rustup-init.exe`（Windows）或执行：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

安装完成后验证：

```bash
rustc --version    # rustc 1.80.x
cargo --version    # cargo 1.80.x
```

### 2. Windows 额外依赖

安装 **Microsoft C++ Build Tools**：
1. 访问 https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. 勾选 **"Desktop development with C++"** 工作负载
3. 安装（约 5-8 GB）

### 3. macOS 额外依赖

```bash
xcode-select --install
```

### 4. Linux 额外依赖（Ubuntu/Debian）

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## 开发命令

```bash
# 在 apps/desktop 目录下运行（通过 pnpm 脚本）
pnpm tauri:dev     # 开发模式（热更新）
pnpm tauri:build   # 生产构建

# 在 apps/desktop/src-tauri 目录下运行（直接使用 cargo）
cargo check        # 快速编译检查（不生成可执行文件）
cargo fmt          # 格式化代码
cargo clippy       # 代码检查（Lint）
cargo test         # 运行测试
```

---

## 模块结构

```
src/
├── main.rs           # 程序入口（仅调用 lib.rs::run()）
├── lib.rs            # 插件注册 + invoke_handler（命令路由表）
├── types.rs          # 共享序列化类型（StepResult / ServiceInfo 等）
├── platform.rs       # 跨平台辅助（shell 执行 / 路径 / PATH 扩展）
├── node.rs           # Node.js 检测与 openclaw/pm2 安装
├── pm2.rs            # pm2 进程生命周期管理
├── gateway.rs        # openclaw 网关启停 + 健康探测
├── deploy.rs         # 部署流水线协调 + API Key 安全写入
├── secure_store.rs   # 加密 KV 存储（tauri-plugin-store）
├── security.rs       # 安全扫描 + Windows 防火墙管理
├── connectors.rs     # IM 连接器（飞书 API / Tailscale 检测）
├── mcp.rs            # MCP 服务器安全扫描（HTTP + Stdio 两种模式）
├── rag.rs            # RAG 文件读取（扩展名白名单 + 路径遍历防护）
└── token_log.rs      # SQLite schema 迁移定义（5 个版本）
```

---

## 关键依赖

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-store = "2"          # AES-GCM 加密 KV 存储
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-dialog = "2"         # 文件选择对话框
tauri-plugin-shell = "2"          # 系统浏览器打开

reqwest = { version = "0.12", features = ["json"] }  # HTTP 客户端
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }       # 异步运行时
dirs-next = "2"                                       # 跨平台目录路径
```

---

## Tauri 命令注册

所有 `#[tauri::command]` 函数在 `lib.rs` 的 `invoke_handler` 中统一注册：

```rust
// lib.rs
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        // 部署
        deploy::deploy_step_check_node,
        deploy::deploy_step_install_openclaw,
        // ... 更多命令
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

完整命令列表请参阅 [docs/API.md](../../../docs/API.md)。

---

## SQLite 迁移

数据库 schema 通过 `token_log.rs` 的 `get_migrations()` 管理，目前有 5 个版本：

| 版本 | 新增表 |
|------|-------|
| v1 | `token_records` |
| v2 | `security_events` |
| v3 | `rag_documents`, `rag_chunks` |
| v4 | `mcp_servers`, `mcp_audit` |
| v5 | `chat_sessions`, `chat_messages` |

> ⚠️ 已发布的迁移不可修改，新增功能请追加新版本。

---

## 安全编码规范

1. **API Key 传输**：通过 stdin 管道传输，禁止放在命令行参数
2. **路径校验**：用户提供的文件路径必须规范化并校验扩展名白名单
3. **命令注入防护**：provider/命令名称使用白名单验证，禁止直接拼接
4. **错误信息**：返回 `Result<T, String>`，错误消息应可读且不泄露内部细节

详细开发指南请参阅 [docs/DEVELOPMENT.md](../../../docs/DEVELOPMENT.md)。
