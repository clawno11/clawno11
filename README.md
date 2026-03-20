# ClawNo.11

> **The 11th Way to Run Your AI** — Local AI Gateway Management Console

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-orange.svg)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-1.80+-orange.svg)](https://rustup.rs)

**ClawNo.11** is a cross-platform application (Windows / macOS / iOS / Android) built with [Tauri 2](https://tauri.app) + [React 19](https://react.dev), providing **one-click deployment, visual management, and local AI chat** capabilities for the [OpenClaw](https://github.com/nicepkg/openclaw) AI gateway.

*Your AI, Your Data, Your Home.*

### Download & Install

| Platform | Install |
|----------|---------|
| Windows | [Download `.msi` / `.exe`](https://github.com/clawno11/clawno11/releases/latest) |
| macOS | [Download `.dmg`](https://github.com/clawno11/clawno11/releases/latest) |
| **iOS** | [**Join TestFlight Beta**](https://testflight.apple.com/join/BmVqFUkC) |
| Android | `.apk` (coming soon) |

---

## Core Features

| Module | Description |
|--------|-------------|
| 🚀 **One-Click Deploy** | Auto-detect Node.js → Install OpenClaw CLI → Install pm2 → Initialize config → Start service. 5 steps with progress bar and timer |
| 🖥️ **Instance Manager** | Manage multiple OpenClaw instances (local/remote), real-time health probes, latency monitoring, service start/stop/restart |
| 💬 **AI Chat** | Streaming SSE chat with PII filtering, RAG knowledge injection, smart routing, conversation history, and prompt library |
| 🔐 **Claw Guard** | Security score dashboard (0-100), port monitoring, Windows firewall management, security event logs, one-click data wipe |
| 📊 **Token Monitor** | 24-hour token consumption stats, hourly bar charts, 7-day anomaly detection (>3σ alerts) |
| 🔌 **Connectors** | Lark integration wizard, Tailscale remote access detection, xEdge mesh networking |
| 📚 **Knowledge Base** | Document import & chunking (TXT/MD/CSV), TF-IDF + cosine similarity search, RAG context injection |
| 🔧 **MCP Plugins** | MCP server registration (HTTP/SSE/Stdio), multi-dimensional security scanning (safe/caution/danger), audit logs |
| 🗺️ **Smart Router** | Keyword-based model routing rules, priority-based dispatch to different AI instances |
| ⚙️ **Settings** | Chinese/English language switch, token log cleanup, API Key management, security level presets |

---

## Supported AI Providers

**Direct Mode**

| Provider | Default Model |
|----------|--------------|
| ZAI (Zhipu AI) | `glm-4-plus` |
| MiniMax | `abab6.5s-chat` |
| Anthropic (Claude) | `anthropic/claude-sonnet-4-6` |
| OpenAI (GPT) | `openai/gpt-4o` |
| OpenRouter | `openai/gpt-4o-mini` |

**Via OpenRouter**

DeepSeek · Moonshot/Kimi · Alibaba Qwen · ByteDance Doubao · Tencent Hunyuan · iFlytek Spark · Baichuan · StepFun · 01.AI · SiliconFlow

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     ClawNo.11 Desktop                        │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │          React 19 Frontend (Tauri WebView)            │  │
│   │                                                      │  │
│   │  Sidebar → 10 Pages (React Router 7)                  │  │
│   │                                                      │  │
│   │  Store Layer (Zustand 5 + SQLite + localStorage)      │  │
│   │  ipc.ts → Type-safe invoke() Bridge                   │  │
│   └────────────────────────┬─────────────────────────────┘  │
│                            │ Tauri IPC                       │
│   ┌────────────────────────▼─────────────────────────────┐  │
│   │              Rust Backend (Tauri 2)                    │  │
│   │                                                      │  │
│   │  platform → node → pm2 → gateway → deploy            │  │
│   │  secure_store → security → connectors                 │  │
│   │  mcp → rag → token_log (SQLite migrations)            │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Local Storage: clawno.db (SQLite) + clawno_secure.bin (AES) │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP / OpenAI-compatible REST API
┌─────────────────────────▼───────────────────────────────────┐
│        OpenClaw Gateway (Node.js + pm2, port 18789)          │
│        OpenAI-compatible streaming SSE API                   │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────┐
│         AI Provider APIs (Anthropic / OpenAI / ZAI etc.)     │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Framework** | Tauri 2.x (Rust backend + WebView frontend) |
| **Frontend** | React 19 (TypeScript 5.7) |
| **Routing** | React Router DOM 7 |
| **State Management** | Zustand 5 (with persist middleware) |
| **Styling** | Tailwind CSS 3 + Custom CSS Variables |
| **Icons** | lucide-react |
| **i18n** | i18next + react-i18next (Chinese / English) |
| **Local Database** | SQLite (`@tauri-apps/plugin-sql`) |
| **Encrypted Storage** | `tauri-plugin-store` (AES-GCM) |
| **HTTP Client (Rust)** | reqwest 0.12 |
| **Async Runtime (Rust)** | Tokio 1 (full features) |
| **Process Daemon** | pm2 (via CLI) |
| **AI Client** | `@clawno/openclaw-client` (workspace package, streaming SSE) |
| **Testing** | Vitest 4 |
| **Build Tool** | Vite 6 |

---

## Project Structure

```
clawno11/
├── apps/
│   ├── desktop/                           # Desktop app (Windows / macOS)
│   └── mobile/                            # Mobile app (iOS / Android)
├── packages/
│   ├── shared/                            # Shared frontend code (components/stores/i18n)
│   ├── openclaw-client/                   # OpenClaw SSE streaming client
│   ├── deploy-engine/                     # Remote deployment engine
│   └── clawno-server/                     # ClawNO11 standalone server
├── crates/
│   └── clawno-core/                       # Shared Rust core logic
├── docs/                                  # Documentation
│   ├── ARCHITECTURE.md                    # System architecture details
│   ├── API.md                             # Tauri IPC command reference
│   └── DEVELOPMENT.md                     # Development setup guide
├── LICENSE                                # Apache 2.0 License
├── SECURITY.md                            # Security policy
└── DISCLAIMER.md                          # Disclaimer
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|------|---------|
| [Node.js](https://nodejs.org) | ≥ 18.x |
| [pnpm](https://pnpm.io) | ≥ 9.x |
| [Rust](https://rustup.rs) | ≥ 1.80 (stable) |
| [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | Desktop development with C++ (Windows only) |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/clawno11/clawno11.git
cd clawno11

# 2. Install dependencies
pnpm install
```

#### Desktop (Windows / macOS)

```bash
cd apps/desktop
pnpm tauri:dev          # Development mode (hot reload)
pnpm tauri:build        # Production build
```

#### iOS

```bash
cd apps/mobile
npx tauri ios init        # First time: generate Xcode project
npx tauri ios dev --open  # Development mode (opens Xcode)
npx tauri ios build       # Production build
```

> **Note**: iOS builds require macOS + Xcode 15+. Set your Apple Developer Team ID in `apps/mobile/src-tauri/tauri.conf.json`.

#### Android

```bash
cd apps/mobile
npx tauri android init    # First time: generate Android project
npx tauri android dev     # Development mode
npx tauri android build   # Production build
```

> For detailed setup instructions, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## Database Schema

ClawNo.11 uses a single SQLite database (`clawno.db`) with 5 migrations:

| Version | Table | Purpose |
|---------|-------|---------|
| v1 | `token_records` | Token consumption records (by instance/provider/model) |
| v2 | `security_events` | Security event logs (type/detail/severity) |
| v3 | `rag_documents` + `rag_chunks` | RAG knowledge base (document metadata + 500-char chunks) |
| v4 | `mcp_servers` + `mcp_audit` | MCP server registry + tool call audit |
| v5 | `chat_sessions` + `chat_messages` | Chat sessions + messages (cascade delete) |

---

## Security Design

ClawNo.11 follows a **local-first, zero-trust** security philosophy:

- **No telemetry** — Zero analytics, tracking, or hidden proxies in the codebase
- **API Key injection protection** — Keys passed via stdin pipe, never exposed in command line; provider names strictly validated against whitelist
- **Encrypted local storage** — Sensitive data (API Keys) stored in AES-GCM encrypted `clawno_secure.bin`, never in localStorage
- **PII client-side filtering** — Auto-detect and mask phone numbers, national IDs, emails, API keys, credit cards, and internal IPs before sending to AI
- **RAG file access sandbox** — Enforced file extension whitelist, prevents path traversal attacks on system files
- **MCP security scanning** — Static + dynamic multi-dimensional risk assessment for each MCP server
- **CSP policy** — `connect-src` restricted to `127.0.0.1` and `localhost`
- **Panic Button** — One-click wipe of all sensitive data (API Keys + security event logs)
- **Firewall control** — GUI-based Windows Firewall rule management to block external access to local gateway

> For detailed security policy, see [SECURITY.md](SECURITY.md)

---

## Documentation

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Project overview (this file) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture details |
| [docs/API.md](docs/API.md) | Tauri IPC command reference |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Development setup & build guide |
| [SECURITY.md](SECURITY.md) | Security policy & vulnerability reporting |
| [DISCLAIMER.md](DISCLAIMER.md) | Disclaimer |
| [TRADEMARK.md](TRADEMARK.md) | Trademark policy |
| [LICENSE](LICENSE) | Apache 2.0 License |

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

"ClawNo.11" name and logo are trademarks of the Clawno Team. Please read [TRADEMARK.md](TRADEMARK.md) before use.
