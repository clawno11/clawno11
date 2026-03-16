# ClawNo.11

> **The 11th Way to Run Your AI** — 本地 AI 网关管理控制台

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-orange.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange.svg)](https://rustup.rs)

**ClawNo.11** 是一款基于 [Tauri 2](https://tauri.app) + [React 19](https://react.dev) 构建的**跨平台应用**（Windows / macOS / iOS / Android），为 [OpenClaw](https://github.com/clawno11/clawno11) AI 网关提供**一键部署、可视化管理和本地 AI 对话**能力。

*Your AI, Your Data, Your Home.*

### 支持平台

| 平台 | 状态 | 安装方式 |
|------|------|---------|
| Windows | ✅ | `.msi` / `.exe` |
| macOS | ✅ | `.dmg` |
| iOS | ✅ | Xcode 构建 / TestFlight |
| Android | ✅ | `.apk` |

---

## 核心功能

| 模块 | 功能 |
|------|------|
| 🚀 **一键部署** | 自动检测 Node.js → 安装 openclaw CLI → 安装 pm2 → 初始化配置 → 启动服务，全流程 5 步，带进度显示和计时 |
| 🖥️ **实例管理** | 管理多个 OpenClaw 实例（本地/远程），实时健康探测、延迟监控、服务启停重启 |
| 💬 **AI 对话** | 流式 SSE 聊天，支持 PII 过滤、RAG 知识库注入、智能路由、会话历史、提示词库 |
| 🔐 **Claw Guard** | 安全评分仪表盘（0-100 分）、端口监控、Windows 防火墙管理、安全事件日志、一键数据销毁 |
| 📊 **Token 监控** | 24 小时 Token 消耗统计、逐小时柱状图、7 天异常检测（>3σ 告警） |
| 🔌 **IM 连接器** | 飞书/Lark 集成配置向导、Tailscale 远程访问检测 |
| 📚 **私有知识库** | 文档导入切块（TXT/MD/CSV 等）、TF-IDF + 余弦相似度检索、RAG 上下文注入 |
| 🔧 **MCP 插件** | MCP 服务器注册（HTTP/SSE/Stdio）、多维安全扫描（safe/caution/danger）、审计日志 |
| 🗺️ **智能路由** | 基于关键词的模型路由规则，按优先级分发到不同 AI 实例 |
| ⚙️ **设置** | 中/英语言切换、Token 日志清理、API Key 管理、安全等级预设 |

---

## 支持的 AI 提供商

**直连模式（Direct）**

| 提供商 | 默认模型 |
|--------|---------|
| 智谱 AI / ZAI | `glm-4-plus` |
| MiniMax | `abab6.5s-chat` |
| Anthropic (Claude) | `anthropic/claude-sonnet-4-6` |
| OpenAI (GPT) | `openai/gpt-4o` |
| OpenRouter | `openai/gpt-4o-mini` |

**通过 OpenRouter 中转**

DeepSeek · Moonshot/Kimi · 阿里通义千问 · 字节豆包 · 腾讯混元 · 讯飞星火 · 百川智能 · 阶跃星辰 · 零一万物 · 硅基流动

---

## 系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     ClawNo.11 Desktop                        │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │            React 19 前端（Tauri WebView）              │  │
│   │                                                      │  │
│   │  Sidebar → 10 个页面（React Router 7）                 │  │
│   │                                                      │  │
│   │  Store 层（Zustand 5 + SQLite + localStorage）        │  │
│   │  ipc.ts → 类型安全 invoke() 桥接层                     │  │
│   └────────────────────────┬─────────────────────────────┘  │
│                            │ Tauri IPC                       │
│   ┌────────────────────────▼─────────────────────────────┐  │
│   │               Rust 后端（Tauri 2）                     │  │
│   │                                                      │  │
│   │  platform → node → pm2 → gateway → deploy            │  │
│   │  secure_store → security → connectors                 │  │
│   │  mcp → rag → token_log（SQLite 迁移）                  │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│  本地存储：clawno.db（SQLite）+ clawno_secure.bin（AES 加密）  │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP / OpenAI-compatible REST API
┌─────────────────────────▼───────────────────────────────────┐
│          OpenClaw 网关（Node.js + pm2，端口 18789）            │
│          提供 OpenAI-compatible 流式 SSE 接口                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────┐
│              AI 提供商 API（Anthropic / OpenAI / ZAI 等）     │
└─────────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Tauri 2.x（Rust 后端 + WebView 前端） |
| **前端框架** | React 19（TypeScript 5.7） |
| **路由** | React Router DOM 7 |
| **状态管理** | Zustand 5（带 persist 中间件） |
| **样式** | Tailwind CSS 3 + 自定义 CSS 变量 |
| **图标** | lucide-react |
| **国际化** | i18next + react-i18next（中文 / 英文） |
| **本地数据库** | SQLite（`@tauri-apps/plugin-sql`） |
| **加密存储** | `tauri-plugin-store`（AES-GCM） |
| **HTTP 客户端（Rust）** | reqwest 0.12 |
| **异步运行时（Rust）** | Tokio 1（full features） |
| **进程守护** | pm2（via CLI） |
| **AI 客户端** | `@clawno/openclaw-client`（workspace 包，流式 SSE） |
| **测试** | Vitest 4 |
| **构建工具** | Vite 6 |

---

## 目录结构

```
clawno11/
├── apps/
│   ├── desktop/                           # 桌面版（Windows / macOS）
│   └── mobile/                            # 移动版（iOS / Android）
├── packages/
│   ├── shared/                            # 共享前端代码（组件/Store/国际化）
│   ├── openclaw-client/                   # OpenClaw SSE 流式客户端
│   ├── deploy-engine/                     # 远程部署引擎
│   └── clawno-server/                     # ClawNO11 独立服务端
├── crates/
│   └── clawno-core/                       # 共享 Rust 核心逻辑
├── apps/desktop/                          # ──── 桌面版详细结构 ────
│       ├── package.json                    # 前端依赖配置
│       ├── vite.config.ts                  # Vite 构建配置
│       ├── src/                            # React 前端源码
│       │   ├── main.tsx                    # 应用入口
│       │   ├── App.tsx                     # 根组件 + 路由定义
│       │   ├── ipc.ts                      # Tauri IPC 类型化桥接层
│       │   ├── i18n.ts                     # 国际化配置
│       │   ├── index.css                   # 全局样式（CSS 变量 + Tailwind）
│       │   ├── components/
│       │   │   └── Sidebar.tsx             # 侧边栏导航组件
│       │   ├── pages/                      # 功能页面（共 10 个）
│       │   │   ├── InstancesPage.tsx       # 实例管理
│       │   │   ├── DeployPage.tsx          # 一键部署
│       │   │   ├── ChatPage.tsx            # AI 对话
│       │   │   ├── SecurityPage.tsx        # Claw Guard 安全
│       │   │   ├── TokenPage.tsx           # Token 监控
│       │   │   ├── ConnectorsPage.tsx      # IM 连接器
│       │   │   ├── RagPage.tsx             # 私有知识库
│       │   │   ├── McpPage.tsx             # MCP 插件管理
│       │   │   ├── RouterPage.tsx          # 智能路由
│       │   │   └── SettingsPage.tsx        # 设置
│       │   ├── store/                      # 状态管理（Zustand + SQLite）
│       │   │   ├── instances.ts            # 实例列表（Zustand + persist）
│       │   │   ├── aiConfig.ts             # AI 提供商配置状态
│       │   │   ├── chatHistory.ts          # 聊天历史（SQLite）
│       │   │   ├── tokenLog.ts             # Token 消耗日志（SQLite）
│       │   │   ├── ragStore.ts             # RAG 知识库（SQLite + TF-IDF）
│       │   │   ├── mcpStore.ts             # MCP 管理（SQLite）
│       │   │   ├── modelRouter.ts          # 路由规则（localStorage）
│       │   │   ├── piiFilter.ts            # PII 过滤（纯 TS 正则）
│       │   │   ├── secureStore.ts          # 加密存储桥接
│       │   │   ├── securityEventStore.ts   # 安全事件日志（SQLite）
│       │   │   ├── promptLibrary.ts        # 提示词模板库（localStorage）
│       │   │   └── db.ts                   # SQLite 路径常量
│       │   └── locales/
│       │       ├── zh.json                 # 中文翻译
│       │       └── en.json                 # 英文翻译
│       └── src-tauri/                      # Rust 后端（Tauri 2）
│           ├── Cargo.toml                  # Rust 依赖
│           ├── tauri.conf.json             # Tauri 应用配置
│           ├── capabilities/default.json   # 权限白名单
│           └── src/
│               ├── main.rs                 # Rust 程序入口
│               ├── lib.rs                  # 插件注册 + invoke_handler
│               ├── types.rs                # 共享序列化类型
│               ├── platform.rs             # 跨平台辅助函数
│               ├── node.rs                 # Node.js / openclaw 管理
│               ├── pm2.rs                  # pm2 进程生命周期
│               ├── gateway.rs              # openclaw 网关启停/健康
│               ├── deploy.rs               # 部署流水线协调
│               ├── secure_store.rs         # 加密 KV 存储命令
│               ├── security.rs             # 安全扫描 + 防火墙
│               ├── connectors.rs           # IM 连接器（飞书/Tailscale）
│               ├── mcp.rs                  # MCP 安全扫描
│               ├── rag.rs                  # RAG 文件读取（安全校验）
│               └── token_log.rs            # SQLite Schema 迁移
├── DISCLAIMER.md                           # 免责声明
├── LICENSE                                 # Apache 2.0 许可证
├── SECURITY.md                             # 安全政策
├── TRADEMARK.md                            # 商标声明
└── docs/                                   # 详细文档（见下方）
    ├── ARCHITECTURE.md                     # 系统架构详解
    ├── API.md                              # Tauri IPC 命令参考
    └── DEVELOPMENT.md                      # 开发环境搭建指南
```

---

## 快速开始

### 环境要求

| 工具 | 版本要求 |
|------|---------|
| [Node.js](https://nodejs.org) | ≥ 18.x |
| [pnpm](https://pnpm.io) | ≥ 9.x |
| [Rust](https://rustup.rs) | ≥ 1.80（stable） |
| [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | Desktop development with C++ |

### 安装与运行

```bash
# 1. 克隆仓库
git clone https://github.com/clawno11/clawno11.git
cd clawno11

# 2. 安装依赖
pnpm install
```

#### 桌面版（Windows / macOS）

```bash
cd apps/desktop
pnpm tauri:dev          # 开发模式（热更新）
pnpm tauri:build        # 生产构建
```

#### iOS 移动版

```bash
cd apps/mobile
npx tauri ios init      # 首次：生成 Xcode 项目
npx tauri ios dev --open  # 开发模式（Xcode 打开后选择模拟器运行）
npx tauri ios build     # 生产构建
```

> **注意**：iOS 构建需要 macOS + Xcode 15+。请在 `apps/mobile/src-tauri/tauri.conf.json` 中将 `developmentTeam` 替换为你的 Apple Developer Team ID。

#### Android 移动版

```bash
cd apps/mobile
npx tauri android init   # 首次：生成 Android 项目
npx tauri android dev    # 开发模式
npx tauri android build  # 生产构建
```

> 详细环境搭建请参阅 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## 数据库 Schema

ClawNo.11 使用单一 SQLite 数据库（`clawno.db`），通过 5 次迁移建立完整 schema：

| 版本 | 表名 | 用途 |
|------|------|------|
| v1 | `token_records` | Token 消耗记录（按实例/提供商/模型分类） |
| v2 | `security_events` | 安全事件日志（类型/详情/严重级别） |
| v3 | `rag_documents` + `rag_chunks` | RAG 知识库（文档元数据 + 500字切块） |
| v4 | `mcp_servers` + `mcp_audit` | MCP 服务器注册表 + 工具调用审计 |
| v5 | `chat_sessions` + `chat_messages` | 聊天会话 + 消息（级联删除） |

---

## 安全设计

ClawNo.11 以**本地优先、零信任**为安全原则：

- **无遥测** — 代码中无任何分析、追踪或隐藏代理
- **API Key 注入防护** — 通过 stdin 管道传输密钥，从不出现在命令行；provider 名称严格白名单验证
- **加密本地存储** — 敏感数据（API Key）存入 AES-GCM 加密的 `clawno_secure.bin`，从不写入 localStorage
- **PII 客户端过滤** — 发送 AI 前自动检测并替换手机号/身份证/邮箱/API Key/信用卡/内网 IP（6 类）
- **RAG 文件访问沙箱** — 强制扩展名白名单，防止路径遍历读取系统敏感文件
- **MCP 安全扫描** — 对每个 MCP 服务器进行静态+动态多维风险评估
- **CSP 策略** — `connect-src` 仅允许 `127.0.0.1` 和 `localhost`
- **Panic Button** — 一键清除所有敏感数据（API Key + 安全事件日志）
- **防火墙控制** — 可通过 GUI 添加/移除 Windows 防火墙规则，阻止外部访问本地网关

> 详细安全策略请参阅 [SECURITY.md](SECURITY.md)

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [README.md](README.md) | 项目概览（本文件） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构详解（模块/数据流/设计决策） |
| [docs/API.md](docs/API.md) | 所有 Tauri IPC 命令参考文档 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发环境搭建、构建、测试指南 |
| [SECURITY.md](SECURITY.md) | 安全政策与漏洞报告流程 |
| [DISCLAIMER.md](DISCLAIMER.md) | 免责声明 |
| [TRADEMARK.md](TRADEMARK.md) | 商标政策 |
| [LICENSE](LICENSE) | Apache 2.0 开源许可证 |

---

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。

"ClawNo.11" 名称及 Logo 为 Clawno Team 的商标，使用前请阅读 [TRADEMARK.md](TRADEMARK.md)。
