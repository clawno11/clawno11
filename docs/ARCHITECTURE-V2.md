# ClawNo.11 系统架构 v2.0

> 生成日期：2026-03-12
> 基于：架构诊断 + 自愈能力分析

---

## 一、设计原则

```
1. 共享核心，扩展边缘  — 共同逻辑只写一次，平台差异通过扩展而非复制
2. 编译器保证一致性    — 用 Cargo workspace + TypeScript path 让不同步在编译期暴露
3. 不可变内核          — Rust 编译二进制天然不可被运行时修改，是安全基石
4. 配置驱动行为        — 自愈系统只修改配置/Store，永远不修改编译层代码
5. MCP 即扩展性        — 通过 MCP 协议实现开放式工具接入，而非内建插件系统
6. 渐进式能力扩展      — 每一层独立可用，上层是下层的增强而非必需
```

---

## 二、架构全景

```
                        ┌─ Windows  ─┐  ┌─ macOS ─┐  ┌─ Linux ─┐
                        │  Desktop   │  │ Desktop  │  │ Desktop │
                        └─────┬──────┘  └────┬─────┘  └────┬────┘
                              │              │             │
                              ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Layer 4: Platform Shell (各 app)                     │
│                                                                         │
│  apps/desktop/                          apps/mobile/                     │
│  ├── src/           (React UI)          ├── src/           (React UI)   │
│  │   ├── pages/     (Sidebar 布局)      │   ├── pages/     (Tab 布局)   │
│  │   ├── components/(Sidebar.tsx)        │   ├── components/(BottomNav)  │
│  │   └── ipc.ts     (桌面端 IPC 封装)    │   └── ipc.ts     (移动端 IPC) │
│  └── src-tauri/src/ (平台 Tauri cmd)    └── src-tauri/src/ (平台 cmd)   │
│      ├── lib.rs     (命令注册+托盘)          ├── lib.rs     (命令注册)    │
│      ├── platform.rs                         └── mobile_connectors.rs    │
│      ├── node.rs, pm2.rs, deploy.rs                                     │
│      ├── security.rs, bots.rs, pairing.rs                               │
│      ├── chat_proxy.rs, ollama.rs, rag.rs                               │
│      └── connectors.rs (Feishu)                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                    Layer 3: Shared Frontend (packages/)                  │
│                                                                         │
│  @clawno/shared                                                         │
│  ├── stores/        (全部 Zustand store，平台用扩展模式)                  │
│  ├── chat/          (useChatEngine hook + helpers)                       │
│  ├── ipc/           (共享 IPC 类型定义)                                   │
│  └── hooks/         (共享 React hooks)                                   │
│                                                                         │
│  @clawno/openclaw-client    (HTTP/WebSocket API 客户端)                  │
│  @clawno/deploy-engine      (部署引擎，仅 desktop 使用)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                    Layer 2: Rust Core (crates/)                          │
│                                                                         │
│  clawno-core                                                            │
│  ├── chat.rs          SSE 流式聊天核心 (组合模式: consume_sse_stream)     │
│  ├── secure_store.rs  安全 KV 存储 (AES-256-GCM + define_secure_store_commands! macro) │
│  ├── token_log.rs     SQLite 迁移 (v1-v8+)                              │
│  ├── types.rs         所有共享类型定义                                    │
│  ├── mcp.rs           ★ MCP 扫描 + 插件管理 + 工具协议核心               │
│  ├── ssh.rs           SSH 连接/TOFU/ssh_exec + 部署脚本 (feature: ssh-exec) │
│  ├── rag.rs           RAG 文件验证与读取                                  │
│  └── sentinel/        ★ 自愈引擎 (崩溃捕获 + 诊断 + 进化库)             │
├─────────────────────────────────────────────────────────────────────────┤
│                    Layer 1: Foundation (编译器 + 运行时保证)              │
│                                                                         │
│  Cargo workspace      统一依赖版本，编译期类型检查                        │
│  Tauri 2 runtime      进程隔离 (Rust ↔ WebView ↔ OpenClaw)              │
│  SQLite               本地持久化 (无网络依赖)                             │
│  Tailscale mesh       设备间加密直连 (NAT 穿透)                          │
└─────────────────────────────────────────────────────────────────────────┘
                              │              │             │
                              ▼              ▼             ▼
                        ┌─ Android ─┐  ┌── iOS ──┐  ┌─ (未来) ─┐
                        │  Mobile   │  │  Mobile  │  │ HarmonyOS│
                        └───────────┘  └──────────┘  └──────────┘
```

---

## 三、技术栈清单

| 层级 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| **语言** | Rust | edition 2021, ≥1.77.2 | 编译型，内存安全，运行时不可篡改 |
| **语言** | TypeScript | ≥5.7 (当前 5.9.3) | 严格类型检查，跨前端共享 |
| **框架** | Tauri 2 | 2.10.x | 跨平台桌面+移动，原生性能，进程隔离 |
| **前端** | React 19 | 19.2.x | 并发特性，生态成熟 |
| **构建** | Vite 6 | 6.4.x | 极速 HMR，ESM 原生支持 |
| **状态** | Zustand 5 | 5.0.x | 轻量，支持 store 组合/扩展 |
| **样式** | Tailwind CSS 3 | 3.4.x | 原子化 CSS，零运行时开销 |
| **路由** | React Router 7 | 7.13.x | 类型安全路由 |
| **数据库** | SQLite (tauri-plugin-sql) | 2.3.x | 本地持久化，无服务器依赖 |
| **加密** | tauri-plugin-store | 2.4.x | OS 级安全存储 |
| **HTTP** | reqwest 0.12 | 0.12.28 | Rust 异步 HTTP，支持 stream |
| **SSH** | russh 0.44 | 0.44.1 | 纯 Rust SSH，无 OpenSSL 依赖 |
| **Monorepo** | pnpm workspace + Turborepo | pnpm 10.x, turbo 2.x | 并行构建，依赖共享 |
| **网络** | Tailscale | 外部集成 | WireGuard mesh，NAT 穿透 |
| **进程管理** | pm2 | 外部集成 | OpenClaw 进程生命周期 |
| **i18n** | i18next + react-i18next | 25.x / 16.x | 中英双语 |

---

## 四、目录结构（目标状态）

```
clawno11/
│
├── Cargo.toml                        # Rust workspace 根
│
├── crates/
│   └── clawno-core/                  # 共享 Rust crate
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                # 模块导出 + feature gate
│           ├── types.rs              # 全平台共享类型
│           ├── chat.rs               # SSE 流式核心 + ChatBackend trait
│           ├── secure_store.rs       # 加密 KV (5 个命令的核心实现)
│           ├── token_log.rs          # SQLite 迁移 v1-v8+
│           ├── mcp.rs               # MCP 扫描核心
│           ├── ssh.rs               # SSH 连接/执行核心
│           ├── gateway.rs           # HTTP 探测 / 健康检查
│           ├── connectors.rs        # Tailscale 状态
│           └── sentinel/            # ★ 自愈引擎
│               ├── mod.rs
│               ├── capture.rs       # 崩溃上下文捕获
│               ├── diagnosis.rs     # 诊断 prompt 构造
│               ├── evolution.rs     # 进化库 CRUD
│               └── remedy.rs        # 修复执行 (配置备份+回滚)
│
├── apps/
│   ├── desktop/
│   │   ├── package.json
│   │   ├── tsconfig.json             # extends ../../tsconfig.base.json
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── ipc.ts               # 桌面端特有 IPC 封装
│   │   │   ├── pages/
│   │   │   │   ├── ChatPage.tsx      # UI 壳，调用 useChatEngine
│   │   │   │   ├── InstancesPage.tsx
│   │   │   │   ├── DeployPage.tsx
│   │   │   │   ├── SecurityPage.tsx
│   │   │   │   ├── TokenPage.tsx
│   │   │   │   ├── ConnectorsPage.tsx    # desktop 独有
│   │   │   │   ├── LocalModelPage.tsx    # desktop 独有
│   │   │   │   ├── RagPage.tsx
│   │   │   │   ├── McpPage.tsx
│   │   │   │   ├── RouterPage.tsx
│   │   │   │   └── SettingsPage.tsx
│   │   │   ├── components/
│   │   │   │   └── Sidebar.tsx
│   │   │   ├── store/                # 仅放平台扩展，核心在 @clawno/shared
│   │   │   │   └── desktopExtensions.ts
│   │   │   └── locales/
│   │   └── src-tauri/
│   │       ├── Cargo.toml            # depends on clawno-core { features=["desktop"] }
│   │       ├── tauri.conf.json
│   │       └── src/
│   │           ├── lib.rs            # Tauri cmd 注册 + 托盘 + chat_proxy 启动
│   │           ├── main.rs
│   │           ├── platform.rs       # 跨 OS shell/路径
│   │           ├── node.rs           # Node.js / openclaw CLI
│   │           ├── pm2.rs            # pm2 进程管理
│   │           ├── deploy.rs         # 部署编排
│   │           ├── gateway.rs        # 本地网关启动 (调用 clawno_core::gateway)
│   │           ├── ssh_deploy.rs     # 桌面 SSH 部署 (调用 clawno_core::ssh)
│   │           ├── security.rs       # 安全扫描/防火墙
│   │           ├── connectors.rs     # Feishu + Tailscale (调用 core::connectors)
│   │           ├── bots.rs           # Telegram / Discord
│   │           ├── pairing.rs        # QR 配对
│   │           ├── chat.rs           # 桌面 stream_chat (调用 core::chat)
│   │           ├── chat_proxy.rs     # LAN REST 代理
│   │           ├── rag.rs            # RAG 文件读取
│   │           └── ollama.rs         # Ollama 管理
│   │
│   ├── mobile/
│   │   ├── package.json
│   │   ├── tsconfig.json             # extends ../../tsconfig.base.json
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── ipc.ts               # 移动端特有 IPC 封装
│   │   │   ├── pages/
│   │   │   │   ├── ChatPage.tsx      # UI 壳，调用 useChatEngine
│   │   │   │   ├── ConnectPage.tsx       # mobile 独有
│   │   │   │   ├── MorePage.tsx          # mobile 独有
│   │   │   │   ├── InstancesPage.tsx
│   │   │   │   ├── DeployPage.tsx
│   │   │   │   ├── SecurityPage.tsx
│   │   │   │   ├── TokenPage.tsx
│   │   │   │   ├── RagPage.tsx
│   │   │   │   ├── McpPage.tsx
│   │   │   │   ├── RouterPage.tsx
│   │   │   │   └── SettingsPage.tsx
│   │   │   ├── components/
│   │   │   │   ├── BottomNav.tsx
│   │   │   │   └── TopBar.tsx
│   │   │   ├── store/
│   │   │   │   └── mobileExtensions.ts
│   │   │   └── locales/
│   │   └── src-tauri/
│   │       ├── Cargo.toml            # depends on clawno-core { features=["mobile"] }
│   │       ├── tauri.conf.json
│   │       └── src/
│   │           ├── lib.rs            # Tauri cmd 注册
│   │           ├── main.rs
│   │           ├── chat.rs           # 移动 stream_chat (调用 core::chat)
│   │           ├── gateway.rs        # 远程探测 (调用 core::gateway)
│   │           ├── connectors.rs     # UDP 探测 + proxy token
│   │           ├── ssh_deploy.rs     # 移动 SSH (调用 core::ssh)
│   │           └── mcp.rs           # 扫描 (调用 core::mcp)
│   │
│   └── web/                          # 官网 (独立，不依赖 workspace 包)
│       └── ...
│
├── packages/
│   ├── shared/                       # @clawno/shared
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── stores/               # 全部 Zustand store
│   │       │   ├── db.ts
│   │       │   ├── utils.ts
│   │       │   ├── instances.ts      # base store (平台扩展字段)
│   │       │   ├── aiConfig.ts
│   │       │   ├── chatHistory.ts
│   │       │   ├── tokenLog.ts
│   │       │   ├── tokenBudget.ts
│   │       │   ├── tokenPricing.ts
│   │       │   ├── tokenAnomalyStore.ts
│   │       │   ├── ragStore.ts
│   │       │   ├── mcpStore.ts
│   │       │   ├── modelRouter.ts
│   │       │   ├── piiFilter.ts
│   │       │   ├── promptLibrary.ts
│   │       │   ├── secureStore.ts
│   │       │   └── securityEventStore.ts
│   │       ├── chat/                 # ChatPage 共享逻辑
│   │       │   ├── types.ts          # ChatMessage, ChatSession, Provider 等
│   │       │   ├── helpers.ts        # 纯函数 (见下文详述)
│   │       │   └── useChatEngine.ts  # 核心 hook (SSE + 状态管理)
│   │       ├── ipc/
│   │       │   └── types.ts          # 共享 IPC 类型定义
│   │       └── hooks/
│   │           ├── useEvolutionDB.ts  # 进化库查询 hook
│   │           └── useSentinel.ts     # 自愈状态 hook
│   │
│   ├── openclaw-client/              # @clawno/openclaw-client
│   │   └── src/
│   │       ├── client.ts
│   │       ├── websocket.ts
│   │       └── types.ts
│   │
│   └── deploy-engine/                # @clawno/deploy-engine (仅 desktop)
│       └── src/
│           ├── local-deployer.ts
│           └── remote-deployer.ts
│
├── tsconfig.base.json                # 共享 TS 配置
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── docs/
├── scripts/
└── .github/workflows/
```

---

## 五、Rust 层详细设计

### 5.1 Cargo Workspace（含 Tauri 兼容性处理）

**⚠️ 风险缓解：** Tauri 2 CLI 在 Cargo workspace 模式下有已知的兼容性问题，需要在 Phase 0 优先验证。

```
已知问题与解决方案:

1. target 目录冲突
   问题: workspace 统一 target/ 在根目录，但 tauri dev 可能在 src-tauri/ 下找
   解决: 在各 app 的 src-tauri/.cargo/config.toml 中不设置 target-dir，
        让 Cargo workspace 统一管理

2. Cargo.lock 合并
   问题: 当前 desktop 和 mobile 各有独立的 Cargo.lock
   解决: workspace 模式下只保留根目录一个 Cargo.lock，
        首次合并时需要手动解决版本冲突

3. iOS 构建 workspace 解析
   问题: tauri ios build 可能无法正确解析 workspace 中的 path 依赖
   解决: 在 .github/workflows/ios-build.yml 中显式设置
        CARGO_BUILD_TARGET_DIR 环境变量

4. tauri dev 的 cwd 问题
   问题: tauri dev 需要在 src-tauri/ 目录下运行
   解决: 在各 app 的 package.json 中配置:
        "tauri": "cd src-tauri && cargo tauri"
        或使用 tauri.conf.json 的 build.beforeDevCommand 指定

Phase 0 验证步骤:
  □ 在单独的测试仓库中创建 Tauri workspace 原型
  □ 验证 tauri dev 在 workspace 模式下正常启动 (desktop)
  □ 验证 tauri android dev 正常启动 (mobile)
  □ 验证 tauri ios build 正常编译
  □ 验证 clawno-core path 依赖在所有平台可解析
  □ 确认无误后再迁移到主仓库
```

根目录 `Cargo.toml`:

```toml
[workspace]
members = [
    "crates/clawno-core",
    "apps/desktop/src-tauri",
    "apps/mobile/src-tauri",
]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
futures-util = "0.3"
russh = "0.44"
russh-keys = "0.44"
async-trait = "0.1"
dirs-next = "2"
tauri = "2"
tauri-plugin-store = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-http = "2"
```

### 5.2 clawno-core Cargo.toml

```toml
[package]
name = "clawno-core"
version = "0.1.0"
edition = "2021"
rust-version = "1.77.2"

[features]
default = []
desktop = ["reqwest/native-tls"]
mobile = ["reqwest/rustls-tls"]

[dependencies]
serde.workspace = true
serde_json.workspace = true
tokio.workspace = true
reqwest = { workspace = true, default-features = false }
futures-util.workspace = true
russh.workspace = true
russh-keys.workspace = true
async-trait.workspace = true
dirs-next.workspace = true
```

### 5.3 clawno-core 模块设计

#### types.rs — 全平台共享类型

```rust
// 两端共享
pub struct ChatChunk { pub req_id: String, pub delta: String }
pub struct ChatDone  { pub req_id: String, pub error: Option<String>, pub model: Option<String> }
pub struct TailscaleStatus { pub installed: bool, pub running: bool, pub ip: Option<String>, pub version: Option<String> }
pub struct ProbeResult { pub online: bool, pub latency_ms: u64 }
pub struct McpScanResult { pub risk_level: String, pub factors: Vec<String>, pub reachable: bool }
pub struct PatchRecord { ... }  // 进化库记录

// 仅 desktop 编译
#[cfg(feature = "desktop")]
pub struct StepResult { pub ok: bool, pub detail: String, pub fixes_applied: Vec<String> }
#[cfg(feature = "desktop")]
pub struct ServiceInfo { ... }
#[cfg(feature = "desktop")]
pub struct DeployStatus { ... }
```

#### chat.rs — 组合模式 + 共享解析（避免 trait 抽象泄漏）

**设计决策：** 不使用宽泛的 `ChatBackend` trait，而是将共享逻辑拆分为独立的可组合函数。

原因：Desktop 和 Mobile 的差异不在参数层面，而在**策略层面**（Desktop 有三级 fallback，Mobile 有 proxy 中转）。如果用一个 trait 抽象，会出现方法签名越来越复杂、每个实现都有一半参数传 None 的情况。

```rust
// ========== clawno-core/chat.rs ==========

// --- 共享类型 ---
pub enum SseEvent {
    Delta { content: String },
    ToolCall { id: String, name: String, arguments: String },
    ToolResult { call_id: String, result: String },
    Model(String),
    Done,
    Error(String),
}

// --- 共享的 SSE 解析 (两端直接调用) ---
pub fn parse_sse_line(line: &str) -> Option<SseEvent> { ... }
pub fn is_tools_error(text: &str) -> bool { ... }
pub fn extract_model_from_tools_error(text: &str) -> Option<String> { ... }

// --- 共享的 HTTP SSE 请求 (可组合的独立函数) ---
pub async fn stream_http_sse(
    client: &reqwest::Client,
    url: &str,
    messages: &Value,
    model: Option<&str>,
    auth_token: Option<&str>,
) -> Result<impl Stream<Item = Result<SseEvent>>> { ... }

// --- 共享的 Ollama 直连 SSE (可组合的独立函数) ---
pub async fn stream_ollama_sse(
    client: &reqwest::Client,
    ollama_url: &str,
    messages: &Value,
    model: &str,
) -> Result<impl Stream<Item = Result<SseEvent>>> { ... }

// --- 共享的事件发射器 (Tauri event 封装) ---
pub fn emit_sse_events(
    app: &tauri::AppHandle,
    req_id: &str,
    event: SseEvent,
) { ... }
```

```rust
// ========== apps/desktop/src-tauri/src/chat.rs ==========
// 策略: HTTP SSE → CLI fallback → Ollama 直连 (组合模式)

use clawno_core::chat::*;

#[tauri::command]
pub async fn stream_chat(app: AppHandle, gateway_url: String,
    messages: Value, req_id: String, model: Option<String>,
) -> Result<(), String> {
    // 策略 1: HTTP SSE
    match stream_http_sse(&client, &gateway_url, &messages, model.as_deref(), None).await {
        Ok(stream) => return process_stream(app, stream, &req_id).await,
        Err(_) => {}  // fallback
    }
    // 策略 2: CLI
    match run_openclaw_agent(&messages).await {  // desktop 独有
        Ok(reply) => return emit_reply(app, &req_id, reply),
        Err(_) => {}  // fallback
    }
    // 策略 3: Ollama 直连
    if let Some(model) = discover_ollama_model().await {  // desktop 独有
        let stream = stream_ollama_sse(&client, "http://127.0.0.1:11434", &messages, &model).await?;
        return process_stream(app, stream, &req_id).await;
    }
    Err("所有聊天后端均不可用".into())
}
```

```rust
// ========== apps/mobile/src-tauri/src/chat.rs ==========
// 策略: HTTP SSE → 通过 proxy 的 Ollama 直连 (组合模式)

use clawno_core::chat::*;

#[tauri::command]
pub async fn stream_chat(app: AppHandle, gateway_url: String,
    messages: Vec<Value>, req_id: String, model: Option<String>,
    auth_token: Option<String>,  // mobile 独有
) -> Result<(), String> {
    let msgs = Value::Array(messages);
    // 策略 1: HTTP SSE (带 auth_token)
    match stream_http_sse(&client, &gateway_url, &msgs, model.as_deref(), auth_token.as_deref()).await {
        Ok(stream) => return process_stream(app, stream, &req_id).await,
        Err(e) if is_tools_error(&e.to_string()) => {}  // fallback to Ollama
        Err(e) => return Err(e.to_string()),
    }
    // 策略 2: 通过桌面端 proxy 直连 Ollama (mobile 独有)
    let proxy_url = gateway_url.replace("/v1/chat/completions", "/ollama-direct");
    let stream = stream_http_sse(&client, &proxy_url, &msgs, model.as_deref(), auth_token.as_deref()).await?;
    process_stream(app, stream, &req_id).await
}
```

**关键优势：**
- `stream_http_sse` 和 `stream_ollama_sse` 是共享的纯函数，不包含策略逻辑
- 各 app 的 `chat.rs` 用自己的 fallback 策略组合这些函数
- 没有 trait，没有泛型，没有被迫传 None 的参数
- `parse_sse_line` 和 `emit_sse_events` 共享，SSE 解析逻辑只写一次
- Desktop 独有的 `run_openclaw_agent` 和 `discover_ollama_model` 留在 desktop
- Mobile 独有的 `auth_token` 参数直接传给共享函数，不影响接口设计

#### sentinel/ — 自愈引擎

```
sentinel/
├── mod.rs          — 公开 API
├── capture.rs      — 崩溃上下文捕获
│   fn capture_crash_context(stderr: &str, config: &Value) -> DiagnosisRequest
│   fn compute_bug_signature(stderr: &str) -> String  // 前3行哈希
│
├── diagnosis.rs    — 诊断 prompt 构造
│   fn build_diagnosis_prompt(ctx: &DiagnosisRequest, history: &[PatchRecord]) -> String
│   fn parse_diagnosis_response(llm_output: &str) -> DiagnosisResult
│
├── evolution.rs    — 进化库 CRUD
│   async fn store_patch(db: &Pool, patch: &PatchRecord) -> Result<()>
│   async fn lookup_by_signature(db: &Pool, sig: &str) -> Vec<PatchRecord>
│   async fn increment_success(db: &Pool, patch_id: &str) -> Result<()>
│   async fn increment_failure(db: &Pool, patch_id: &str) -> Result<()>
│   async fn get_high_confidence_patches(db: &Pool, min_score: f64) -> Vec<PatchRecord>
│
└── remedy.rs       — 修复执行
    async fn backup_config(path: &Path) -> Result<PathBuf>  // 返回备份路径
    async fn apply_config_patch(path: &Path, patch: &Value) -> Result<()>
    async fn rollback_config(path: &Path, backup: &Path) -> Result<()>
    async fn execute_command_sequence(commands: &[String]) -> Result<Vec<CommandResult>>
```

### 5.4 进化库 Schema (SQLite 迁移 v8)

```sql
-- v8: 进化库
CREATE TABLE IF NOT EXISTS evolution_patches (
    id              TEXT PRIMARY KEY,
    bug_signature   TEXT NOT NULL,
    target          TEXT NOT NULL CHECK(target IN ('openclaw-config','openclaw-runtime','clawno-store')),
    platform        TEXT,
    openclaw_ver    TEXT,
    diagnosis       TEXT,
    remedy_type     TEXT NOT NULL CHECK(remedy_type IN ('config-patch','command-sequence','store-patch')),
    remedy_payload  TEXT NOT NULL,
    local_test      TEXT DEFAULT 'skipped' CHECK(local_test IN ('pass','fail','skipped')),
    success_count   INTEGER DEFAULT 0,
    attempt_count   INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at      TEXT
);

CREATE INDEX idx_evo_signature ON evolution_patches(bug_signature);
CREATE INDEX idx_evo_target ON evolution_patches(target);

-- v8: 配置快照 (用于回滚)
CREATE TABLE IF NOT EXISTS config_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL,
    content         TEXT NOT NULL,
    patch_id        TEXT REFERENCES evolution_patches(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 六、前端层详细设计

### 6.1 Store 统一策略

**原则：** 所有 store 核心逻辑放 `@clawno/shared`，平台差异用 Zustand 扩展模式。

```typescript
// packages/shared/src/stores/instances.ts
// 基础 store — 所有平台共享
export const createInstancesStore = () => create<InstancesState>((set, get) => ({
    instances: [],
    activeId: null,
    addInstance: (inst) => set(...),
    removeInstance: (id) => set(...),
    ...
}));

// apps/mobile/src/store/mobileExtensions.ts
// 移动端扩展 — 添加 chatProxyToken 等
import { createInstancesStore } from "@clawno/shared/stores/instances";

export const useInstances = createInstancesStore();
// 通过 zustand subscribeWithSelector 扩展 chatProxyToken 逻辑
```

### 6.2 ChatPage 拆分方案（三层可测试架构）

**设计决策：** 为了解决 useChatEngine 的测试难题（Tauri IPC 在测试环境中不可用），采用**三层分离**：纯函数层 → 状态机层 → 副作用层。

```
@clawno/shared/src/chat/
│
├── types.ts                    ← 类型定义 (零依赖)
│   export interface ChatMessage {
│     role: "user" | "assistant" | "system" | "tool"
│     content: string
│     status?: "pending" | "streaming" | "sent" | "queued" | "failed"
│     tool_calls?: ToolCall[]
│     tokens?: number
│     timestamp: number
│   }
│   export interface ChatSession { id, title, messages, model, createdAt }
│   export interface ProviderModel { provider, model, label }
│   export interface AgentStep { type, tool_name?, summary, collapsed }
│   export interface ChatEngineConfig {
│       streamChat: (params) => Promise<void>     // 平台注入的 IPC 调用
│       modelList: ProviderModel[]                 // 平台注入的模型列表
│       onChunk: (chunk) => void
│       onToolCall: (call) => void
│       onDone: (result) => void
│       onError: (error) => void
│   }
│
├── helpers.ts                  ← 第 1 层: 纯函数 (100% vitest 可测)
│   // 无任何外部依赖，输入 → 输出，易于测试
│   export function extractShellCommands(text: string): string[]
│   export function detectInjection(text: string): InjectionResult
│   export function humaniseError(code: string, raw: string): string
│   export function estimateTokens(text: string): number
│   export function trimToContextWindow(messages, maxTokens): ChatMessage[]
│   export function pickDefault(models: ProviderModel[]): ProviderModel
│   export function formatMsgTime(date: Date): string
│   export function relativeDate(date: Date): string
│   export function buildSystemPrompt(rag?: string, prompt?: string): string
│   export function shouldAuditShell(text: string): boolean
│
├── chatReducer.ts              ← 第 2 层: 状态机 (vitest 可测，无副作用)
│   // 纯状态转换逻辑，用 useReducer 模式
│   // 测试时不需要 Tauri、不需要 DOM、不需要 Store
│
│   export type ChatState = {
│     messages: ChatMessage[]
│     steps: AgentStep[]
│     status: "idle" | "streaming" | "tool_call" | "error"
│     currentModel: string | null
│     error: string | null
│     accumulatedText: string
│   }
│
│   export type ChatAction =
│     | { type: "send", payload: { content: string, model?: string } }
│     | { type: "chunk", payload: { delta: string } }
│     | { type: "tool_call", payload: { name: string, args: string } }
│     | { type: "tool_result", payload: { result: string } }
│     | { type: "done", payload: { model?: string, error?: string } }
│     | { type: "retry" }
│     | { type: "clear" }
│     | { type: "load_history", payload: ChatMessage[] }
│
│   export function chatReducer(state: ChatState, action: ChatAction): ChatState
│   // 所有状态转换集中在这里，可以写几十个测试覆盖边界情况
│
└── useChatEngine.ts            ← 第 3 层: 副作用胶水 (薄层，不需要单测)
    // 仅做三件事:
    // 1. 把 Tauri 事件 (chat-chunk/chat-done) 转化为 ChatAction 分发给 reducer
    // 2. 在 "send" 时调用 config.streamChat (平台注入的 IPC)
    // 3. 在状态变化时写入 Store (chatHistory, tokenLog, securityEvent)
    //
    // 这一层约 50-80 行，几乎全是 useEffect + dispatch 的胶水代码

    export function useChatEngine(config: ChatEngineConfig) {
        const [state, dispatch] = useReducer(chatReducer, initialState);

        // 监听 Tauri 事件 → dispatch
        useEffect(() => {
            const unlisten = listen("chat-chunk", (e) =>
                dispatch({ type: "chunk", payload: e.payload }));
            return () => { unlisten.then(fn => fn()); };
        }, []);

        // 发送 → 调用平台 IPC
        const send = (content: string) => {
            dispatch({ type: "send", payload: { content } });
            config.streamChat({ ... });
        };

        return { ...state, send, stop, retry, clearHistory };
    }
```

```
测试策略:

  helpers.ts (纯函数):
    ✅ vitest 直接测试，100% 覆盖率
    ✅ 已有基础: __tests__/piiFilter.test.ts 等
    ✅ 不需要任何 mock

  chatReducer.ts (状态机):
    ✅ vitest 直接测试，输入 state+action → 验证新 state
    ✅ 不需要 Tauri、DOM、Store
    ✅ 覆盖所有边界: 连续 chunk、空 chunk、错误后重试、
       tool_call 中断、历史加载等

    示例测试:
    test("chunk action appends delta to accumulatedText", () => {
      const state = { ...initialState, status: "streaming", accumulatedText: "Hello" };
      const next = chatReducer(state, { type: "chunk", payload: { delta: " world" } });
      expect(next.accumulatedText).toBe("Hello world");
    });

  useChatEngine.ts (副作用胶水):
    ⚠️ 不做单元测试 (依赖 Tauri event 和 Store)
    ✅ 通过 E2E 测试或手动测试覆盖
    ✅ 因为是 50-80 行的薄层，风险可控
```

各 app 的 ChatPage 从 1000+ 行降至 ~200 行：

```typescript
// apps/desktop/src/pages/ChatPage.tsx
import { useChatEngine } from "@clawno/shared/chat/useChatEngine";
import { DESKTOP_MODELS } from "../config/models";
import { streamChat } from "../ipc";

export function ChatPage() {
    const engine = useChatEngine({
        streamChat: (p) => streamChat(p.gatewayUrl, p.messages, p.reqId, p.model),
        modelList: DESKTOP_MODELS,
        onChunk: ..., onDone: ..., onError: ..., onToolCall: ...,
    });
    // 只负责 UI 渲染: Sidebar 历史 + 消息列表 + 输入框 + 步骤卡片
}
```

### 6.3 IPC 类型统一

```typescript
// packages/shared/src/ipc/types.ts

// 两端共享的类型
export interface SecureStoreAPI {
    setSecureValue(key: string, value: string): Promise<void>;
    getSecureValue(key: string): Promise<string | null>;
    deleteSecureValue(key: string): Promise<void>;
    listSecureKeys(): Promise<string[]>;
    wipeSecureStore(): Promise<void>;
}

export interface GatewayAPI {
    probeInstanceHealth(target: string): Promise<ProbeResult>;
    getMainAgentModel(target: string): Promise<string>;
}

export interface ChatAPI {
    streamChat(params: StreamChatParams): Promise<void>;
}

export interface McpAPI {
    scanMcpServer(configPath: string): Promise<McpScanResult>;
}

// 各 app 的 ipc.ts 实现这些接口，绑定到 Tauri invoke
```

---

## 七、MCP 扩展体系

### 7.1 MCP 在架构中的定位

MCP（Model Context Protocol）是 ClawNo11 的**开放式扩展协议**。它不是一个附属功能模块，而是整个系统对外能力扩展的标准通道。

```
传统插件系统:  宿主定义 API → 插件实现 API → 宿主加载插件
MCP 模式:     LLM 定义意图 → MCP Server 提供工具 → ClawNo11 管理安全与生命周期

优势: 不需要 ClawNo11 定义插件 API，任何符合 MCP 协议的工具都可以接入
     工具能力随 MCP 生态增长而增长，ClawNo11 不需要逐个内置
```

### 7.2 MCP 三重角色

```
┌──────────────────────────────────────────────────────────────┐
│                     MCP 在 ClawNo11 中的三重角色              │
│                                                              │
│  角色 1: 工具扩展平台                                         │
│  ┌────────────────────────────────────────────────────┐      │
│  │ 用户通过 McpPage 管理 MCP Servers                   │      │
│  │ • 文件系统工具 → RAG 数据源                          │      │
│  │ • 数据库工具   → 结构化查询                          │      │
│  │ • GitHub 工具  → 代码仓库交互                        │      │
│  │ • 自定义工具   → 用户定义的任意能力                   │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  角色 2: 安全审计网关                                         │
│  ┌────────────────────────────────────────────────────┐      │
│  │ ClawNo11 对每个 MCP Server 进行安全扫描              │      │
│  │ • shell/stdio 风险检测                               │      │
│  │ • 权限范围审计                                       │      │
│  │ • 可达性验证                                         │      │
│  │ • 风险评级 (risk_level + factors)                    │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  角色 3: 自愈系统的工具通道  ★                                │
│  ┌────────────────────────────────────────────────────┐      │
│  │ Sentinel 通过 MCP 调用外部诊断/修复工具               │      │
│  │ • 代码分析 MCP → 精确定位 OpenClaw 报错代码           │      │
│  │ • 测试框架 MCP → 修复后自动冒烟测试                   │      │
│  │ • GitHub API MCP → 脱敏后一键提 Issue                │      │
│  │ • 文件系统 MCP → 读取/修改 OpenClaw 配置              │      │
│  └────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 MCP 与自愈系统的集成

自愈流程中，Sentinel 不需要内置所有诊断/修复能力，而是**通过 MCP 协议调用外部工具**：

```
  OpenClaw 崩溃
       │
       ▼
  sentinel::capture (抓取日志)
       │
       ▼
  ┌─ 有 MCP 工具可用? ─┐
  │                     │
  有                    无
  │                     │
  ▼                     ▼
  通过 MCP 调用:         纯 LLM 诊断:
  • filesystem.read     构造 prompt →
    读取相关配置         发给 LLM →
  • code-analysis       获取建议
    分析报错堆栈
  • test-runner
    修复后验证
  │                     │
  └──────┬──────────────┘
         │
         ▼
  展示诊断结果 + 修复建议
```

这意味着自愈系统的能力**随着用户接入的 MCP Server 而增强**，而不是被 ClawNo11 内置能力所限制。

### 7.4 clawno-core/mcp.rs 设计

```rust
// 共享核心: MCP 扫描 + 配置解析
pub fn scan_mcp_config(config: &Value) -> McpScanResult { ... }
pub fn parse_mcp_servers(config_path: &str) -> Vec<McpServerInfo> { ... }
pub fn evaluate_risk(server: &McpServerInfo) -> RiskAssessment { ... }

// Desktop 扩展: 插件管理 (OpenClaw 插件列表/开关)
#[cfg(feature = "desktop")]
pub fn list_openclaw_plugins(gateway_url: &str) -> Vec<PluginInfo> { ... }
#[cfg(feature = "desktop")]
pub fn toggle_openclaw_plugin(gateway_url: &str, plugin: &str, enabled: bool) -> Result<()> { ... }

// Sentinel 集成: 通过 MCP 工具增强诊断
pub fn available_diagnostic_tools(servers: &[McpServerInfo]) -> Vec<DiagnosticTool> { ... }
pub fn invoke_mcp_tool(server: &McpServerInfo, tool: &str, params: &Value) -> Result<Value> { ... }
```

### 7.5 MCP 管理前端

```
McpPage.tsx (两端共享逻辑，通过 @clawno/shared)
├── MCP Server 列表 (已接入的工具)
├── 安全扫描结果 (风险评级 + 因素)
├── 一键扫描 (重新审计所有 Server)
├── [desktop] OpenClaw 插件管理
└── [未来] MCP Server 市场 / 推荐
```

---

## 八、自愈系统设计

### 8.1 架构层级与安全边界

```
┌───────────────────────────────────────────────────┐
│            不可变区 (Immutable Zone)                │
│                                                    │
│  Rust 编译二进制 — 运行时无法被任何方式修改           │
│  包含: clawno-core, 各 app 的 src-tauri            │
│  保证方式: Rust 编译器                               │
│                                                    │
│  这一层天然免疫任何 AI 生成的补丁。                    │
│  不需要 ACL、签名校验或文件锁。                       │
├───────────────────────────────────────────────────┤
│            可配置区 (Configurable Zone)              │
│                                                    │
│  OpenClaw config.json — AI 可修改 (需用户确认)       │
│  ClawNo11 SQLite stores — AI 可修改 (需用户确认)     │
│  环境变量 / .env — AI 可修改 (需用户确认)            │
│  保证方式: 配置快照 + 一键回滚                        │
│                                                    │
│  自愈系统的主要活动区域。                              │
│  修改前自动备份，失败自动回滚。                        │
├───────────────────────────────────────────────────┤
│            托管进程区 (Managed Process Zone)         │
│                                                    │
│  OpenClaw (Node.js via pm2) — 独立进程空间           │
│  Ollama (独立服务) — 独立进程空间                     │
│  保证方式: 进程隔离 + pm2 restart                    │
│                                                    │
│  ClawNo11 对这些进程有完全的生命周期控制权，           │
│  但它们无法反向影响 ClawNo11。                        │
└───────────────────────────────────────────────────┘
```

### 8.2 自愈流程

```
  OpenClaw 崩溃
       │
       ▼
  ┌─────────────┐
  │ pm2 检测到   │
  │ 进程退出     │
  └──────┬──────┘
         │
         ▼
  ┌─────────────────┐     ┌──────────────────┐
  │ sentinel:        │     │ 进化库查询        │
  │ capture_crash    │────►│ lookup_by_sig     │
  │ 抓 stderr 50行   │     │ 有已知修复?        │
  └──────┬──────────┘     └────┬────┬────────┘
         │                     │    │
         │              有已知修复  无已知修复
         │                     │    │
         │                     ▼    ▼
         │              ┌──────┐  ┌──────────────┐
         │              │ 展示  │  │ 构造诊断     │
         │              │ 历史  │  │ prompt       │
         │              │ 方案  │  │ 发给 LLM     │
         │              └──┬───┘  └──────┬───────┘
         │                 │             │
         │                 ▼             ▼
         │           ┌─────────────────────┐
         │           │ ChatPage 展示诊断    │
         │           │ 结果和修复建议       │
         │           └─────────┬───────────┘
         │                     │
         ▼                     ▼ (用户确认)
  ┌─────────────┐     ┌─────────────────┐
  │ pm2 自动     │     │ remedy:          │
  │ restart      │     │ 1. backup_config │
  │ (总是执行)    │     │ 2. apply_patch   │
  └──────┬──────┘     │ 3. pm2 restart   │
         │            │ 4. health probe  │
         ▼            └────┬────┬───────┘
  ┌─────────────┐          │    │
  │ health      │     成功  │    │ 失败
  │ probe       │          ▼    ▼
  └──────┬──────┘   ┌──────┐ ┌──────────┐
         │          │ 存入  │ │ rollback │
    成功/失败       │ 进化库│ │ 恢复备份  │
         │          │ +1成功│ │ +1失败   │
         ▼          └──────┘ └──────────┘
  ┌─────────────┐
  │ 通知用户     │
  │ 恢复状态     │
  └─────────────┘
```

### 8.3 自愈边界硬性规则

```
                   ┌──────────────────────────────┐
    自动执行        │ • pm2 restart OpenClaw        │
    (无需确认)      │ • health endpoint 探测        │
                   │ • 进化库查询已知方案            │
                   │ • 崩溃日志捕获                 │
                   │ • logSecurityEvent 记录审计    │
                   └──────────────────────────────┘

                   ┌──────────────────────────────┐
    需要用户确认    │ • 修改 OpenClaw config.json    │
                   │ • 执行 npm install/update      │
                   │ • 应用进化库中的修复方案         │
                   │ • 修改 ClawNo11 Store 状态      │
                   └──────────────────────────────┘

                   ┌──────────────────────────────┐
    绝对禁止        │ • 修改任何 .rs / .ts / .js 源码│
                   │ • 修改 secure_store 加密数据    │
                   │ • 修改 Tauri 权限/CSP 配置      │
                   │ • 执行未经审计的 shell 命令      │
                   │ • 自动应用来自网络的补丁         │
                   │ • 修改 security.rs 的防火墙规则  │
                   │ • 修改 exec-approvals.json      │
                   └──────────────────────────────┘
```

---

## 九、跨设备同步设计

### 9.1 同步通道：Tailscale + chat_proxy

```
  Desktop                              Mobile
  ┌──────────────┐                    ┌──────────────┐
  │ chat_proxy   │◄═══Tailscale═══►  │ HTTP client  │
  │ (axum)       │   WireGuard mesh   │              │
  │              │   加密直连          │              │
  │ /api/patches │                    │ GET /patches │
  │ /api/sync    │                    │ POST /sync   │
  └──────────────┘                    └──────────────┘
```

现有的 `chat_proxy.rs` 已经是一个 axum HTTP 服务，只需扩展两个端点：

- `GET /api/patches?since={timestamp}` — 拉取新的进化库记录
- `POST /api/sync` — 推送移动端产生的修复案例

### 9.2 同步策略

```
• 拉取频率: 设备连接时立即同步，之后每 5 分钟增量拉取
• 冲突处理: 以 bug_signature 为聚合键，合并 success_count / attempt_count
• 数据量: 每条记录 ~1KB，1000 条修复案例 ≈ 1MB，完全可行
• 安全: Tailscale WireGuard 加密隧道，无需额外加密层
```

---

## 十、扩展性设计

### 10.1 新增平台的工作量评估

```
新增一个平台 (如 HarmonyOS / Linux ARM) 需要：

Rust 层:
  ├── 新建 apps/harmonyos/src-tauri/
  ├── Cargo.toml: depends on clawno-core { features = ["harmonyos"] }
  ├── lib.rs: 注册 Tauri commands (调用 clawno-core)
  └── 平台特有模块 (如有)

前端层:
  ├── 新建 apps/harmonyos/src/
  ├── pages/: 复用 useChatEngine 等 shared hooks
  ├── components/: 平台特有 UI 组件
  └── ipc.ts: 实现 shared IPC 接口

工作量: 核心功能 1-2 周 (所有业务逻辑已在 shared 中)
```

### 10.2 新增功能模块的工作量评估

```
新增功能 (如 "新的 AI Provider") 需要：

1. clawno-core: 无需修改 (ChatBackend trait 已抽象)
2. @clawno/shared:
   ├── chat/types.ts: 新增 ProviderModel 条目
   └── stores/aiConfig.ts: 新增 provider 配置
3. 各 app: 无需修改 (通过 config 驱动)

新增功能 (如 "新的 Store 模块") 需要：
1. @clawno/shared/stores/: 新增 xxxStore.ts
2. 各 app: import 并使用
3. 如需 Tauri 后端: clawno-core 新增模块，各 app lib.rs 注册 command
```

---

### 10.3 MCP 驱动的能力扩展

```
新增外部能力 (如 "接入 Notion 数据库") 需要：

1. 用户安装对应的 MCP Server (如 @notionhq/mcp-server)
2. 在 McpPage 配置连接参数
3. ClawNo11 自动安全扫描
4. LLM 通过 MCP 协议调用 Notion 工具

ClawNo11 代码改动量: 0 行
能力增长方式: 随 MCP 生态增长而增长
```

这是架构扩展性最重要的一个维度：**ClawNo11 不需要为每个外部工具写适配代码，MCP 协议已经标准化了这个过程。**

---

## 十一、实施风险与缓解策略

| # | 风险 | 严重度 | 缓解策略 | 已在 V2 中落实的位置 |
|---|------|--------|---------|---------------------|
| 1 | Tauri + Cargo workspace 兼容性 | **高** | Phase 0 先在测试仓库验证原型，确认 dev/build/iOS 均可用后再迁移 | §5.1 "含 Tauri 兼容性处理" |
| 2 | ChatBackend trait 抽象泄漏 | **高** | 放弃 trait，改用**组合模式**：共享独立函数，各 app 用自己的策略组合 | §5.3 chat.rs "组合模式" |
| 3 | useChatEngine 不可测试 | **中** | 拆为三层：纯函数 (vitest) + 状态机 reducer (vitest) + 副作用胶水 (薄层免测) | §6.2 "三层可测试架构" |
| 4 | secure_store 明文存储 (SS-1) | **高** | Phase 0 优先升级为 AES-GCM 加密 | §13.1, Phase 0 路线图 |
| 5 | 进化库补丁质量衰减 | **中** | 版本关联 + 90 天半衰期 + 自动归档清理 | §14.3 |
| 6 | 多实例 sentinel 混淆 | **中** | instance_id 隔离 + 分层匹配权重 | §14.4 |

---

## 十二、数据流全景

```
用户操作 (点击/输入)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ React UI (ChatPage / SettingsPage / ...)                │
│    │                                                    │
│    ▼                                                    │
│ useChatEngine / useStore (@ clawno/shared)              │
│    │                                                    │
│    ▼                                                    │
│ ipc.ts → invoke("stream_chat", {...})                   │
└────────────────────┬────────────────────────────────────┘
                     │ Tauri IPC (JSON-RPC over WebView bridge)
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Tauri Command Layer (各 app 的 chat.rs)                  │
│    │                                                    │
│    ▼                                                    │
│ clawno_core::chat::stream_http_sse(...)                 │
│    │                                                    │
│    ├──► reqwest → OpenClaw Gateway (HTTP SSE)           │
│    │         └──► OpenClaw → AI Provider API            │
│    │                                                    │
│    ├──► [desktop only] CLI fallback                     │
│    │                                                    │
│    └──► [desktop only] Ollama direct (localhost:11434)  │
│                                                    │
│ sentinel::capture (如果出错)                             │
│    │                                                    │
│    ▼                                                    │
│ SQLite (token_records + evolution_patches)               │
└─────────────────────────────────────────────────────────┘
                     │ Tauri event emit
                     ▼
┌─────────────────────────────────────────────────────────┐
│ React UI                                                │
│    │                                                    │
│    ▼                                                    │
│ 渲染消息流 / 显示诊断结果 / 更新 Store                    │
└─────────────────────────────────────────────────────────┘
```

---

## 十三、迁移路线图

### Phase 0: 基础设施 (1-2 周)

```
□ 创建根 Cargo.toml workspace
□ 创建 crates/clawno-core/ 骨架
□ 将 secure_store.rs 抽入 core (两端完全相同，最低风险)
□ ⚠️ 修复 SS-1: secure_store 升级为 AES-GCM 加密 (当前是明文 JSON)
□ 将 token_log.rs 抽入 core (迁移逻辑相同)
□ 将 types.rs 抽入 core (合并两端类型，#[cfg] 区分)
□ 两端 Cargo.toml 改为依赖 clawno-core
□ 验证: 两端编译通过 + 现有功能不变
```

### Phase 1: 核心共享 (2-3 周)

```
□ chat.rs: 定义 ChatBackend trait，抽出 SSE 解析到 core
□ gateway.rs: 抽出 probe_instance_health / get_main_agent_model 到 core
□ mcp.rs: 抽出扫描核心逻辑到 core
□ connectors.rs: 抽出 Tailscale 状态查询到 core
□ ssh.rs: 抽出 SSH 连接核心到 core
□ 前端: 将 7 个独立 store 移入 @clawno/shared
□ 前端: mobile tsconfig.json 改为继承 tsconfig.base.json
□ 验证: 全平台编译 + 功能回归测试
```

### Phase 2: 前端统一 + 自愈 (2-3 周)

```
□ 创建 @clawno/shared/chat/helpers.ts (提取纯函数)
□ 创建 @clawno/shared/chat/useChatEngine.ts
□ 重写两端 ChatPage.tsx 为 UI 壳
□ 创建 @clawno/shared/ipc/types.ts
□ 创建 clawno-core/sentinel/ 模块骨架
□ 添加 SQLite 迁移 v8 (evolution_patches + config_snapshots)
□ 实现 sentinel::capture + sentinel::evolution CRUD
□ 验证: ChatPage 功能完整 + 进化库可读写
```

### Phase 3: 自愈闭环 (1-2 周)

```
□ 实现 sentinel::diagnosis (prompt 构造 + LLM 调用)
□ 实现 sentinel::remedy (配置备份 + 修改 + 回滚)
□ 前端: ChatPage/SettingsPage 增加"诊断结果"UI
□ 前端: 创建 useSentinel hook
□ 集成: pm2 crash → capture → diagnosis → 展示
□ 验证: 模拟 OpenClaw 崩溃 → 自动诊断 → 展示修复建议
```

### Phase 4: 跨设备同步 (1 周)

```
□ chat_proxy.rs 扩展 /api/patches 和 /api/sync 端点
□ mobile 实现进化库拉取/推送
□ 验证: desktop 产生的修复案例能同步到 mobile
```

### Phase 5: 优化 (持续)

```
□ 脱敏 + 一键 GitHub Issue
□ 进化库统计/可视化 (SettingsPage 新 tab)
□ 单机置信度评分自动降权低质量补丁
□ CI: 添加跨平台编译检查 (确保 core 在 desktop/mobile 都能编译)
```

---

## 十四、系统能力全景 (Capabilities Registry)

> 基于全量代码扫描，Desktop 共 72 个 Tauri 命令，Mobile 共 14 个。

### 13.1 安全体系 (security.rs — 18 个命令，~1133 行)

这是系统最大的单体模块，提供多层纵深防御：

```
┌─────────────────────────────────────────────────────────────┐
│                    安全能力全景                               │
│                                                             │
│  ┌─ 安全评估 ─────────────────────────────────────────┐     │
│  │ scan_security_status → SecurityReport (0-100 分)    │     │
│  │ 检查项: 网络访问模式、IM 连接器暴露、端口暴露、       │     │
│  │        Node 版本、pm2 状态、离线模式                  │     │
│  │ 加权评分算法: calculate_score()                      │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 网络访问控制 ──────────────────────────────────────┐    │
│  │ get/set_network_access_mode (off/local/subnet/tailscale)│ │
│  │ apply/remove_local_only_firewall (Windows 防火墙规则)   │ │
│  │ check_firewall_active                                   │ │
│  │ get_port_connections (TCP/UDP 连接列表)                  │ │
│  │ scan_lan_devices (ARP 表扫描)                           │ │
│  │ get_local_lan_info (本机 IP/子网)                       │ │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ IP 白名单 ─────────────────────────────────────────┐   │
│  │ get/add/remove_allowed_ip                             │   │
│  │ 自动创建/删除 Windows 防火墙 allow 规则                │   │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 工具执行权限 ──────────────────────────────────────┐    │
│  │ get_tool_permissions → exec_mode + allowlist           │   │
│  │ set_exec_mode (deny / ask / allow)                    │   │
│  │ add/remove_exec_allowlist_entry (glob 模式)            │   │
│  │ 控制 OpenClaw 的 shell 执行能力                       │   │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 紧急响应 ──────────────────────────────────────────┐   │
│  │ kill_switch_offline: 防火墙阻断 + pm2 停止 OpenClaw   │   │
│  │ kill_switch_restore: 移除防火墙 + 重启 OpenClaw       │   │
│  │ wipe_secure_store: 清除所有敏感数据 (Panic Button)    │   │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ PII 过滤 (piiFilter.ts) ──────────────────────────┐   │
│  │ 检测 6 类 PII: API Key (sk-/Bearer/AKIA/AIza/ghp_)  │   │
│  │ 手机号、身份证、邮箱、信用卡、内网 IP                  │   │
│  │ detectPii() / redactPii() 本地处理，不上传            │   │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 注入检测 (ChatPage) ─────────────────────────────┐     │
│  │ detectInjection(): 提示注入风险检测                   │   │
│  │ extractShellCommands(): AI 响应中 shell 命令审计      │   │
│  │ 审计记录写入 security_events 表                       │   │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 安全事件审计 (securityEventStore) ─────────────────┐   │
│  │ logSecurityEvent(type, detail, severity)               │   │
│  │ 严重级别: info / warn / danger                        │   │
│  │ SQLite 持久化，前端可查看/清空                         │   │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

**⚠️ 已知问题 (SS-1)：** `secure_store.rs` 使用 `tauri-plugin-store`，当前存储的 `clawno_secure.bin` 是**明文 JSON**，不是真正的加密存储。计划使用设备派生的 AES-GCM 密钥加密。在 V2 架构中需要优先解决这个问题。

### 13.2 IM 机器人系统 (bots.rs — 12 个命令)

| 机器人 | 能力 |
|--------|------|
| **Telegram** | 验证 Token → 保存 → 启动轮询 → 停止 → 状态查询。转发用户消息到 OpenClaw 网关，返回 AI 响应。 |
| **Discord** | 验证 Token → 保存 → 启动 Gateway → 停止 → 状态查询。通过 Discord Gateway WebSocket 监听消息并回复。 |

管理器：`BotManager` 结构体，维护各 Bot 的停止标志（`AtomicBool`）。

### 13.3 设备配对系统 (pairing.rs — 4 个命令)

```
配对流程:
1. Desktop: generate_pair_qr(port) → 生成 20 字节随机 token
2. Token → Base64url 编码 → 前 6 字节推导 6 位 PIN (无歧义字符)
3. QR 内容: clawno11://pair?h=BASE64(ip:port)&n=BASE64(name)&t=TOKEN&exp=UNIX&vp=PORT&ck=PROXY_TOKEN
4. Mobile: 扫码 → 推导 PIN → 用户确认 PIN 一致
5. Mobile: POST /pair/verify {"token":"..."} → Desktop 验证
6. Token 一次性使用，120 秒过期

安全特性:
• 密码学随机 token (rand::thread_rng)
• 120 秒 TTL，降低重放风险
• 一次性使用，防止重复配对
• IP/名称 Base64 编码，减少 QR 照片泄露
• PIN 校验，防止伪造 QR
• chat_proxy Bearer token (ck) 通过 QR 安全传递
```

### 13.4 AI Provider 管理 (node.rs + deploy.rs + aiConfig + aiVerify)

```
能力:
• 检查/安装/升级 Node.js ≥22 (自动查找可执行文件)
• npm 安装 openclaw (6 类错误分类 + 镜像/缓存/SSL 自动回退)
• API Key 配置: configure_api_key(provider, key)
• Provider 验证: aiVerify.verifyProviderKey() (直接调用各 Provider API)
• 自动模型选择: auto_select_active_model() (根据已配置 Provider 选择最优模型)
• 模型配置修复: fix_model_config() (启动时自动修复配置)
• 支持的 Provider: 智谱、OpenRouter、MiniMax、DeepSeek、OpenAI、Anthropic 等

npm 错误回退链:
  标准安装 → 换淘宝镜像 → 清除缓存 → 禁用 SSL 严格模式 → 报告具体错误类型
```

### 13.5 Ollama 本地模型管理 (ollama.rs — 7 个命令)

```
完整生命周期:
• ollama_check_status → OllamaStatus { installed, running, version }
• ollama_ensure_installed → 检测/安装 Ollama
• ollama_start_server → 启动 Ollama 服务
• ollama_list_local_models → Vec<OllamaModel> { name, size, modified_at }
• ollama_pull_model → 拉取模型 (通过 Tauri event 推送进度)
• ollama_delete_model → 删除模型
• set_ollama_model → 将模型加入 OpenClaw fallback 链
```

### 13.6 Token 经济系统 (tokenLog + tokenBudget + tokenPricing + tokenAnomaly)

```
四层体系:
1. 记录层: recordTokenUsage() → SQLite token_records 表
2. 预算层: 全局预算 + 按实例预算，预算进度 (budgetLevel)
3. 定价层: 自定义价格覆盖、货币选择 (CNY/USD/EUR/...)、汇率设置
4. 异常层: 异常检测 → 红点告警 → 联动紧急断网 (kill_switch)

前端:
• 24 小时用量柱状图
• 按实例/模型/输入输出 分类统计
• 成本估算 (含汇率换算)
• 异常告警 + 一键紧急断网
```

### 13.7 连接器 (connectors.rs)

| 连接器 | Desktop | Mobile |
|--------|---------|--------|
| **Feishu (飞书)** | 测试连接、保存/读取配置、scope 检查 | — |
| **Tailscale** | 子进程调用 `tailscale` 命令 | UDP 探测 CGNAT IP (100.100.100.100) |
| **xEdge** | 说明与下载链接 | 说明与下载链接 |
| **chat_proxy** | 启动 LAN REST 代理 (axum, 端口 18800, Bearer 认证) | fetch token + 调用 proxy |

Desktop `connectors.rs` 还定义了 `Connector` trait（test/save/status），为未来新增连接器提供了扩展接口。

### 13.8 RAG 知识库 (rag.rs + ragStore)

```
Rust 层: read_text_file (扩展名白名单, Desktop 10MiB / Mobile 5MiB)
Store 层: ingestDocument → 分块 → 存入 SQLite (rag_documents + rag_chunks)
          searchChunks → 关键词搜索
          buildRagContext → 构造注入到 LLM 的上下文
前端: 导入文档、列表、删除、搜索预览
```

### 13.9 模型路由 (modelRouter)

```
规则引擎: 关键词匹配 → 路由到指定模型
支持: 优先级排序、启用/禁用、上下移动
模板: 内置规则模板 (RULE_TEMPLATES)
测试: 输入文本 → 匹配规则 → 显示结果
```

### 13.10 提示词库 (promptLibrary)

```
内置: 8 个系统提示词模板
自定义: 用户创建/编辑/删除
存储: localStorage
注入: ChatPage 中一键插入到对话
```

### 13.11 功能能力矩阵

| 功能域 | Desktop Rust 命令数 | Mobile Rust 命令数 | 前端页面 |
|--------|:------------------:|:------------------:|---------|
| 聊天 | 1 | 1 | ChatPage |
| 部署 (本地) | 8 | — | DeployPage |
| 部署 (SSH) | 5 | 2 | DeployPage |
| 网关管理 | 6 | 3 | InstancesPage |
| 安全 | 18 | — | SecurityPage |
| 加密存储 | 5 | 5 | — (内部) |
| 连接器 | 4 | 3 | ConnectorsPage / ConnectPage |
| IM 机器人 | 12 | — | ConnectorsPage |
| 配对 | 4 | — | ConnectorsPage / ConnectPage |
| MCP | 3 | 1 | McpPage |
| RAG | 1 | 1 | RagPage |
| Ollama | 7 | — | LocalModelPage |
| Token | — (前端) | — (前端) | TokenPage |
| 路由 | — (前端) | — (前端) | RouterPage |
| 设置 | — (前端) | — (前端) | SettingsPage |
| **合计** | **72** | **14** | **11 / 11** |

---

## 十五、前瞻性补充设计

> 以下四项是当前架构中识别出的前瞻性缺口，均需在重构过程中一并解决。

### 14.1 AI Agent 多步推理支持

**现状：** 当前 chat 系统是纯文本单轮流式。SSE 解析只取 `choices[0].delta.content`，不处理 `tool_calls`。CLI fallback 是单次 `-m` 调用。前端只渲染 user/assistant 文本消息，无步骤或工具调用 UI。

**问题：** OpenClaw 本身支持 agentic workflow（tool use），但 ClawNo11 把所有中间步骤丢弃了，用户看不到 AI 调用了什么工具、做了什么判断。

**优化方案：扩展 SSE 事件协议 + Agent 状态机**

```
Rust 层 (clawno-core/chat.rs):

  现有事件:
    chat-chunk  { req_id, delta }           → 文本增量
    chat-done   { req_id, error?, model? }  → 结束

  新增事件:
    chat-tool-call   { req_id, tool_name, arguments, call_id }  → AI 请求调用工具
    chat-tool-result { req_id, call_id, result }                → 工具返回结果
    chat-step        { req_id, step_type, summary }             → 中间步骤摘要

  SSE 解析扩展:
    当 delta 中存在 tool_calls 字段时:
      emit("chat-tool-call", ...)
    当收到 role=tool 的消息时:
      emit("chat-tool-result", ...)

  Agent 循环 (仅 gateway 模式, 非 Ollama 直连):
    loop {
      发送 messages → 接收 SSE 流
      if 流中包含 tool_calls → 等待 gateway 自行执行工具并继续
      if 流结束且无 tool_calls → break
    }
    注: OpenClaw gateway 内部处理工具调用循环，
    ClawNo11 只需要正确解析和转发事件即可。
```

```
前端层 (@clawno/shared/chat/):

  types.ts 扩展:
    interface ChatMessage {
      role: "user" | "assistant" | "system" | "tool"
      content: string
      tool_calls?: ToolCall[]       // assistant 消息中的工具调用
      tool_call_id?: string         // tool 消息的关联 ID
    }

    interface ToolCall {
      id: string
      function: { name: string, arguments: string }
    }

    interface AgentStep {
      type: "thinking" | "tool_call" | "tool_result" | "text"
      tool_name?: string
      summary: string
      collapsed: boolean            // 默认折叠，用户可展开
    }

  useChatEngine.ts 扩展:
    监听 chat-tool-call / chat-tool-result / chat-step 事件
    维护 steps: AgentStep[] 状态
    在 messages 中插入工具调用/结果消息

  ChatPage UI:
    工具调用步骤渲染为可折叠的卡片:
    ┌─ 🔧 调用工具: search_files ──────────────┐
    │  参数: { "query": "config.json" }          │
    │  结果: 找到 2 个文件 (点击展开)             │
    └────────────────────────────────────────────┘
```

**实施节点：** Phase 2（与 useChatEngine 提取同步进行）
**工作量：** 1-2 周（取决于 OpenClaw gateway 的 SSE 格式兼容性）
**向后兼容：** 完全兼容。不支持 tool_calls 的网关仍然只收到 chat-chunk/chat-done。

---

### 14.2 移动端离线优先策略

**现状：** 移动端网络断开时，Rust 层有一次重试（1s 延迟），失败后直接显示错误。无消息队列、无离线缓存、无重试按钮。已有的本地数据（聊天历史、Token 记录、安全事件）存在 SQLite 中，天然支持离线查看。

**问题：** 移动端弱网/无网是常态。用户发了消息但网络断了，消息直接丢失，体验很差。

**优化方案：三级离线策略**

```
Level 1: 离线可读 (零成本，现有能力)
  ✅ 聊天历史 → SQLite，已可离线查看
  ✅ Token 统计 → SQLite，已可离线查看
  ✅ 安全事件 → SQLite，已可离线查看
  ✅ 实例列表 → localStorage，已可离线查看
  ✅ 设置/预算/路由 → localStorage，已可离线查看

  需要补充:
  □ InstancesPage: 离线时隐藏"探测"按钮，显示"离线模式"标签
  □ ChatPage: 离线时禁用发送，显示"等待网络连接"

Level 2: 消息队列 + 乐观更新 (中等成本)
  @clawno/shared/hooks/useMessageQueue.ts:

  发送消息时:
    1. 立即写入 SQLite (status = "pending")
    2. 立即显示在 UI 上 (带 ⏳ 标记)
    3. 尝试发送到网关
    4. 成功 → status = "sent"，开始接收 SSE
    5. 失败 → status = "queued"，加入重试队列

  重试策略:
    • 网络恢复时自动重试队列中的消息
    • 指数退避: 2s → 4s → 8s → 16s → 最大 60s
    • 最大重试次数: 5 次
    • 超过后标记为 "failed"，显示重试按钮

  网络状态检测:
    • 监听 navigator.onLine 事件
    • 定期 ping 当前实例的 health endpoint (每 30s)
    • 状态: online / unstable / offline

Level 3: 离线本地模型 (远期，仅特定场景)
  如果用户在桌面端安装了 Ollama，移动端通过 Tailscale
  可以直连桌面端的 Ollama（已有 chat_proxy 支持）。
  桌面端离线时 Ollama 仍可工作 → 移动端通过 LAN 也可工作。
  这不是真正的"移动端离线"，但覆盖了"同一局域网内桌面不联网"的场景。
```

```
消息状态流转:

  ┌─────────┐    发送成功    ┌────────┐    SSE 完成    ┌──────────┐
  │ pending │──────────────►│  sent  │──────────────►│ complete │
  └────┬────┘               └────────┘               └──────────┘
       │ 发送失败
       ▼
  ┌─────────┐    重试成功    ┌────────┐
  │ queued  │──────────────►│  sent  │
  └────┬────┘               └────────┘
       │ 超过重试次数
       ▼
  ┌─────────┐    用户点击重试
  │ failed  │──────────────► (回到 pending)
  └─────────┘
```

**实施节点：** Level 1 在 Phase 1，Level 2 在 Phase 3
**工作量：** Level 1 约 2 天，Level 2 约 1 周

---

### 14.3 进化库衰减机制

**现状：** 提案中的 `evolution_patches` 表有 `openclaw_ver` 和 `success_count / attempt_count` 字段，但没有衰减或清理机制。

**问题：** OpenClaw v0.5 的修复方案对 v0.8 可能无效甚至有害。长期积累后，过时补丁会淹没有效补丁，降低查询质量。

**优化方案：版本关联 + 时间衰减 + 自动清理**

```sql
-- 扩展 evolution_patches 表 (在 v8 迁移中一并实现):

ALTER TABLE evolution_patches ADD COLUMN
    openclaw_major INTEGER;          -- 主版本号 (从 openclaw_ver 解析)

ALTER TABLE evolution_patches ADD COLUMN
    last_success_at TEXT;            -- 最近一次成功应用时间

ALTER TABLE evolution_patches ADD COLUMN
    archived INTEGER DEFAULT 0;      -- 1 = 已归档 (不参与查询)
```

```
相关度计算 (在 sentinel::evolution::lookup_by_signature 中实现):

  relevance_score = success_rate × version_freshness × recency

  其中:
    success_rate = success_count / max(attempt_count, 1)
    范围: 0.0 ~ 1.0

    version_freshness =
      当前版本 == 补丁版本  → 1.0
      差 1 个小版本         → 0.7
      差 1 个大版本         → 0.3
      差 2+ 个大版本        → 0.05
      版本未知              → 0.5

    recency = 0.5 ^ (days_since_last_success / 90)
      90 天半衰期: 90 天前的补丁权重降为 50%
                   180 天前的补丁权重降为 25%
                   365 天前的补丁权重降为 ~6%

  查询时按 relevance_score 降序排列，只返回 score > 0.1 的结果
```

```
自动清理 (定期执行):

  每次应用启动时执行一次:
    1. 标记 archived: 连续 5 次 attempt 都 fail 的补丁
    2. 标记 archived: relevance_score < 0.05 的补丁
    3. 物理删除: archived 且 created_at 超过 1 年的记录
    4. 日志: "进化库清理: 归档 N 条，删除 M 条"
```

**实施节点：** Phase 3（进化库 CRUD 实现时一并加入）
**工作量：** 约 2 天（纯 SQL + Rust 计算逻辑）

---

### 14.4 多实例 Sentinel 隔离

**现状：** InstancesPage 已支持管理多个 OpenClaw 实例（不同 URL、不同版本）。每个实例有独立的 `chatProxyToken`。但提案中的 sentinel 和进化库是全局的，没有按实例隔离。

**问题：** 用户管理 3 个实例（本地 v0.5、远程 A v0.6、远程 B v0.5），本地实例的修复方案不一定适用于远程实例（OS 不同、版本不同、配置不同）。

**优化方案：按实例隔离诊断上下文，按 bug_signature 共享修复经验**

```sql
-- 扩展 evolution_patches 表:

ALTER TABLE evolution_patches ADD COLUMN
    instance_id TEXT;                -- 产生此补丁的实例 ID (可为 null = 全局)

CREATE INDEX idx_evo_instance ON evolution_patches(instance_id);
```

```
查询策略 (分层匹配):

  lookup_by_signature(bug_sig, instance_id, openclaw_ver):
    1. 精确匹配: bug_sig + instance_id + 同版本
       → 权重 1.0 (完全相同的实例和版本)
    2. 实例匹配: bug_sig + instance_id + 不同版本
       → 权重 0.6 (同实例但版本不同)
    3. 版本匹配: bug_sig + 同版本 + 不同实例
       → 权重 0.4 (不同实例但同版本)
    4. 模糊匹配: bug_sig + 不同版本 + 不同实例
       → 权重 0.2 (仅错误类型相同)

  合并 relevance_score × match_weight 后排序
```

```
Sentinel 诊断上下文按实例构造:

  capture_crash_context(instance_id, stderr, config):
    1. 从 instances store 获取实例信息 (URL, version, OS)
    2. 读取该实例的 config.json (通过 gateway API 或本地文件)
    3. 查询该实例的历史修复记录
    4. 构造诊断 prompt，包含实例特定上下文

  好处: LLM 知道 "这是一个运行在 Ubuntu 上的 v0.6 实例"
  而不是 "某个 OpenClaw 崩溃了"
```

```
前端展示:

  进化库 UI (SettingsPage 或独立 tab):
  ┌─────────────────────────────────────────────┐
  │ 进化库  [全部] [本地实例] [远程A] [远程B]     │
  ├─────────────────────────────────────────────┤
  │ #a3f2.. config-patch  v0.5  ✓×3 ✗×0  1.0  │
  │ #b8e1.. command-seq   v0.6  ✓×1 ✗×1  0.4  │
  │ #c4d0.. config-patch  v0.5  ✓×5 ✗×0  0.9  │ (archived)
  └─────────────────────────────────────────────┘
```

**实施节点：** Phase 3（sentinel 实现时一并加入）
**工作量：** 约 3 天（schema 扩展 + 查询逻辑 + 上下文构造）

---

### 14.5 四项优化的迁移路线图整合

```
Phase 0: 基础设施         → 无变化
Phase 1: 核心共享         → 补充 Level 1 离线 (离线可读标识)
Phase 2: 前端统一 + 自愈  → 补充 Agent 多步支持 (SSE 扩展 + 步骤 UI)
Phase 3: 自愈闭环         → 补充进化库衰减 + 多实例隔离 + Level 2 离线
Phase 4: 跨设备同步       → 无变化
Phase 5: 优化             → 无变化
```

---

## 十六、关键设计决策记录

| # | 决策 | 选择 | 否决选项 | 理由 |
|---|------|------|---------|------|
| 1 | Rust 共享方式 | Cargo workspace + 共享 crate | 代码复制 / git submodule | 编译器保证一致性，最低维护成本 |
| 2 | 平台差异处理 (Rust) | Feature flags + 组合模式 | 宽泛 trait 抽象 | Feature flags 零运行时开销；组合模式避免 trait 抽象泄漏 |
| 3 | 平台差异处理 (前端) | Zustand 扩展 + Reducer 状态机 + 依赖注入 | 继承 / HOC / 单一大 Hook | Reducer 可独立测试，依赖注入解耦平台差异 |
| 4 | 设备间通信 | Tailscale + chat_proxy HTTP | Matrix 协议 / 自建 P2P | 已有基础设施，零额外依赖，加密由 WireGuard 保证 |
| 5 | 自愈范围 | 仅配置/Store/进程管理 | 包含源代码修改 | Rust 编译型不可热改；代码修改风险不可控 |
| 6 | 自愈触发 | pm2 事件 + 手动触发 | 独立监控进程 | pm2 已是进程管理器，不需要另一个 |
| 7 | 进化库存储 | SQLite (复用现有) | 独立数据库 / 文件系统 | 统一技术栈，迁移机制已成熟 |
| 8 | 补丁传输格式 | config-patch / command-sequence / store-patch | Git Diff | 不改源码，只改配置/执行命令/修改 Store |
| 9 | 联邦进化 | 远期规划，不在 v2.0 范围内 | 立即实现 | 用户量不足，过早引入增加复杂度 |
| 10 | 扩展机制 | MCP 协议 (已有) | 自建插件系统 / WASM 插件 | MCP 是 AI 工具接入的事实标准，生态开放，零内建成本 |
| 11 | 自愈工具调用 | 通过 MCP 调用外部诊断工具 | 内置所有诊断能力 | 能力随 MCP 生态增长，不被 ClawNo11 内置代码限制 |
| 12 | UI 组件共享 | 不共享 (Sidebar / BottomNav 各自维护) | 统一组件库 | 桌面/移动 UI 范式差异太大，强行统一反而增加复杂度 |

---

## 十七、架构 KPI

重构完成后，以下指标用于验证架构健康度：

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| Rust 重复代码行数 | ~800 行 (secure_store + token_log + chat 部分) | 0 行 |
| 前端重复 Store 数量 | 7 个 | 0 个 |
| ChatPage 行数 (单端) | ~1100 行 | ≤300 行 |
| 新增平台所需工作量 | 3-4 周 (从头写) | 1-2 周 (只写壳) |
| 修改共享逻辑后需要手动同步的文件数 | 2-10 个 | 0 个 |
| OpenClaw 崩溃后恢复时间 | 用户手动排查 | ≤30 秒自动重启 + 诊断 |
| 配置修复回滚时间 | 无回滚能力 | ≤5 秒自动回滚 |
| 新增外部工具能力所需代码改动 | 需写适配代码 | 0 行 (MCP 标准接入) |
| MCP Server 安全扫描覆盖率 | 部分扫描 | 100% 接入即扫描 |
| Agent 工具调用可见性 | 不可见 (丢弃) | 100% 步骤可见 + 可折叠 |
| 移动端离线可读功能覆盖率 | 0% | 100% (历史/统计/设置) |
| 移动端消息发送失败恢复率 | 0% (直接丢失) | ≥95% (队列重试) |
| 进化库过期补丁占比 | 无衰减 (持续累积) | ≤10% (自动归档清理) |
| 多实例诊断精确度 | 全局混合 | 按实例隔离上下文 |
