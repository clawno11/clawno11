# ClawNo.11 模块边界与职责

> 本文档定义每个模块的职责边界、依赖规则和所有权。
> 用于代码审查时判断"这段代码该放哪里"。
> 校对参考：[ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) §2-§6, §14

---

## 一、依赖方向规则

```
              禁止向上依赖
                  ↑
┌─────────────────┴─────────────────┐
│ Layer 4: apps/desktop, apps/mobile │  可以依赖 Layer 3, 2, 1
├───────────────────────────────────┤
│ Layer 3: packages/shared           │  可以依赖 Layer 1 (Tauri plugin API)
├───────────────────────────────────┤
│ Layer 2: crates/clawno-core        │  只依赖 Rust 标准库和第三方 crate
├───────────────────────────────────┤
│ Layer 1: Foundation                │  无依赖
└───────────────────────────────────┘

违规示例 (禁止):
  ✗ clawno-core import tauri::AppHandle  → core 不能依赖 Tauri
  ✗ @clawno/shared import from apps/     → shared 不能依赖具体 app
  ✗ mobile import from desktop           → 平台之间不能互相依赖
```

---

## 二、Rust 模块职责矩阵

### clawno-core (共享 crate)

| 模块 | 职责 | 不负责 |
|------|------|--------|
| `chat.rs` | SSE 行解析、HTTP SSE 请求、Ollama SSE 请求、事件类型定义 | fallback 策略、Tauri 事件发射、CLI 调用 |
| `secure_store.rs` | 加密 KV 的读/写/删/列/清空核心逻辑 | Tauri plugin-store 初始化 |
| `token_log.rs` | SQLite 迁移定义 (v1-v8+)、DB_URL 常量 | 迁移执行 (由 Tauri plugin-sql 执行) |
| `types.rs` | 所有跨平台共享的 struct/enum 定义 | 平台特有类型 (用 `#[cfg(feature)]` 隔离) |
| `mcp.rs` | MCP 配置解析、风险评估规则、扫描逻辑 | OpenClaw 插件管理 (desktop 特有) |
| `ssh.rs` | SshArgs, TofuHandler, ssh_exec, 部署脚本常量, TOFU 验证, shell 转义 (feature: ssh-exec) | Tauri 命令注册 |
| `types.rs` | StepResult + 所有跨平台共享 struct/enum | 平台特有类型 |
| `rag.rs` | 文件路径验证、扩展名检查、文件读取 | 向量化/索引 |
| `sentinel/` | 崩溃上下文捕获、诊断 prompt 构造、进化库 CRUD、配置备份/回滚 | pm2 进程管理、Tauri 事件通知 |

### apps/desktop/src-tauri/src/ (桌面平台层)

| 模块 | 职责 | 命令数 |
|------|------|:------:|
| `lib.rs` | Tauri 命令注册、插件初始化、托盘、chat_proxy 启动 | — |
| `platform.rs` | 跨 OS shell 执行、路径工具、PATH 增强 | 0 |
| `node.rs` | Node.js 检测/安装/升级、OpenClaw CLI 管理、npm 错误回退 | 6 |
| `pm2.rs` | pm2 安装、进程启停/重启、日志获取 | 4 |
| `deploy.rs` | 部署编排、API Key 配置、模型自动选择 | 5 |
| `gateway.rs` | 本地网关启动/停止、浏览器 URL、调用 core 探测 | 6 |
| `security.rs` | 安全评分、防火墙、IP 白名单、工具权限、紧急断网、LAN 扫描 | 18 |
| `connectors.rs` | Feishu 连接器、Tailscale (子进程检测) | 4 |
| `bots.rs` | Telegram/Discord Bot 生命周期管理 | 12 |
| `pairing.rs` | QR 配对 (token 生成、PIN、验证微服务) | 4 |
| `chat.rs` | 桌面聊天策略 (HTTP→CLI→Ollama)、调用 core SSE | 1 |
| `chat_proxy.rs` | LAN REST 代理 (axum, Bearer 认证) | 0 (HTTP 路由) |
| `rag.rs` | 文本文件读取 (10MiB, 扩展名白名单) | 1 |
| `ollama.rs` | Ollama 安装/启动/模型管理/拉取进度 | 7 |
| `ssh_deploy.rs` | 桌面 SSH 部署 — 薄 Tauri 命令包装 (调用 core::ssh::ssh_exec) | 5 |
| `token_log.rs` | 调用 core 迁移 | 0 |

### apps/mobile/src-tauri/src/ (移动平台层)

| 模块 | 职责 | 命令数 |
|------|------|:------:|
| `lib.rs` | Tauri 命令注册、插件初始化 | — |
| `chat.rs` | 移动聊天策略 (HTTP→proxy Ollama)、调用 core SSE | 1 |
| `gateway.rs` | 远程探测 (调用 core)、read_text_file (⚠️ 待迁移) | 3 |
| `connectors.rs` | Tailscale UDP 探测、proxy token 获取 | 3 |
| `mcp.rs` | MCP 扫描 (调用 core) | 1 |
| `ssh_deploy.rs` | 移动 SSH 部署+管理 — 薄 Tauri 命令包装 (调用 core::ssh::ssh_exec) | 10 |
| `secure_store.rs` | 调用 core macro (define_secure_store_commands!) | 5 |
| `token_log.rs` | 调用 core 迁移 | 0 |

---

## 三、前端模块职责矩阵

### @clawno/shared (共享前端包)

| 目录/文件 | 职责 | 不负责 |
|----------|------|--------|
| `stores/*.ts` | 所有 Zustand store 的核心状态和方法 (目标 ≤7 个) | 平台特有字段 (放各 app 的 extensions) |
| `chat/helpers.ts` | 纯函数：PII、注入检测、Token 估算、错误人性化 | 任何有副作用的逻辑 |
| `chat/useChatEngine.ts` | 聊天引擎：内含 reducer 状态机 + 事件监听 + IPC 调用 | UI 渲染 |
| `chat/types.ts` | 聊天相关类型定义 | — |
| `ipc/types.ts` | 共享 IPC 接口类型 (SecureStoreAPI, ChatAPI 等) | 具体 invoke 实现 |
| `hooks/*.ts` | 共享 React hooks | 平台特有 hooks |

### apps/desktop/src/ (桌面前端)

| 目录/文件 | 职责 |
|----------|------|
| `pages/*.tsx` | 桌面 UI 壳：Sidebar 布局、桌面特有交互 |
| `components/Sidebar.tsx` | 桌面导航 |
| `ipc.ts` | 72 个 Tauri invoke 封装 |
| `store/desktopExtensions.ts` | 桌面特有 store 扩展字段 |

### apps/mobile/src/ (移动前端)

| 目录/文件 | 职责 |
|----------|------|
| `pages/*.tsx` | 移动 UI 壳：Tab 布局、触屏交互、iOS 键盘适配 |
| `components/BottomNav.tsx, TopBar.tsx` | 移动导航 |
| `ipc.ts` | 14 个 Tauri invoke 封装 |
| `store/mobileExtensions.ts` | 移动特有 store 扩展 (chatProxyToken 等) |

---

## 四、模块间依赖图

```
apps/desktop/src-tauri/
  ├── 依赖 clawno-core { features = ["desktop"] }
  ├── 依赖 tauri + tauri-plugin-*
  └── 不依赖 apps/mobile

apps/mobile/src-tauri/
  ├── 依赖 clawno-core { features = ["mobile"] }
  ├── 依赖 tauri + tauri-plugin-*
  └── 不依赖 apps/desktop

crates/clawno-core/
  ├── 依赖 serde, tokio, reqwest, russh, futures-util
  ├── 不依赖 tauri (核心原则!)
  └── 不依赖任何 app

apps/desktop/src/
  ├── 依赖 @clawno/shared, @clawno/openclaw-client, @clawno/deploy-engine
  └── 不依赖 apps/mobile/src

apps/mobile/src/
  ├── 依赖 @clawno/shared, @clawno/openclaw-client
  └── 不依赖 apps/desktop/src

packages/shared/
  ├── peerDependencies: zustand, @tauri-apps/plugin-sql
  ├── 不依赖任何 app
  └── 不依赖 clawno-core (前后端通过 Tauri IPC 通信，不直接依赖)
```

---

## 五、"这段代码该放哪里"决策树

```
新增一段逻辑时，按以下顺序判断：

Q1: 这段逻辑 desktop 和 mobile 都需要吗？
  ├── 否 → 放对应 app 的 src-tauri/ 或 src/
  └── 是 → Q2

Q2: 这是 Rust 逻辑还是 TypeScript 逻辑？
  ├── Rust → Q3
  └── TypeScript → Q4

Q3: 这段 Rust 逻辑是否依赖 tauri::AppHandle 或 Tauri 事件？
  ├── 是 → 放各 app 的 src-tauri/src/，调用 core 的共享函数
  └── 否 → 放 clawno-core

Q4: 这段 TS 逻辑是纯函数还是有副作用 (Store/IPC/DOM)？
  ├── 纯函数 → @clawno/shared 对应目录
  ├── Store 逻辑 → @clawno/shared/stores/
  ├── Hook (通用) → @clawno/shared/hooks/
  └── 平台特有 → 各 app 的 store/ 或 pages/

Q5: 新增 Store 字段时，该放 base 还是 extension？
  ├── 只有一个平台需要 → extension
  └── 两个平台都需要 → base (如果已在 extension，立即提升到 base)
```

---

## 六、命名冲突处理

当前存在同名文件的情况：

| 文件名 | core | desktop | mobile | 处理方式 |
|--------|:----:|:-------:|:------:|---------|
| `chat.rs` | SSE 解析 | 桌面策略 | 移动策略 | 允许同名，职责清晰不同 |
| `gateway.rs` | HTTP 探测 | 网关生命周期 | 远程探测 | ⚠️ core 建议改名为 `health.rs` |
| `connectors.rs` | 类型定义 | Feishu+Tailscale | UDP+proxy | ⚠️ core 内容太少，考虑合并到 types.rs |
| `secure_store.rs` | 核心逻辑 | 调用 core | 调用 core | 允许同名 |
| `token_log.rs` | 迁移定义 | 调用 core | 调用 core | 允许同名 |
| `ssh_deploy.rs` | SSH 核心 | 桌面部署 | 移动部署 | ⚠️ core 建议改名为 `ssh.rs` |
| `mcp.rs` | 扫描核心 | 扫描+插件 | 扫描 | 允许同名 |

---

## 七、模块规模监控

当单个模块超过以下阈值时，应考虑拆分：

| 指标 | 阈值 | 当前超标 |
|------|------|---------|
| 单文件行数 | >500 行 | `node.rs` (1189), `chat.rs` desktop (518) |
| 单模块 Tauri 命令数 | >10 个 | `bots.rs` (12) |
| shared Store 总数 | >7 个 | — (目标 ≤7) |
| 单 Store 文件方法数 | >15 个 | — |
| 单页面组件行数 | >400 行 | `ChatPage.tsx` desktop (~620), mobile (~560) |

**security/ 模块拆分（已完成 2026-03-12）：**

```
security/ (原 security.rs 823 行, 18 命令) 已拆为:
├── mod.rs       — 共享类型 re-export
├── scan.rs      — scan_security_status, check_*, calculate_score (评估)
├── firewall.rs  — apply/remove_firewall, kill_switch, network_access (网络控制)
└── network.rs   — IP 白名单, LAN 扫描, 本机信息
```

**ChatPage 共享组件（已完成 2026-03-12）：**

```
packages/shared/src/components/chat/
├── ChatBanners.tsx   — 路由/注入/PII 三种通知横幅
└── PromptPicker.tsx  — 提示词模板选择器 + 添加/删除
```
